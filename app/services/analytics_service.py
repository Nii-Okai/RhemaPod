"""Playback progress and admin analytics.

Progress is stored as one upserted row per user per sermon rather than an event
stream. That answers the two questions this app actually has — "where did I get
to" and "how is this sermon performing" — without the storage and aggregation
cost of a full event pipeline.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import and_, case, func, select
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


# Number of weekly buckets the "new listeners" series returns. Hardcoded on
# purpose (plan §A.2, resolved decision 1): no query parameter, so the cut
# period selector has nothing to grow back from.
NEW_LISTENERS_WEEKS = 8


def week_start_boundaries(
    now: datetime, weeks: int = NEW_LISTENERS_WEEKS
) -> list[datetime]:
    """The ``weeks + 1`` half-open bucket edges for the new-listeners series.

    Pure, no DB. Every edge is a Monday 00:00:00 UTC, derived with
    ``date.weekday()`` / ``timedelta`` only — **no** ``date_trunc``, no SQL
    ISO-week function, no ``strftime`` (plan §A.2: the shipped path must be the
    tested path, and the suite runs SQLite). ``date.weekday()`` is 0 on Monday,
    which is the ISO-week anchor, so this is ISO-week bucketing without calling
    ``isocalendar()``.

    Returns ``weeks + 1`` datetimes, oldest first. Bucket ``i`` is the half-open
    interval ``[out[i], out[i + 1])`` for ``i`` in ``range(weeks)``; the last
    edge is next Monday, the exclusive upper bound of the current week.
    """
    if weeks < 1:
        raise ValueError("weeks must be >= 1")
    today: date = now.astimezone(timezone.utc).date()
    this_monday_date = today - timedelta(days=today.weekday())
    this_monday = datetime(
        this_monday_date.year,
        this_monday_date.month,
        this_monday_date.day,
        tzinfo=timezone.utc,
    )
    # w runs from -(weeks - 1) .. +1 inclusive -> weeks + 1 edges. The current
    # week is the newest bucket ([this_monday, next_monday)).
    return [this_monday + timedelta(weeks=w) for w in range(-(weeks - 1), 2)]


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


async def new_listeners_weekly(
    db: AsyncSession, weeks: int = NEW_LISTENERS_WEEKS
) -> list[dict]:
    """M1 — "New listeners" (plan §A.2).

    For each of the last ``weeks`` Monday-anchored ISO weeks (UTC), the count of
    distinct ``user_id`` whose **earliest** ``first_played_at`` across all
    sermons falls in that week. People who listened to anything for the first
    time, that week.

    Shape mandated by §A.2:

    * boundaries computed in Python (``week_start_boundaries``), never in SQL;
    * one query — a per-user ``MIN(first_played_at)`` subquery, then a single
      conditional-aggregate row bucketing those minima over explicit half-open
      ``>= lo AND < hi`` predicates;
    * always exactly ``weeks`` entries, oldest first, zero-filled — a week with
      no first-time listeners comes back as ``count == 0``, not a missing key.

    Returns ``[{"week_start": date, "count": int}, ...]``.
    """
    edges = week_start_boundaries(_now(), weeks)

    # Per-user earliest play, across every sermon. MIN over the whole table —
    # a user's global debut, not their debut on any one sermon.
    first_ever = (
        select(
            PlaybackSession.user_id.label("user_id"),
            func.min(PlaybackSession.first_played_at).label("first_ever"),
        )
        .group_by(PlaybackSession.user_id)
        .subquery()
    )

    # One row, one column per bucket: COUNT of users whose debut lands in
    # [edges[i], edges[i + 1]). Half-open throughout, so no debut is counted
    # twice and none is lost between adjacent weeks. A debut before the window
    # (or in the future) simply matches no bucket.
    bucket_cols = [
        func.sum(
            case(
                (
                    and_(
                        first_ever.c.first_ever >= edges[i],
                        first_ever.c.first_ever < edges[i + 1],
                    ),
                    1,
                ),
                else_=0,
            )
        ).label(f"b{i}")
        for i in range(weeks)
    ]
    row = (await db.execute(select(*bucket_cols).select_from(first_ever))).one()

    return [
        {"week_start": edges[i].date(), "count": int(row[i] or 0)}
        for i in range(weeks)
    ]
