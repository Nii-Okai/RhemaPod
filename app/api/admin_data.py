"""Database export / import (Settings › Data) — admin only.

* `GET  /admin/data/tables` — every table with its row count and what it
  allows; the screen builds its picker from this.
* `GET  /admin/data/export?tables=a&tables=b` — a JSON file of those tables
  (all of them when none are named). Fail-closed like the report export: the
  `data.exported` audit row is committed before the file is returned.
* `POST /admin/data/import` — merge or replace from an export file. Defaults
  to a dry run that reports what would change and rolls back; a real run must
  send the mode's confirmation phrase.
* `POST /admin/data/reset` — empty chosen tables, or every table (a database
  wipe). Dry run by default; a real run needs the phrase and the admin's
  password. The admin's own account, the audit trail and church settings are
  never touched.

All of the rules live in `data_transfer_service`; this module only maps them
onto HTTP.
"""
import json
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import AuditCtx, CurrentUser, require_role
from app.db.database import get_db
from app.models.models import User, UserRole
from app.services import auth_service
from app.services import data_transfer_service as svc
from app.services.data_transfer_service import DataTransferError

router = APIRouter(prefix="/admin/data", tags=["admin data"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AdminOnly = Annotated[CurrentUser, Depends(require_role(UserRole.ADMIN))]


class DataTable(BaseModel):
    name: str
    rows: int
    importable: bool
    replaceable: bool
    referenced_by: list[str]
    resettable: bool
    reset_with: list[str] = Field(
        description="Tables a reset of this one also empties (they point at it "
        "with ON DELETE CASCADE or RESTRICT)."
    )


class DataTablesResponse(BaseModel):
    schema_revision: str | None
    tables: list[DataTable]


class DataImportRequest(BaseModel):
    document: dict[str, Any]
    mode: Literal["merge", "replace"] = "merge"
    tables: list[str] | None = Field(
        default=None, description="Tables to import from the file; all of them when omitted."
    )
    dry_run: bool = True
    confirm: str | None = Field(
        default=None,
        description="Required when `dry_run` is false: `IMPORT` for merge, `REPLACE` for replace.",
    )


class DataImportTableResult(BaseModel):
    name: str
    inserted: int
    updated: int
    deleted: int
    skipped: int


class DataImportResponse(BaseModel):
    mode: Literal["merge", "replace"]
    dry_run: bool
    tables: list[DataImportTableResult]


async def _actor(db: AsyncSession, current: CurrentUser) -> User:
    user = await auth_service.get_user_by_id(db, current.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


def _err(exc: DataTransferError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/tables", response_model=DataTablesResponse)
async def list_tables(user: AdminOnly, db: DbDep) -> DataTablesResponse:
    infos, revision = await svc.list_tables(db)
    return DataTablesResponse(
        schema_revision=revision,
        tables=[DataTable(**info.__dict__) for info in infos],
    )


@router.get(
    "/export",
    response_class=Response,
    responses={200: {"content": {"application/json": {}}, "description": "Export file."}},
)
async def export_data(
    user: AdminOnly,
    db: DbDep,
    ctx: AuditCtx,
    tables: Annotated[list[str] | None, Query()] = None,
) -> Response:
    try:
        document = await svc.export_tables(db, tables)
    except DataTransferError as exc:
        raise _err(exc)
    names = list(document["tables"])
    actor = await _actor(db, user)
    await svc.record_export(db, names, all_tables=not tables, actor=actor, ctx=ctx)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    scope = "database" if not tables else (names[0] if len(names) == 1 else "tables")
    filename = f"rhemapod-{scope}-{stamp}.json"
    return Response(
        content=json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        media_type="application/json; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/import", response_model=DataImportResponse)
async def import_data(
    body: DataImportRequest, user: AdminOnly, db: DbDep, ctx: AuditCtx
) -> DataImportResponse:
    """Destructive when `dry_run` is false. Always preview first: the dry run
    performs the whole import inside a transaction and rolls it back."""
    actor = await _actor(db, user)
    try:
        result = await svc.import_document(
            db, body.document,
            mode=body.mode, tables=body.tables, dry_run=body.dry_run,
            confirm=body.confirm, actor=actor, ctx=ctx,
        )
    except DataTransferError as exc:
        raise _err(exc)
    return DataImportResponse(
        mode=result.mode,
        dry_run=result.dry_run,
        tables=[DataImportTableResult(**r.__dict__) for r in result.tables],
    )


class DataResetRequest(BaseModel):
    tables: list[str] | None = Field(
        default=None,
        description="Tables to empty. Omit (or send an empty list) to wipe every table.",
    )
    dry_run: bool = True
    confirm: str | None = Field(
        default=None,
        description="Required when `dry_run` is false: `RESET` for chosen tables, "
        "`WIPE DATABASE` for everything.",
    )
    password: str | None = Field(
        default=None, max_length=256,
        description="Required when `dry_run` is false: the signed-in admin's password.",
    )


class DataResetTableResult(BaseModel):
    name: str
    deleted: int
    unlinked: int


class DataResetResponse(BaseModel):
    dry_run: bool
    all_tables: bool
    tables: list[DataResetTableResult]


@router.post("/reset", response_model=DataResetResponse)
async def reset_data(
    body: DataResetRequest, user: AdminOnly, db: DbDep, ctx: AuditCtx
) -> DataResetResponse:
    """Destructive when `dry_run` is false. Preview first: the dry run does
    the whole reset inside a transaction and rolls it back."""
    actor = await _actor(db, user)
    try:
        result = await svc.reset_tables(
            db, tables=body.tables, dry_run=body.dry_run, confirm=body.confirm,
            password=body.password, actor=actor, ctx=ctx,
        )
    except DataTransferError as exc:
        raise _err(exc)
    return DataResetResponse(
        dry_run=result.dry_run,
        all_tables=result.all_tables,
        tables=[DataResetTableResult(**r.__dict__) for r in result.tables],
    )
