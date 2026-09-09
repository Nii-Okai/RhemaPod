import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, require_role
from app.core.logging import get_logger
from app.db.database import get_db
from app.models.content_schemas import (
    ApprovalLogItem,
    Page,
    PublishResponse,
    RejectRequest,
    ReviewQueueItem,
    StatusResponse,
)
from app.models.models import User, UserRole
from app.services import auth_service, content_service, subscription_service
from app.services.content_service import ContentError

router = APIRouter(prefix="/approvals/sermons", tags=["sermon approvals"])
log = get_logger("sermon_approval")

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
@router.get("/review-queue", response_model=Page[ReviewQueueItem])
async def review_queue(
    user: ManagerPlus,
    db: DbDep,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> Page[ReviewQueueItem]:
    """Sermons waiting on a reviewer, longest-waiting first. Each row carries
    `status`, `submitted_at`, `renditions_ready` and (for under-review items)
    `review_claimed_by`, so the W10 screen can render "waiting N days", the
    >48h alert, and "Under review · <name>"."""
    items, total = await content_service.review_queue_page(
        db, limit=limit, offset=offset
    )
    return Page[ReviewQueueItem](
        items=items, total=total, limit=limit, offset=offset
    )


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


@router.post("/{sermon_id}/publish", response_model=PublishResponse)
async def publish(sermon_id: uuid.UUID, user: ManagerPlus, db: DbDep) -> PublishResponse:
    actor = await _actor(db, user)
    try:
        s = await content_service.transition(db, sermon_id, "publish", actor)
    except ContentError as exc:
        raise _err(exc)
    # The sermon is already published and committed — a failure counting
    # subscribers for the toast must not turn that into a 500 (whose retry
    # would then 409 on the published sermon). Degrade the count to 0.
    try:
        count = await subscription_service.count_active_paid_subscribers(db)
    except Exception:
        log.warning("publish_subscriber_count_failed", sermon_id=str(s.id))
        count = 0
    return PublishResponse(
        id=s.id, status=s.status, notified_subscriber_count=count
    )


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
    sermon_id: uuid.UUID, user: EditorPlus, db: DbDep
) -> list[ApprovalLogItem]:
    """Managers/admins read any sermon's log; an editor only their own (someone
    else's is 404). This is where an editor reads why their sermon was rejected."""
    actor = await _actor(db, user)
    try:
        return await content_service.approval_history_for_staff(db, sermon_id, actor)
    except ContentError as exc:
        raise _err(exc)
