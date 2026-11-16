"""Daily devotional ("Daily Rhema") — plans/plan-daily-devotional.md, ADR 0022.

Public reads are open to everyone, including anonymous callers (devotional
content, like verses and announcements). The listener's app sends its own
local date; the server only bounds it (see `devotional_service.check_window`).

Staff routes mirror announcements: editors write and submit their own drafts,
managers and admins review, approve, archive and import straight to approved.
"""
import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import AuditCtx, CurrentUser, require_role
from app.db.database import get_db, get_read_db
from app.models.devotional_schemas import (
    DevotionalAdminItem,
    DevotionalApprovalLogItem,
    DevotionalCalendar,
    DevotionalCreate,
    DevotionalListItem,
    DevotionalPublic,
    DevotionalRejectRequest,
    DevotionalSettings,
    DevotionalSettingsUpdate,
    DevotionalStatusResponse,
    DevotionalUpdate,
    ImportResult,
    PassageLookup,
    ReadingConfirm,
    ReadingTicket,
    ReadingUploadRequest,
)
from app.models.content_schemas import Page
from app.models.models import DevotionalStatus, User, UserRole
from app.services import auth_service, devotional_service
from app.services.content_service import ContentError

router = APIRouter(prefix="/devotionals", tags=["devotionals"])
approvals_router = APIRouter(prefix="/approvals/devotionals", tags=["devotional approvals"])
settings_router = APIRouter(prefix="/admin/settings/devotionals", tags=["admin settings"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ReadDbDep = Annotated[AsyncSession, Depends(get_read_db)]
ManagerPlus = Annotated[
    CurrentUser, Depends(require_role(UserRole.MANAGER, UserRole.ADMIN))
]
EditorPlus = Annotated[
    CurrentUser,
    Depends(require_role(UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN)),
]

MAX_IMPORT_BYTES = 2 * 1024 * 1024


async def _actor(db: AsyncSession, current: CurrentUser) -> User:
    user = await auth_service.get_user_by_id(db, current.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


def _err(exc: ContentError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


async def _admin_item(db: AsyncSession, dev) -> DevotionalAdminItem:
    return DevotionalAdminItem(**await devotional_service.to_admin(db, dev))


# ═══════════════════════════════════════════════════════════════════════════════
# Public
# ═══════════════════════════════════════════════════════════════════════════════
@router.get("/day/{day}", response_model=DevotionalPublic)
async def devotional_for_day(day: date, db: ReadDbDep) -> DevotionalPublic:
    """The devotional for the caller's local `day` (YYYY-MM-DD): the one
    scheduled for that date, else one from the evergreen pool."""
    try:
        dev, source = await devotional_service.get_for_date(db, day)
        church = await devotional_service.load_settings(db)
    except ContentError as exc:
        raise _err(exc)
    return DevotionalPublic(
        **await devotional_service.to_public(db, dev, day, source, church)
    )


@router.get("/days", response_model=list[DevotionalPublic])
async def devotionals_for_days(
    db: ReadDbDep,
    start: Annotated[date, Query(alias="from")],
    count: Annotated[int, Query(ge=1, le=devotional_service.PREFETCH_DAYS + 1)] = 7,
) -> list[DevotionalPublic]:
    """Consecutive days from `from` for offline prefetch. Days with nothing to
    show (no dated devotional and an empty evergreen pool) are left out."""
    from datetime import timedelta

    days = [start + timedelta(days=i) for i in range(count)]
    try:
        for day in (days[0], days[-1]):
            devotional_service.check_window(day)
        found = await devotional_service.get_for_dates(db, days)
        church = await devotional_service.load_settings(db)
    except ContentError as exc:
        raise _err(exc)
    return [
        DevotionalPublic(**await devotional_service.to_public(db, dev, day, source, church))
        for day, dev, source in found
    ]


# ═══════════════════════════════════════════════════════════════════════════════
# Staff
# ═══════════════════════════════════════════════════════════════════════════════
@router.get("/admin/all", response_model=Page[DevotionalListItem])
async def list_devotionals(
    user: EditorPlus,
    db: DbDep,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
    status_filter: Annotated[DevotionalStatus | None, Query(alias="status")] = None,
    evergreen: bool | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> Page[DevotionalListItem]:
    actor = await _actor(db, user)
    rows, total = await devotional_service.list_all(
        db, actor, date_from=date_from, date_to=date_to,
        status_filter=status_filter, evergreen=evergreen, limit=limit, offset=offset,
    )
    return Page[DevotionalListItem](
        items=[DevotionalListItem(**devotional_service.to_list_item(d)) for d in rows],
        total=total, limit=limit, offset=offset,
    )


@router.get("/admin/calendar", response_model=DevotionalCalendar)
async def devotional_calendar(
    user: EditorPlus,
    db: DbDep,
    date_from: Annotated[date, Query(alias="from")],
    date_to: Annotated[date, Query(alias="to")],
) -> DevotionalCalendar:
    actor = await _actor(db, user)
    try:
        body = await devotional_service.calendar(db, actor, date_from, date_to)
    except ContentError as exc:
        raise _err(exc)
    return DevotionalCalendar(**body)


@router.get("/admin/passage", response_model=PassageLookup)
async def lookup_passage(
    _user: EditorPlus,
    ref: Annotated[str, Query(min_length=1, max_length=100)],
    translation: Annotated[str, Query(min_length=1, max_length=20)] = "kjv",
) -> PassageLookup:
    """Fill the passage text from a reference (KJV/WEB, via bible-api.com)."""
    try:
        return PassageLookup(**await devotional_service.lookup_passage(ref, translation))
    except ContentError as exc:
        raise _err(exc)


@router.get("/admin/import/template", response_class=Response)
async def import_template(_user: EditorPlus) -> Response:
    return Response(
        content=devotional_service.import_template(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="devotionals-template.csv"'},
    )


@router.post(
    "/admin/import",
    response_model=ImportResult,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"text/csv": {"schema": {"type": "string"}}},
        }
    },
)
async def import_devotionals(
    request: Request,
    user: EditorPlus,
    db: DbDep,
    dry_run: bool = True,
    as_status: Annotated[Literal["draft", "approved"], Query(alias="as")] = "draft",
    on_clash: Literal["skip", "replace_draft", "to_pool"] = "skip",
) -> ImportResult:
    """Import devotionals from a CSV body (`Content-Type: text/csv`). Run with
    `dry_run=true` (the default) to check every row, then `dry_run=false` to
    save. Rows with errors are never saved."""
    raw = await request.body()
    if len(raw) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="The file is larger than 2 MB")
    actor = await _actor(db, user)
    try:
        return await devotional_service.import_csv(
            db, raw, actor, dry_run=dry_run, as_status=as_status, on_clash=on_clash
        )
    except ContentError as exc:
        raise _err(exc)


@router.get("/admin/{devotional_id}", response_model=DevotionalAdminItem)
async def get_devotional(
    devotional_id: uuid.UUID, user: EditorPlus, db: DbDep
) -> DevotionalAdminItem:
    actor = await _actor(db, user)
    try:
        dev = await devotional_service.get_for_staff(db, devotional_id, actor)
    except ContentError as exc:
        raise _err(exc)
    return await _admin_item(db, dev)


@router.get("/admin/{devotional_id}/history", response_model=list[DevotionalApprovalLogItem])
async def devotional_history(
    devotional_id: uuid.UUID, user: EditorPlus, db: DbDep
) -> list[DevotionalApprovalLogItem]:
    actor = await _actor(db, user)
    try:
        await devotional_service.get_for_staff(db, devotional_id, actor)
    except ContentError as exc:
        raise _err(exc)
    return await devotional_service.approval_history(db, devotional_id)


@router.post("", response_model=DevotionalAdminItem, status_code=status.HTTP_201_CREATED)
async def create_devotional(
    data: DevotionalCreate, user: EditorPlus, db: DbDep
) -> DevotionalAdminItem:
    """Create a draft. `date` null puts it in the evergreen pool."""
    actor = await _actor(db, user)
    try:
        dev = await devotional_service.create(db, data.model_dump(), actor)
    except ContentError as exc:
        raise _err(exc)
    return await _admin_item(db, dev)


@router.patch("/{devotional_id}", response_model=DevotionalAdminItem)
async def update_devotional(
    devotional_id: uuid.UUID, data: DevotionalUpdate, user: EditorPlus, db: DbDep
) -> DevotionalAdminItem:
    actor = await _actor(db, user)
    try:
        dev = await devotional_service.update(
            db, devotional_id, data.model_dump(exclude_unset=True), actor
        )
    except ContentError as exc:
        raise _err(exc)
    return await _admin_item(db, dev)


@router.delete("/{devotional_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_devotional(
    devotional_id: uuid.UUID, user: EditorPlus, db: DbDep
) -> Response:
    actor = await _actor(db, user)
    try:
        await devotional_service.delete(db, devotional_id, actor)
    except ContentError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _transition(
    devotional_id: uuid.UUID, action: str, user: CurrentUser, db: AsyncSession,
    note: str | None = None,
) -> DevotionalStatusResponse:
    actor = await _actor(db, user)
    try:
        dev = await devotional_service.transition(db, devotional_id, action, actor, note=note)
    except ContentError as exc:
        raise _err(exc)
    return DevotionalStatusResponse(id=dev.id, status=dev.status)


@router.post("/{devotional_id}/submit", response_model=DevotionalStatusResponse)
async def submit_devotional(
    devotional_id: uuid.UUID, user: EditorPlus, db: DbDep
) -> DevotionalStatusResponse:
    return await _transition(devotional_id, "submit", user, db)


@router.post("/{devotional_id}/withdraw", response_model=DevotionalStatusResponse)
async def withdraw_devotional(
    devotional_id: uuid.UUID, user: EditorPlus, db: DbDep
) -> DevotionalStatusResponse:
    return await _transition(devotional_id, "withdraw", user, db)


# ── Pastor's reading ──────────────────────────────────────────────────────────
@router.post(
    "/{devotional_id}/reading-url",
    response_model=ReadingTicket,
    status_code=status.HTTP_201_CREATED,
)
async def reading_upload_url(
    devotional_id: uuid.UUID, data: ReadingUploadRequest, user: EditorPlus, db: DbDep
) -> ReadingTicket:
    actor = await _actor(db, user)
    try:
        ticket = await devotional_service.create_reading_ticket(
            db, devotional_id, actor, data.filename, data.content_type
        )
    except ContentError as exc:
        raise _err(exc)
    return ReadingTicket(**ticket)


@router.post("/{devotional_id}/reading/confirm", response_model=DevotionalAdminItem)
async def reading_confirm(
    devotional_id: uuid.UUID, data: ReadingConfirm, user: EditorPlus, db: DbDep
) -> DevotionalAdminItem:
    actor = await _actor(db, user)
    try:
        dev = await devotional_service.confirm_reading(
            db, devotional_id, actor, data.reading_key, data.duration_s
        )
    except ContentError as exc:
        raise _err(exc)
    return await _admin_item(db, dev)


@router.delete("/{devotional_id}/reading", response_model=DevotionalAdminItem)
async def reading_remove(
    devotional_id: uuid.UUID, user: EditorPlus, db: DbDep
) -> DevotionalAdminItem:
    actor = await _actor(db, user)
    try:
        dev = await devotional_service.remove_reading(db, devotional_id, actor)
    except ContentError as exc:
        raise _err(exc)
    return await _admin_item(db, dev)


# ═══════════════════════════════════════════════════════════════════════════════
# Review (manager/admin)
# ═══════════════════════════════════════════════════════════════════════════════
@approvals_router.get("/review-queue", response_model=list[DevotionalListItem])
async def devotional_review_queue(_user: ManagerPlus, db: DbDep) -> list[DevotionalListItem]:
    rows = await devotional_service.review_queue(db)
    return [DevotionalListItem(**devotional_service.to_list_item(d)) for d in rows]


@approvals_router.post("/{devotional_id}/approve", response_model=DevotionalStatusResponse)
async def approve_devotional(
    devotional_id: uuid.UUID, user: ManagerPlus, db: DbDep
) -> DevotionalStatusResponse:
    return await _transition(devotional_id, "approve", user, db)


@approvals_router.post("/{devotional_id}/reject", response_model=DevotionalStatusResponse)
async def reject_devotional(
    devotional_id: uuid.UUID, data: DevotionalRejectRequest, user: ManagerPlus, db: DbDep
) -> DevotionalStatusResponse:
    return await _transition(devotional_id, "reject", user, db, note=data.note)


@approvals_router.post("/{devotional_id}/archive", response_model=DevotionalStatusResponse)
async def archive_devotional(
    devotional_id: uuid.UUID, user: ManagerPlus, db: DbDep
) -> DevotionalStatusResponse:
    return await _transition(devotional_id, "archive", user, db)


@approvals_router.post("/{devotional_id}/restore", response_model=DevotionalStatusResponse)
async def restore_devotional(
    devotional_id: uuid.UUID, user: ManagerPlus, db: DbDep
) -> DevotionalStatusResponse:
    return await _transition(devotional_id, "restore", user, db)


# ═══════════════════════════════════════════════════════════════════════════════
# Settings › Devotionals (manager/admin)
# ═══════════════════════════════════════════════════════════════════════════════
@settings_router.get("", response_model=DevotionalSettings)
async def get_devotional_settings(_user: ManagerPlus, db: DbDep) -> DevotionalSettings:
    try:
        return await devotional_service.get_settings_dto(db)
    except ContentError as exc:
        raise _err(exc)


@settings_router.patch("", response_model=DevotionalSettings)
async def update_devotional_settings(
    data: DevotionalSettingsUpdate, user: ManagerPlus, db: DbDep, ctx: AuditCtx
) -> DevotionalSettings:
    actor = await _actor(db, user)
    try:
        return await devotional_service.update_settings(db, data, actor, ctx)
    except ContentError as exc:
        raise _err(exc)
