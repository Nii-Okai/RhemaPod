"""Unified audit trail, read-only (plan-admin-settings §A.5, D5, D7, D9).

Admin only: managers and editors get 403 at the dependency. View-only in v1:
there is no export (D5). The feed merges `audit_log` with the three domain
logs that predate it; see `audit_service.list_entries`.
"""
import uuid
from dataclasses import asdict
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, require_role
from app.db.database import get_read_db
from app.models.content_schemas import AuditEntry, Page
from app.models.models import AuditOutcome, UserRole
from app.services import audit_service
from app.services.audit_service import AuditFilters

router = APIRouter(prefix="/admin/audit", tags=["admin audit"])

ReadDbDep = Annotated[AsyncSession, Depends(get_read_db)]
AdminOnly = Annotated[CurrentUser, Depends(require_role(UserRole.ADMIN))]

AuditCategory = Literal[
    "auth", "users", "settings", "reports", "sermons", "announcements", "moderation"
]


@router.get("", response_model=Page[AuditEntry])
async def list_audit(
    user: AdminOnly,
    db: ReadDbDep,
    actor_id: uuid.UUID | None = Query(default=None),
    action: list[str] = Query(
        default=[],
        description="Repeatable. Exact action names, e.g. `auth.login`, "
        "`sermon.status_changed`, `comment.hide`.",
    ),
    category: AuditCategory | None = Query(default=None),
    staff_only: bool = Query(
        default=True,
        description="Only actions taken by staff accounts. Viewer sign-ins and "
        "a viewer deleting their own comment drop out; staff and system "
        "moderation stay.",
    ),
    target_type: str | None = Query(default=None, max_length=30),
    target_id: uuid.UUID | None = Query(default=None),
    outcome: AuditOutcome | None = Query(default=None),
    from_: datetime | None = Query(
        default=None, alias="from", description="Inclusive lower bound (UTC)."
    ),
    to: datetime | None = Query(default=None, description="Exclusive upper bound (UTC)."),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> Page[AuditEntry]:
    """Newest first, `(created_at DESC, id DESC)`. `from`/`to` are half-open
    `[from, to)`. `total` is the filtered count before paging."""
    rows, total = await audit_service.list_entries(
        db,
        AuditFilters(
            actor_id=actor_id,
            actions=tuple(action),
            category=category,
            staff_only=staff_only,
            target_type=target_type,
            target_id=target_id,
            outcome=outcome,
            from_=from_,
            to=to,
        ),
        limit=limit,
        offset=offset,
    )
    return Page[AuditEntry](
        items=[AuditEntry(**asdict(r)) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
