import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, require_role
from app.db.database import get_db, get_read_db
from app.models.content_schemas import (
    AnnouncementAdminItem,
    AnnouncementApprovalLogItem,
    AnnouncementRejectRequest,
    AnnouncementStatusResponse
)
from app.models.models import User, UserRole
from app.services import announcement_service, auth_service
from app.services.content_service import ContentError

router = APIRouter(prefix="/approvals/announcements", tags=["announcement approvals"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ReadDbDep = Annotated[AsyncSession, Depends(get_read_db)]
ManagerPlus = Annotated[
    CurrentUser, Depends(require_role(UserRole.MANAGER, UserRole.ADMIN))
]
EditorPlus = Annotated[
    CurrentUser,
    Depends(require_role(UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN)),
]


async def _actor(db: AsyncSession, current: CurrentUser) -> User:
    user = await auth_service.get_user_by_id(db, current.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


def _err(exc: ContentError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


async def _transition(
    announcement_id, action: str, user: CurrentUser, db: AsyncSession,
    note: str | None = None,
) -> AnnouncementStatusResponse:
    actor = await _actor(db, user)
    try:
        ann = await announcement_service.transition(
            db, announcement_id, action, actor, note=note
        )
    except ContentError as exc:
        raise _err(exc)
    return AnnouncementStatusResponse(id=ann.id, status=ann.status)



@router.get(
    "/review-queue", response_model=list[AnnouncementAdminItem]
)
async def review_queue(user: ManagerPlus, db: DbDep) -> list[AnnouncementAdminItem]:
    """Announcements waiting on a manager."""
    rows = await announcement_service.review_queue(db)
    return [AnnouncementAdminItem(**announcement_service.to_admin(a)) for a in rows]


@router.post("/{announcement_id}/approve", response_model=AnnouncementStatusResponse)
async def approve_announcement(
    announcement_id: uuid.UUID, user: ManagerPlus, db: DbDep
) -> AnnouncementStatusResponse:
    """Approve a submitted announcement. It is not public until published."""
    return await _transition(announcement_id, "approve", user, db)


@router.post("/{announcement_id}/reject", response_model=AnnouncementStatusResponse)
async def reject_announcement(
    announcement_id: uuid.UUID, body: AnnouncementRejectRequest,
    user: ManagerPlus, db: DbDep,
) -> AnnouncementStatusResponse:
    """Send it back to the editor with an optional note."""
    return await _transition(announcement_id, "reject", user, db, note=body.note)


@router.post("/{announcement_id}/publish", response_model=AnnouncementStatusResponse)
async def publish_announcement(
    announcement_id: uuid.UUID, user: ManagerPlus, db: DbDep
) -> AnnouncementStatusResponse:
    """Make an approved announcement public. With no publish_at it goes live
    immediately; with a future publish_at it appears at that time on its own."""
    return await _transition(announcement_id, "publish", user, db)


@router.post("/{announcement_id}/unpublish", response_model=AnnouncementStatusResponse)
async def unpublish_announcement(
    announcement_id: uuid.UUID, user: ManagerPlus, db: DbDep
) -> AnnouncementStatusResponse:
    """Pull it from public view, back to approved."""
    return await _transition(announcement_id, "unpublish", user, db)


@router.post("/{announcement_id}/archive", response_model=AnnouncementStatusResponse)
async def archive_announcement(
    announcement_id: uuid.UUID, user: ManagerPlus, db: DbDep
) -> AnnouncementStatusResponse:
    """Retire an announcement while keeping the record."""
    return await _transition(announcement_id, "archive", user, db)


@router.get(
    "/{announcement_id}/approval-log",
    response_model=list[AnnouncementApprovalLogItem],
)
async def approval_log(
    announcement_id: uuid.UUID, user: ManagerPlus, db: DbDep
) -> list[AnnouncementApprovalLogItem]:
    # Stays ManagerPlus (the sermon approval-log moved to EditorPlus in GATE 3
    # Batch 2): announcements have no per-editor ownership scoping, so there is
    # no "owning editor" who would need to read their own rejection note here.
    return await announcement_service.approval_history(db, announcement_id)
