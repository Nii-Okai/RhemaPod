"""Announcements.

Public reads are open to everyone, including anonymous callers — announcements
are church notices, not gated content. Writes are manager/admin only.
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, require_role
from app.db.database import get_db, get_read_db
from app.models.content_schemas import (
    AnnouncementAdminItem,
    Page,
    AnnouncementCreate,
    AnnouncementDetail,
    AnnouncementListItem,
    AnnouncementStatusResponse,
    AnnouncementUpdate,
    ThumbnailResponse,
    ThumbnailTicket,
    ThumbnailUploadRequest,
)
from app.models.models import AnnouncementStatus, User, UserRole
from app.services import announcement_service, auth_service
from app.services.content_service import ContentError

router = APIRouter(prefix="/announcements", tags=["announcements"])

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


# ═══════════════════════════════════════════════════════════════════════════════
# Public — no authentication required
# ═══════════════════════════════════════════════════════════════════════════════
@router.get("", response_model=list[AnnouncementListItem])
async def list_announcements(db: ReadDbDep) -> list[AnnouncementListItem]:
    """Live announcements, pinned first then newest."""
    rows = await announcement_service.list_visible(db)
    return [
        AnnouncementListItem(**announcement_service.to_public(a)) for a in rows
    ]


@router.get("/{announcement_id}", response_model=AnnouncementDetail)
async def get_announcement(
    announcement_id: uuid.UUID, db: ReadDbDep
) -> AnnouncementDetail:
    try:
        ann = await announcement_service.get_visible(db, announcement_id)
    except ContentError as exc:
        raise _err(exc)
    return AnnouncementDetail(**announcement_service.to_public(ann))


# ═══════════════════════════════════════════════════════════════════════════════
# Staff — manager/admin only
# ═══════════════════════════════════════════════════════════════════════════════
@router.get("/admin/all", response_model=Page[AnnouncementAdminItem])
async def list_all_announcements(
    user: EditorPlus,
    db: DbDep,
    status: AnnouncementStatus | None = None,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> Page[AnnouncementAdminItem]:
    """Every announcement including drafts and scheduled, with an optional
    `?status=` filter."""
    actor = await _actor(db, user)
    rows, total = await announcement_service.list_all(
        db, actor, status, limit=limit, offset=offset
    )
    return Page[AnnouncementAdminItem](
        items=[AnnouncementAdminItem(**announcement_service.to_admin(a)) for a in rows],
        total=total, limit=limit, offset=offset,
    )


@router.get("/admin/{announcement_id}", response_model=AnnouncementAdminItem)
async def get_any_announcement(
    announcement_id: uuid.UUID, user: ManagerPlus, db: DbDep
) -> AnnouncementAdminItem:
    try:
        ann = await announcement_service.get_any(db, announcement_id)
    except ContentError as exc:
        raise _err(exc)
    return AnnouncementAdminItem(**announcement_service.to_admin(ann))


@router.post(
    "", response_model=AnnouncementAdminItem, status_code=status.HTTP_201_CREATED
)
async def create_announcement(
    data: AnnouncementCreate, user: EditorPlus, db: DbDep
) -> AnnouncementAdminItem:
    """Create a draft. It becomes visible only after being published."""
    actor = await _actor(db, user)
    try:
        ann = await announcement_service.create(db, data.model_dump(), actor)
    except ContentError as exc:
        raise _err(exc)
    return AnnouncementAdminItem(**announcement_service.to_admin(ann))


@router.patch("/{announcement_id}", response_model=AnnouncementAdminItem)
async def update_announcement(
    announcement_id: uuid.UUID, data: AnnouncementUpdate, user: EditorPlus, db: DbDep
) -> AnnouncementAdminItem:
    actor = await _actor(db, user)
    try:
        ann = await announcement_service.update(
            db, announcement_id, data.model_dump(exclude_unset=True), actor
        )
    except ContentError as exc:
        raise _err(exc)
    return AnnouncementAdminItem(**announcement_service.to_admin(ann))


@router.delete("/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_announcement(
    announcement_id: uuid.UUID, user: EditorPlus, db: DbDep
) -> Response:
    actor = await _actor(db, user)
    try:
        await announcement_service.delete(db, announcement_id, actor)
    except ContentError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{announcement_id}/submit", response_model=AnnouncementStatusResponse)
async def submit_announcement(
    announcement_id: uuid.UUID, user: EditorPlus, db: DbDep
) -> AnnouncementStatusResponse:
    """Send a draft for review. Editors submit their own work."""
    return await _transition(announcement_id, "submit", user, db)


# ── Image ─────────────────────────────────────────────────────────────────────
@router.post(
    "/{announcement_id}/image-url",
    response_model=ThumbnailTicket,
    status_code=status.HTTP_201_CREATED,
)
async def announcement_image_url(
    announcement_id: uuid.UUID, data: ThumbnailUploadRequest,
    user: EditorPlus, db: DbDep,
) -> ThumbnailTicket:
    actor = await _actor(db, user)
    try:
        result = await announcement_service.create_image_ticket(
            db, announcement_id, actor, data.filename, data.content_type
        )
    except ContentError as exc:
        raise _err(exc)
    return ThumbnailTicket(**result)


@router.post("/{announcement_id}/image/confirm", response_model=ThumbnailResponse)
async def announcement_image_confirm(
    announcement_id: uuid.UUID, thumbnail_key: str, user: EditorPlus, db: DbDep
) -> ThumbnailResponse:
    actor = await _actor(db, user)
    try:
        url = await announcement_service.confirm_image(
            db, announcement_id, actor, thumbnail_key
        )
    except ContentError as exc:
        raise _err(exc)
    return ThumbnailResponse(thumbnail_url=url)
