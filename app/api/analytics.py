"""Playback progress (per user) and platform analytics (manager/admin)."""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, CurrentUserDep, require_role
from app.db.database import get_db, get_read_db
from app.models.content_schemas import (
    ContinueWatchingItem,
    OverviewStats,
    ProgressPublic,
    ProgressUpdate,
    TopSermonStat,
)
from app.models.models import User, UserRole
from app.services import analytics_service, auth_service, content_service
from app.services.content_service import ContentError

router = APIRouter(tags=["analytics"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ReadDbDep = Annotated[AsyncSession, Depends(get_read_db)]
ManagerPlus = Annotated[
    CurrentUser, Depends(require_role(UserRole.MANAGER, UserRole.ADMIN))
]


async def _actor(db: AsyncSession, current: CurrentUser) -> User:
    user = await auth_service.get_user_by_id(db, current.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


def _err(exc: ContentError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


# ── Playback progress ─────────────────────────────────────────────────────────
@router.post("/sermons/{sermon_id}/progress", response_model=ProgressPublic)
async def record_progress(
    sermon_id: uuid.UUID, data: ProgressUpdate, user: CurrentUserDep, db: DbDep
) -> ProgressPublic:
    """Called periodically during playback (every ~30s) and on pause/exit."""
    actor = await _actor(db, user)
    try:
        session = await analytics_service.record_progress(
            db, actor, sermon_id,
            position_seconds=data.position_seconds,
            watched_delta=data.watched_delta,
            completed=data.completed,
        )
    except ContentError as exc:
        raise _err(exc)
    return ProgressPublic.model_validate(session)


@router.get("/sermons/{sermon_id}/progress", response_model=ProgressPublic | None)
async def get_progress(
    sermon_id: uuid.UUID, user: CurrentUserDep, db: ReadDbDep
) -> ProgressPublic | None:
    """Resume position. Null when the sermon has never been played."""
    actor = await _actor(db, user)
    session = await analytics_service.get_progress(db, actor, sermon_id)
    return ProgressPublic.model_validate(session) if session else None


@router.get("/me/continue-watching", response_model=list[ContinueWatchingItem])
async def continue_watching(
    user: CurrentUserDep, db: ReadDbDep, limit: int = Query(default=10, ge=1, le=50)
) -> list[ContinueWatchingItem]:
    """Started but unfinished sermons, most recent first."""
    actor = await _actor(db, user)
    has_sub = await content_service._has_subscription(db, actor)
    rows = await analytics_service.continue_watching(db, actor, has_sub, limit)
    return [ContinueWatchingItem(**r) for r in rows]


@router.get("/me/history", response_model=list[ProgressPublic])
async def watch_history(
    user: CurrentUserDep, db: ReadDbDep, limit: int = Query(default=50, ge=1, le=100)
) -> list[ProgressPublic]:
    actor = await _actor(db, user)
    rows = await analytics_service.history(db, actor, limit)
    return [ProgressPublic.model_validate(r) for r in rows]


# ── Admin analytics ───────────────────────────────────────────────────────────
@router.get("/admin/analytics/overview", response_model=OverviewStats)
async def analytics_overview(user: ManagerPlus, db: ReadDbDep) -> OverviewStats:
    return OverviewStats(**await analytics_service.overview(db))


@router.get("/admin/analytics/top-sermons", response_model=list[TopSermonStat])
async def top_sermons(
    user: ManagerPlus, db: ReadDbDep, limit: int = Query(default=10, ge=1, le=50)
) -> list[TopSermonStat]:
    rows = await analytics_service.top_sermons(db, limit)
    return [TopSermonStat(**r) for r in rows]
