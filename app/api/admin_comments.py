import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, require_role
from app.db.database import get_db
from app.models.content_schemas import (
    MAX_PAGE_SIZE,
    CommentAdmin,
    CommentAdminForEditor,
    ModerationReason,
    Page,
)
from app.models.models import CommentStatus, User, UserRole
from app.services import auth_service, comments_service
from app.services.content_service import ContentError

router = APIRouter(prefix="/admin/comments", tags=["admin-comments"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
EditorPlus = Annotated[
    CurrentUser,
    Depends(require_role(UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN)),
]
ManagerPlus = Annotated[
    CurrentUser, Depends(require_role(UserRole.MANAGER, UserRole.ADMIN))
]
AdminOnly = Annotated[CurrentUser, Depends(require_role(UserRole.ADMIN))]


async def _actor(db: AsyncSession, current: CurrentUser) -> User:
    user = await auth_service.get_user_by_id(db, current.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


def _err(exc: ContentError) -> HTTPException:
    return HTTPException(
        status_code=exc.status_code, detail=exc.message, headers=exc.headers or None
    )


@router.get("", response_model=Page[CommentAdmin] | Page[CommentAdminForEditor])
async def list_admin_comments(
    user: EditorPlus,
    db: DbDep,
    sermon_id: uuid.UUID | None = None,
    status: CommentStatus | None = None,
    reported_only: bool = False,
    needs_review: bool = Query(
        default=False,
        description="Auto-hidden, or visible with at least one report since the "
        "last restore. `limit=1` and the returned `total` give the nav badge count.",
    ),
    sort: comments_service.AdminSort = "recent",
    limit: int = Query(default=25, ge=1, le=MAX_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
) -> Page[CommentAdmin] | Page[CommentAdminForEditor]:
    """The moderation queue. An editor sees only comments on their own sermons
    (ADR-0004) and the rows carry no author email or id."""
    actor = await _actor(db, user)
    return await comments_service.list_admin_comments(
        db,
        actor,
        sermon_id=sermon_id,
        status=status,
        reported_only=reported_only,
        needs_review=needs_review,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.post("/{comment_id}/hide", response_model=CommentAdmin)
async def hide_comment(
    comment_id: uuid.UUID, data: ModerationReason, user: ManagerPlus, db: DbDep
) -> CommentAdmin:
    actor = await _actor(db, user)
    try:
        return await comments_service.hide_comment(db, actor, comment_id, data.reason)
    except ContentError as exc:
        raise _err(exc)


@router.post("/{comment_id}/restore", response_model=CommentAdmin)
async def restore_comment(
    comment_id: uuid.UUID, user: ManagerPlus, db: DbDep
) -> CommentAdmin:
    actor = await _actor(db, user)
    try:
        return await comments_service.restore_comment(db, actor, comment_id)
    except ContentError as exc:
        raise _err(exc)


@router.post("/{comment_id}/dismiss-reports", response_model=CommentAdmin)
async def dismiss_reports(
    comment_id: uuid.UUID,
    user: ManagerPlus,
    db: DbDep,
    data: ModerationReason,
) -> CommentAdmin:
    actor = await _actor(db, user)
    try:
        return await comments_service.dismiss_reports(
            db, actor, comment_id, data.reason
        )
    except ContentError as exc:
        raise _err(exc)


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def hard_delete_comment(
    comment_id: uuid.UUID, data: ModerationReason, user: AdminOnly, db: DbDep
) -> Response:
    """Admin only. The reason travels in a JSON body."""
    actor = await _actor(db, user)
    try:
        await comments_service.hard_delete_comment(db, actor, comment_id, data.reason)
    except ContentError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
