"""Playback progress and admin analytics.

Progress is stored as one upserted row per user per sermon rather than an event
stream. That answers the two questions this app actually has — "where did I get
to" and "how is this sermon performing" — without the storage and aggregation
cost of a full event pipeline.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import case, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.models import (
    PAID_TIERS,
    PlaybackSession,
    Sermon,
    SermonStatus,
    Series,
    Subscription,
    SubscriptionStatus,
    User,
)
from app.services.content_service import ContentError, effective_tier, to_list_item

log = get_logger("analytics")

# Treat a sermon as finished at 90% — trailing credits or a slow outro mean
# almost nobody reaches 100%, and counting only those would understate reach.
COMPLETION_THRESHOLD = 0.9


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def record_progress(
    db: AsyncSession,
    user: User,
    sermon_id: uuid.UUID,
    position_seconds: int,
    watched_delta: int = 0,
    completed: bool | None = None,
) -> PlaybackSession:
    sermon = (await db.execute(
        select(Sermon).where(Sermon.id == sermon_id)
    )).scalar_one_or_none()
    if sermon is None or sermon.status != SermonStatus.PUBLISHED:
        raise ContentError("Sermon not found", status_code=404)

    # Self-reported position is clamped to the sermon's real length when we know
    # it, so a client cannot inflate "furthest reached" past the end. The
    # client-settable `completed` flag has the same trust problem but clearing
    # it needs a product decision, not a code change — left alone here.
    if sermon.duration_seconds:
        position_seconds = min(position_seconds, sermon.duration_seconds)

    # Whether this ping marks the sermon finished. A function of the request and
    # the sermon's duration, not of the stored row — so it is derived here and
    # then OR-ed into the stored flag SQL-side (stickiness: a restart must never
    # un-finish a sermon).
    if completed is not None:
        marks_completed = completed
    elif sermon.duration_seconds:
        marks_completed = (
            position_seconds >= sermon.duration_seconds * COMPLETION_THRESHOLD
        )
    else:
        marks_completed = False

    now = _now()

    # A single INSERT ... ON CONFLICT (user_id, sermon_id) DO UPDATE. There is no
    # dialect-neutral upsert in SQLAlchemy 2.0, so the insert() function is
    # chosen on the dialect (same shape as search_service._is_postgres);
    # production runs the postgresql arm, the suite exercises the sqlite arm.
    # One `set_` clause is built and handed to whichever construct was picked so
    # the two arms cannot drift in their update semantics.
    insert_fn = (
        pg_insert if db.bind.dialect.name == "postgresql" else sqlite_insert
    )
    stmt = insert_fn(PlaybackSession).values(
        user_id=user.id,
        sermon_id=sermon_id,
        position_seconds=position_seconds,
        watched_seconds=watched_delta,
        completed=marks_completed,
        play_count=1,
        last_played_at=now,
    )
    col = PlaybackSession
    incoming = stmt.excluded
    # A large backward jump (>60s) is a deliberate restart, not a scrub:
    #   * play_count increments;
    #   * position follows the viewer back to the start (wins outright).
    # Any other ping takes the max against the stored position, which discards
    # an out-of-order or concurrent late ping. GREATEST / max(a, b) is spelled
    # differently across the two dialects, so this is a case() instead.
    is_restart = incoming.position_seconds < col.position_seconds - 60
    stmt = stmt.on_conflict_do_update(
        index_elements=["user_id", "sermon_id"],
        set_={
            # SQL-side accumulation — a Python read-modify-write here loses
            # increments under concurrency, which is the bug being fixed.
            "watched_seconds": col.watched_seconds + watched_delta,
            "play_count": case(
                (is_restart, col.play_count + 1), else_=col.play_count
            ),
            "position_seconds": case(
                (is_restart, incoming.position_seconds),
                (col.position_seconds > incoming.position_seconds,
                 col.position_seconds),
                else_=incoming.position_seconds,
            ),
            # Sticky: once true, stays true.
            "completed": col.completed | incoming.completed,
            "last_played_at": now,
        },
    )
    await db.execute(stmt)
    await db.commit()

    # RETURNING is not portable across both dialects here; re-read the row and
    # return that. One extra round-trip buys a single code path.
    return (await db.execute(
        select(PlaybackSession).where(
            PlaybackSession.user_id == user.id,
            PlaybackSession.sermon_id == sermon_id,
        )
    )).scalar_one()


async def get_progress(
    db: AsyncSession, user: User, sermon_id: uuid.UUID
) -> PlaybackSession | None:
    return (await db.execute(
        select(PlaybackSession).where(
            PlaybackSession.user_id == user.id,
            PlaybackSession.sermon_id == sermon_id,
        )
    )).scalar_one_or_none()


async def continue_watching(
    db: AsyncSession, user: User, has_subscription: bool, limit: int = 10
) -> list[dict]:
    """Started but unfinished sermons, most recent first."""
    rows = (await db.execute(
        select(PlaybackSession, Sermon)
        .join(Sermon, Sermon.id == PlaybackSession.sermon_id)
        .where(
            PlaybackSession.user_id == user.id,
            PlaybackSession.completed.is_(False),
            PlaybackSession.position_seconds > 0,
            Sermon.status == SermonStatus.PUBLISHED,
        )
        .order_by(PlaybackSession.last_played_at.desc())
        .limit(max(1, min(limit, 50)))
    )).all()

    series_ids = {s.series_id for _, s in rows if s.series_id}
    series_map = {}
    if series_ids:
        found = (await db.execute(
            select(Series).where(Series.id.in_(series_ids))
        )).scalars().all()
        series_map = {s.id: s for s in found}

    items = []
    for session, sermon in rows:
        base = to_list_item(
            sermon, effective_tier(sermon, series_map.get(sermon.series_id)),
            has_subscription,
        )
        percent = None
        if sermon.duration_seconds:
            percent = min(
                100, round(session.position_seconds / sermon.duration_seconds * 100)
            )
        items.append({
            **base.model_dump(),
            "position_seconds": session.position_seconds,
            "percent_complete": percent,
            "last_played_at": session.last_played_at,
        })
    return items


async def history(
    db: AsyncSession, user: User, limit: int = 50
) -> list[PlaybackSession]:
    rows = (await db.execute(
        select(PlaybackSession)
        .where(PlaybackSession.user_id == user.id)
        .order_by(PlaybackSession.last_played_at.desc())
        .limit(max(1, min(limit, 100)))
    )).scalars().all()
    return list(rows)


# ── Admin analytics ───────────────────────────────────────────────────────────
async def overview(db: AsyncSession) -> dict:
    total_users = (await db.execute(
        select(func.count()).select_from(User)
    )).scalar_one()

    # Same cohort as subscription_service._PAID_SUBSCRIBER_STATUSES (ACTIVE +
    # CANCELLED, PAST_DUE excluded) — keep these two in step or the overview
    # figure and the publish toast disagree.
    active_subs = (await db.execute(
        select(func.count()).select_from(Subscription).where(
            Subscription.tier.in_(PAID_TIERS),
            Subscription.status.in_(
                (SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED)
            ),
        )
    )).scalar_one()

    published = (await db.execute(
        select(func.count()).select_from(Sermon).where(
            Sermon.status == SermonStatus.PUBLISHED
        )
    )).scalar_one()

    total_plays = (await db.execute(
        select(func.coalesce(func.sum(PlaybackSession.play_count), 0))
    )).scalar_one()

    unique_viewers = (await db.execute(
        select(func.count(func.distinct(PlaybackSession.user_id)))
    )).scalar_one()

    completions = (await db.execute(
        select(func.count()).select_from(PlaybackSession).where(
            PlaybackSession.completed.is_(True)
        )
    )).scalar_one()

    sessions = (await db.execute(
        select(func.count()).select_from(PlaybackSession)
    )).scalar_one()

    week_ago = _now() - timedelta(days=7)
    recent = (await db.execute(
        select(func.count()).select_from(PlaybackSession).where(
            PlaybackSession.last_played_at >= week_ago
        )
    )).scalar_one()

    return {
        "total_users": total_users,
        "active_subscribers": active_subs,
        "published_sermons": published,
        "total_plays": int(total_plays or 0),
        "unique_viewers": unique_viewers,
        "completions": completions,
        "completion_rate": round(completions / sessions, 3) if sessions else 0.0,
        "plays_last_7_days": recent,
    }


async def top_sermons(db: AsyncSession, limit: int = 10) -> list[dict]:
    limit = max(1, min(limit, 50))
    rows = (await db.execute(
        select(
            Sermon.id,
            Sermon.title,
            func.coalesce(func.sum(PlaybackSession.play_count), 0).label("plays"),
            func.count(func.distinct(PlaybackSession.user_id)).label("viewers"),
            func.sum(
                func.cast(PlaybackSession.completed, __import__("sqlalchemy").Integer)
            ).label("completions"),
        )
        .join(PlaybackSession, PlaybackSession.sermon_id == Sermon.id)
        .group_by(Sermon.id, Sermon.title)
        .order_by(func.coalesce(func.sum(PlaybackSession.play_count), 0).desc())
        .limit(limit)
    )).all()

    out = []
    for sermon_id, title, plays, viewers, completions in rows:
        completions = int(completions or 0)
        out.append({
            "sermon_id": sermon_id,
            "title": title,
            "plays": int(plays or 0),
            "unique_viewers": int(viewers or 0),
            "completions": completions,
            "completion_rate": round(completions / viewers, 3) if viewers else 0.0,
        })
    return out
