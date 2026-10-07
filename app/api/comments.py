import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, CurrentUserDep
from app.db.database import get_db
from app.models.content_schemas import (
    MAX_PAGE_SIZE,
    BlockCreated,
    BlockPublic,
    CommentCreate,
    CommentPublic,
    CommentReportCreate,
    Page,
)
from app.models.models import User
from app.services import auth_service, comments_service
from app.services.content_service import ContentError

router = APIRouter(tags=["comments"])

# Always the primary: a viewer must read their own just-posted comment, and
# the block / hidden filters must not lag behind a write.
DbDep = Annotated[AsyncSession, Depends(get_db)]


async def _actor(db: AsyncSession, current: CurrentUser) -> User:
    user = await auth_service.get_user_by_id(db, current.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


def _err(exc: ContentError) -> HTTPException:
    # Same structured body playback returns, so a client branches once.
    if exc.status_code == 403 and exc.message == "upgrade_required":
        return HTTPException(
            status_code=403,
            detail={"upgrade_required": True, "reason": "subscription_needed"},
        )
    return HTTPException(
        status_code=exc.status_code, detail=exc.message, headers=exc.headers or None
    )


@router.get("/sermons/{sermon_id}/comments", response_model=Page[CommentPublic])
async def list_sermon_comments(
    sermon_id: uuid.UUID,
    user: CurrentUserDep,
    db: DbDep,
    limit: int = Query(default=25, ge=1, le=MAX_PAGE_SIZE),
    offset: int = Query(default=0, ge=0),
) -> Page[CommentPublic]:
    actor = await _actor(db, user)
    try:
        return await comments_service.list_comments(db, actor, sermon_id, limit, offset)
    except ContentError as exc:
        raise _err(exc)


@router.post(
    "/sermons/{sermon_id}/comments",
    response_model=CommentPublic,
    status_code=status.HTTP_201_CREATED,
)
async def post_sermon_comment(
    sermon_id: uuid.UUID, data: CommentCreate, user: CurrentUserDep, db: DbDep
) -> CommentPublic:
    actor = await _actor(db, user)
    try:
        return await comments_service.post_comment(db, actor, sermon_id, data)
    except ContentError as exc:
        raise _err(exc)


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_own_comment(
    comment_id: uuid.UUID, user: CurrentUserDep, db: DbDep
) -> Response:
    actor = await _actor(db, user)
    try:
        await comments_service.delete_own_comment(db, actor, comment_id)
    except ContentError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/comments/{comment_id}/report", status_code=status.HTTP_204_NO_CONTENT)
async def report_comment(
    comment_id: uuid.UUID, data: CommentReportCreate, user: CurrentUserDep, db: DbDep
) -> Response:
    actor = await _actor(db, user)
    try:
        await comments_service.report_comment(db, actor, comment_id, data)
    except ContentError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/comments/{comment_id}/block", response_model=BlockCreated)
async def block_comment_author(
    comment_id: uuid.UUID, user: CurrentUserDep, db: DbDep
) -> BlockCreated:
    actor = await _actor(db, user)
    try:
        return await comments_service.block_author(db, actor, comment_id)
    except ContentError as exc:
        raise _err(exc)


@router.get("/me/blocks", response_model=list[BlockPublic])
async def list_my_blocks(user: CurrentUserDep, db: DbDep) -> list[BlockPublic]:
    actor = await _actor(db, user)
    return await comments_service.list_blocks(db, actor)


@router.delete("/me/blocks/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_block(
    block_id: uuid.UUID, user: CurrentUserDep, db: DbDep
) -> Response:
    actor = await _actor(db, user)
    try:
        await comments_service.unblock(db, actor, block_id)
    except ContentError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/me/comments-terms", status_code=status.HTTP_204_NO_CONTENT)
async def accept_comments_terms(user: CurrentUserDep, db: DbDep) -> Response:
    actor = await _actor(db, user)
    try:
        await comments_service.accept_terms(db, actor)
    except ContentError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
