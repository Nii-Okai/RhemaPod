import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, require_role
from app.db.database import get_db
from app.models.content_schemas import (
    ApprovalLogItem,
    RejectRequest,
    SermonListItem,
    StatusResponse,
)
from app.models.models import Series, User, UserRole
from app.services import auth_service, content_service
from app.services.content_service import ContentError, effective_tier, to_list_item

router = APIRouter(prefix="/approvals/sermons", tags=["sermon approvals"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

EditorPlus = Annotated[CurrentUser, Depends(require_role(UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN))]
ManagerPlus = Annotated[CurrentUser, Depends(require_role(UserRole.MANAGER, UserRole.ADMIN))]


async def _actor(db: AsyncSession, current: CurrentUser) -> User:
    """Load the ORM User for service calls that need the full row."""
    user = await auth_service.get_user_by_id(db, current.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


def _err(exc: ContentError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


# Review queue (managers/admins)
@router.get("/review-queue", response_model=list[SermonListItem])
async def review_queue(user: ManagerPlus, db: DbDep) -> list[SermonListItem]:
    rows = await content_service.review_queue(db)
    series_map: dict = {}
    for s in rows:
        if s.series_id and s.series_id not in series_map:
            series_map[s.series_id] = await db.get(Series, s.series_id)
    return [
        to_list_item(s, effective_tier(s, series_map.get(s.series_id)), has_subscription=True)
        for s in rows
    ]


@router.post("/{sermon_id}/start-review", response_model=StatusResponse)
async def start_review(sermon_id: uuid.UUID, user: ManagerPlus, db: DbDep) -> StatusResponse:
    actor = await _actor(db, user)
    try:
        s = await content_service.transition(db, sermon_id, "start_review", actor)
    except ContentError as exc:
        raise _err(exc)
    return StatusResponse(id=s.id, status=s.status)


@router.post("/{sermon_id}/approve", response_model=StatusResponse)
async def approve(sermon_id: uuid.UUID, user: ManagerPlus, db: DbDep) -> StatusResponse:
    actor = await _actor(db, user)
    try:
        s = await content_service.transition(db, sermon_id, "approve", actor)
    except ContentError as exc:
        raise _err(exc)
    return StatusResponse(id=s.id, status=s.status)


@router.post("/{sermon_id}/reject", response_model=StatusResponse)
async def reject(
    sermon_id: uuid.UUID, body: RejectRequest, user: ManagerPlus, db: DbDep
) -> StatusResponse:
    actor = await _actor(db, user)
    try:
        s = await content_service.transition(db, sermon_id, "reject", actor, note=body.note)
    except ContentError as exc:
        raise _err(exc)
    return StatusResponse(id=s.id, status=s.status)


@router.post("/{sermon_id}/publish", response_model=StatusResponse)
async def publish(sermon_id: uuid.UUID, user: ManagerPlus, db: DbDep) -> StatusResponse:
    actor = await _actor(db, user)
    try:
        s = await content_service.transition(db, sermon_id, "publish", actor)
    except ContentError as exc:
        raise _err(exc)
    return StatusResponse(id=s.id, status=s.status)


@router.post("/{sermon_id}/unpublish", response_model=StatusResponse)
async def unpublish(sermon_id: uuid.UUID, user: ManagerPlus, db: DbDep) -> StatusResponse:
    actor = await _actor(db, user)
    try:
        s = await content_service.transition(db, sermon_id, "unpublish", actor)
    except ContentError as exc:
        raise _err(exc)
    return StatusResponse(id=s.id, status=s.status)


@router.get("/{sermon_id}/approval-log", response_model=list[ApprovalLogItem])
async def approval_log(
    sermon_id: uuid.UUID, user: ManagerPlus, db: DbDep
) -> list[ApprovalLogItem]:
    return await content_service.approval_history(db, sermon_id)
