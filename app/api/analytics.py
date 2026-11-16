"""Playback progress (per user) and platform analytics (manager/admin)."""
import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import AuditCtx, CurrentUser, CurrentUserDep, require_role
from app.db.database import get_db, get_read_db
from app.models.content_schemas import (
    ContinueWatchingItem,
    NewListenersBucket,
    OverviewStats,
    ProgressPublic,
    ProgressUpdate,
    SermonListItem,
    TopSermonStat,
    UsageReport,
)
from app.models.models import AuditAction, AuditOutcome, User, UserRole
from app.services import analytics_service, audit_service, auth_service, content_service
from app.services.audit_service import AuditTarget
from app.services.content_service import ContentError

router = APIRouter(tags=["analytics"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ReadDbDep = Annotated[AsyncSession, Depends(get_read_db)]
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


@router.get("/me/recommended", response_model=list[SermonListItem])
async def recommended_for_you(
    user: CurrentUserDep, db: ReadDbDep, limit: int = Query(default=10, ge=1, le=50)
) -> list[SermonListItem]:
    """Home's "Recommended for you" shelf — category/speaker affinity derived
    from the caller's own playback history (falls back to Trending when that
    history has nothing to work with; see
    `content_service.list_recommended_sermons`'s own docstring)."""
    actor = await _actor(db, user)
    return await content_service.list_recommended_sermons(db, actor, limit)


@router.get("/me/history", response_model=list[ProgressPublic])
async def watch_history(
    user: CurrentUserDep,
    db: ReadDbDep,
    limit: int = Query(default=50, ge=1, le=100),
    series_id: uuid.UUID | None = None,
) -> list[ProgressPublic]:
    """Unscoped: the caller's `limit`-capped history. `?series_id=<id>` (Decision
    6, `app/series/[id].tsx`'s per-episode status): every progress row for that
    series instead, `limit` ignored — see `analytics_service.history`'s own
    docstring for why."""
    actor = await _actor(db, user)
    rows = await analytics_service.history(db, actor, limit, series_id=series_id)
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


@router.get(
    "/admin/analytics/new-listeners", response_model=list[NewListenersBucket]
)
async def new_listeners(
    user: ManagerPlus, db: ReadDbDep
) -> list[NewListenersBucket]:
    """Weekly count of first-time listeners over the last 8 Monday-anchored ISO
    weeks (UTC), oldest first, zero-filled (plan §A.2, M1).

    Same `require_role(MANAGER, ADMIN)` guard as the rest of
    `/admin/analytics/*` — not relaxed for the editor Dashboard (§A.1). The
    window is a fixed 8 weeks; there is no query parameter.
    """
    rows = await analytics_service.new_listeners_weekly(db)
    return [NewListenersBucket(**r) for r in rows]


# ── Usage reports (plan-admin-settings §A.5, D1) ─────────────────────────────
Granularity = Literal["day", "week", "month"]
FromDate = Annotated[
    date, Query(alias="from", description="First day of the period (UTC), inclusive.")
]
ToDate = Annotated[
    date,
    Query(description="Day after the period ends (UTC), exclusive. At most 366 days after `from`."),
]


@router.get("/admin/analytics/report", response_model=UsageReport, response_model_by_alias=True)
async def usage_report(
    user: ManagerPlus,
    db: ReadDbDep,
    from_: FromDate,
    to: ToDate,
    granularity: Granularity = Query(default="week"),
) -> UsageReport:
    """KPIs, a bucketed series and top sermons for `[from, to)`. Managers
    may view; only admins may export (D1)."""
    try:
        report = await analytics_service.usage_report(db, from_, to, granularity)
    except ContentError as exc:
        raise _err(exc)
    return UsageReport.model_validate(report)


@router.get(
    "/admin/analytics/report/export",
    response_class=Response,
    responses={200: {"content": {"text/csv": {}}, "description": "UTF-8 CSV with BOM."}},
)
async def export_usage_report(
    user: AdminOnly,
    db: DbDep,
    ctx: AuditCtx,
    from_: FromDate,
    to: ToDate,
    kind: Literal["timeseries", "top_sermons"],
    granularity: Granularity = Query(default="week"),
) -> Response:
    """The report as CSV, admin only. Fail-closed: the `report.exported`
    audit row is committed before the file is returned, so a failed audit
    insert means no file. Every cell passes the spreadsheet formula guard
    (sermon titles are editor-controlled)."""
    try:
        report = await analytics_service.usage_report(db, from_, to, granularity)
    except ContentError as exc:
        raise _err(exc)
    body = analytics_service.report_csv(report, kind)

    actor = await _actor(db, user)
    await audit_service.record(
        db, AuditAction.REPORT_EXPORTED,
        actor=actor,
        target=AuditTarget(type="report", label=f"{kind} {from_}..{to}"),
        details={
            "kind": kind, "from": from_.isoformat(), "to": to.isoformat(),
            "granularity": granularity,
        },
        outcome=AuditOutcome.SUCCESS, ctx=ctx,
    )
    await db.commit()

    filename = f"rhemapod-{kind.replace('_', '-')}-{from_}-to-{to}.csv"
    return Response(
        content=body.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )
