"""Playback progress and admin analytics.

Progress is stored as one upserted row per user per sermon rather than an event
stream. That answers the two questions this app actually has — "where did I get
to" and "how is this sermon performing" — without the storage and aggregation
cost of a full event pipeline.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import and_, case, func, literal, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.models import (
    PAID_TIERS,
    ListenerDay,
    PlaybackSession,
    Sermon,
    SermonPlayDaily,
    SermonStatus,
    Series,
    Subscription,
    SubscriptionStatus,
    User,
    UserRole,
)
from app.services.content_service import ContentError, effective_tier, load_ref_names, staff_sees_full_counts, to_list_item

log = get_logger("analytics")

# Treat a sermon as finished at 90% — trailing credits or a slow outro mean
# almost nobody reaches 100%, and counting only those would understate reach.
COMPLETION_THRESHOLD = 0.9

# Safety ceiling for a `series_id`-scoped history read (app-wide unscoped reads
# use the caller's `limit`, capped at 100 — see `watch_history`). A series is
# bounded in practice: episode reordering (content_service.reorder_series_
# episodes) already refuses to operate past MAX_PAGE_SIZE (100) episodes, so
# 500 is generous headroom for a scoped read rather than a real constraint —
# it exists to keep one caller from forcing an unbounded scan, not to ever
# actually bind a real series.
SERIES_HISTORY_LIMIT = 500


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
    today = now.date()

    # There is no dialect-neutral upsert in SQLAlchemy 2.0, so the insert()
    # function is chosen on the dialect (same shape as
    # search_service._is_postgres); production runs the postgresql arm, the
    # suite exercises the sqlite arm.
    is_postgres = db.bind.dialect.name == "postgresql"
    insert_fn = pg_insert if is_postgres else sqlite_insert

    # Usage-rollup deltas (plan-admin-settings §A.4.1/S4): this ping's effect
    # on sermon_play_daily/listener_day needs the *prior* state of the
    # playback_sessions row — was this the first-ever ping for (user,
    # sermon), a restart, and did `completed` just flip false -> true. The
    # original single on_conflict_do_update statement computes all of that
    # SQL-side already (restart threshold, max-position, sticky completion —
    # unchanged below) but a RETURNING clause can't portably expose a row's
    # *prior* values across both dialects, so a second mechanism is needed to
    # derive the delta without a Python read-modify-write on any counter.
    #
    # Chosen: a locked pre-read (SELECT ... FOR UPDATE), not a RETURNING/CTE
    # trick on the upsert itself. A `(xmax = 0)`-style RETURNING would still
    # need the *prior* `completed` value to detect the false->true
    # transition on the update path, and the only way to get that value atomically
    # is a locked read anyway — so this doesn't avoid a locked read, it just
    # hides it inside a CTE whose execution-order relative to a sibling
    # INSERT CTE is not guaranteed by Postgres for independent (non
    # data-dependent) CTEs. A `FOR UPDATE` SELECT can't lock a row that
    # doesn't exist yet, though, so the pre-read is split in two: first a
    # cheap `INSERT ... ON CONFLICT DO NOTHING`, whose own conflict
    # detection is Postgres's native atomic arbiter (the same mechanism that
    # already makes the old on_conflict_do_update safe for concurrent first
    # writes — see test_concurrent_first_progress_writes_do_not_500) tells
    # us unambiguously whether *this* ping was the row's genuine creation.
    # Only when it isn't do we fall back to a locked read — joined into the
    # UPDATE itself via a CTE in its FROM clause (a real data dependency,
    # not a sibling), so the lock and the write happen in the same
    # statement with no gap between them.
    first_write = (await db.execute(
        insert_fn(PlaybackSession)
        .values(
            user_id=user.id,
            sermon_id=sermon_id,
            position_seconds=position_seconds,
            watched_seconds=watched_delta,
            completed=marks_completed,
            play_count=1,
            last_played_at=now,
        )
        .on_conflict_do_nothing(index_elements=["user_id", "sermon_id"])
        .returning(PlaybackSession)
    )).scalar_one_or_none()

    if first_write is not None:
        # Genuinely the first row ever for this (user, sermon): one play,
        # and a completion iff this very first ping already clears the
        # threshold.
        session_row = first_write
        play_delta = 1
        completion_delta = 1 if marks_completed else 0
    else:
        # A row already exists — ours from an earlier ping, or a
        # concurrent racer's that just won the insert above (Postgres's
        # conflict check waits for an in-flight conflicting insert to
        # finish before reporting the conflict, so by the time we're here
        # the row is guaranteed to be visible). Lock it and read its
        # pre-update state as part of the same statement that updates it:
        # `prior` is a real FROM-dependency of the UPDATE (not a sibling
        # CTE), so the lock acquisition and the write are one atomic unit —
        # nothing else can touch this row between the read and the write.
        # SQLite has no row locking to speak of (`with_for_update()` is a
        # no-op there); that's fine — the plan's correctness bar is
        # Postgres, SQLite only needs to keep the suite's existing
        # dialect-neutral behaviour.
        prior_select = select(
            PlaybackSession.user_id,
            PlaybackSession.sermon_id,
            PlaybackSession.completed,
            PlaybackSession.position_seconds,
        ).where(
            PlaybackSession.user_id == user.id,
            PlaybackSession.sermon_id == sermon_id,
        )
        if is_postgres:
            prior_select = prior_select.with_for_update()
        prior = prior_select.cte("prior")

        # A large backward jump (>60s) is a deliberate restart, not a scrub:
        #   * play_count increments;
        #   * position follows the viewer back to the start (wins outright).
        # Any other ping takes the max against the stored position, which
        # discards an out-of-order or concurrent late ping. GREATEST /
        # max(a, b) is spelled differently across the two dialects, so this
        # is a case() instead. Semantics identical to the pre-S4 code.
        is_restart = literal(position_seconds) < prior.c.position_seconds - 60
        upd = (
            update(PlaybackSession)
            .where(
                PlaybackSession.user_id == prior.c.user_id,
                PlaybackSession.sermon_id == prior.c.sermon_id,
            )
            .values(
                # SQL-side accumulation — a Python read-modify-write here
                # loses increments under concurrency, which is the bug the
                # original on_conflict_do_update was written to fix.
                watched_seconds=PlaybackSession.watched_seconds + watched_delta,
                play_count=case(
                    (is_restart, PlaybackSession.play_count + 1),
                    else_=PlaybackSession.play_count,
                ),
                position_seconds=case(
                    (is_restart, literal(position_seconds)),
                    (prior.c.position_seconds > literal(position_seconds),
                     prior.c.position_seconds),
                    else_=literal(position_seconds),
                ),
                # Sticky: once true, stays true.
                completed=prior.c.completed | literal(marks_completed),
                last_played_at=now,
            )
            .returning(PlaybackSession, prior.c.completed, prior.c.position_seconds)
        )
        session_row, prior_completed, prior_position = (await db.execute(upd)).one()
        play_delta = 1 if position_seconds < prior_position - 60 else 0
        completion_delta = 1 if (not prior_completed and session_row.completed) else 0

    # sermon_play_daily / listener_day: both SQL-side accumulation again, for
    # the same reason — this is the hot row under concurrent load (many
    # listeners, one popular sermon, one (day, sermon_id) key), and a
    # Python-computed absolute value would silently lose increments.
    await db.execute(
        insert_fn(SermonPlayDaily)
        .values(
            day=today,
            sermon_id=sermon_id,
            plays=play_delta,
            completions=completion_delta,
            watched_seconds=watched_delta,
        )
        .on_conflict_do_update(
            index_elements=["day", "sermon_id"],
            set_={
                "plays": SermonPlayDaily.plays + play_delta,
                "completions": SermonPlayDaily.completions + completion_delta,
                "watched_seconds": SermonPlayDaily.watched_seconds + watched_delta,
            },
        )
    )
    await db.execute(
        insert_fn(ListenerDay)
        .values(day=today, user_id=user.id)
        .on_conflict_do_nothing(index_elements=["day", "user_id"])
    )

    await db.commit()
    return session_row


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

    names = await load_ref_names(
        db, [sermon for _, sermon in rows],
        include_draft_series=staff_sees_full_counts(user),
    )
    items = []
    for session, sermon in rows:
        base = to_list_item(
            sermon, effective_tier(sermon, series_map.get(sermon.series_id)),
            has_subscription, names,
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


# Safety ceiling for the `series_id`-scoped read below — deliberately much
# higher than the unscoped read's 100-row cap (mobile's own docstring,
# useWatchHistory.ts: "the backend ignores `limit` once `series_id` is set,
# bounded instead by its own much higher ... safety ceiling"). No realistic
# series has anywhere near this many episodes; this exists to bound the
# query, not to actually get hit.
SERIES_HISTORY_LIMIT = 500


async def history(
    db: AsyncSession,
    user: User,
    limit: int = 50,
    series_id: uuid.UUID | None = None,
) -> list[PlaybackSession]:
    """The caller's own playback history, most-recently-played first.

    Unscoped (`series_id=None`): the existing app-wide "recent activity"
    reading, capped at `limit` (<=100).

    Scoped to a `series_id`: every one of the caller's progress rows for
    sermons in that series — `limit` does not apply, since a 100-row app-wide
    cap can mislabel an old, already-watched early episode as "new" once a
    series has more than 100 episodes of history across all series. Bounded
    instead by `SERIES_HISTORY_LIMIT`, a safety ceiling rather than a real
    limit (see its docstring).
    """
    stmt = select(PlaybackSession).where(PlaybackSession.user_id == user.id)
    if series_id is not None:
        stmt = stmt.join(
            Sermon, Sermon.id == PlaybackSession.sermon_id
        ).where(Sermon.series_id == series_id)
        row_limit = SERIES_HISTORY_LIMIT
    else:
        row_limit = max(1, min(limit, 100))

    rows = (await db.execute(
        stmt.order_by(PlaybackSession.last_played_at.desc()).limit(row_limit)
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

    member_rows = (await db.execute(
        select(User.is_active, func.count())
        .where(User.role == UserRole.VIEWER)
        .group_by(User.is_active)
    )).all()
    members = sum(int(n) for _, n in member_rows)
    active_members = sum(int(n) for active, n in member_rows if active)

    watched = (await db.execute(
        select(func.coalesce(func.sum(PlaybackSession.watched_seconds), 0))
    )).scalar_one()

    return {
        "total_users": total_users,
        "members": members,
        "active_members": active_members,
        "watch_hours": _hours(int(watched or 0)),
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


# ── Usage reports (plan-admin-settings §A.5, step S13) ─────────────────────
#
# Plays, completions and watch time come from the forward-only daily
# rollups (`sermon_play_daily`, written by `record_progress` since S4);
# distinct listeners from `listener_day`; new listeners and signups from the
# full-history tables, so those two are accurate for any period. Periods
# are half-open `[from, to)` UTC dates (Ghana is UTC+0, no DST). Bucket edges
# are computed here in Python and every measure is one conditional-aggregate
# query over those edges — the `new_listeners_weekly` pattern, and no
# `date_trunc`, because the suite runs on SQLite.

REPORT_MAX_DAYS = 366
REPORT_GRANULARITIES = ("day", "week", "month")
REPORT_TOP_SERMONS = 10


def report_edges(start: date, end: date, granularity: str) -> list[date]:
    """Half-open bucket edges covering exactly `[start, end)`, oldest first.

    `day` gives one bucket per date. `week` cuts at ISO Mondays and `month`
    at the 1st; the first and last buckets are clipped to the period, so the
    buckets always add up to the period's totals. Pure, no DB.
    """
    if end <= start:
        raise ValueError("end must be after start")
    edges = [start]
    cursor = start
    while True:
        if granularity == "day":
            cursor = cursor + timedelta(days=1)
        elif granularity == "week":
            cursor = cursor + timedelta(days=7 - cursor.weekday())
        elif granularity == "month":
            cursor = (
                date(cursor.year + 1, 1, 1) if cursor.month == 12
                else date(cursor.year, cursor.month + 1, 1)
            )
        else:
            raise ValueError(f"unknown granularity {granularity!r}")
        if cursor >= end:
            break
        edges.append(cursor)
    edges.append(end)
    return edges


def _midnight(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


def _in(col, lo, hi):
    return and_(col >= lo, col < hi)


async def _bucket_sums(db: AsyncSession, value, day_col, edges: list[date]) -> list[int]:
    """SUM(value) per bucket, one row back. `value` is a column of the table
    `day_col` belongs to; the WHERE limits the scan to the period."""
    cols = [
        func.sum(case((_in(day_col, edges[i], edges[i + 1]), value), else_=0))
        for i in range(len(edges) - 1)
    ]
    row = (
        await db.execute(select(*cols).where(_in(day_col, edges[0], edges[-1])))
    ).one()
    return [int(v or 0) for v in row]


async def _bucket_distinct_listeners(db: AsyncSession, edges: list[date]) -> list[int]:
    """Distinct users per bucket from `listener_day` — a COUNT(DISTINCT) per
    bucket, never a sum of daily counts (someone active on two days of one
    week is one listener for that week)."""
    d = ListenerDay.day
    cols = [
        func.count(func.distinct(case((_in(d, edges[i], edges[i + 1]), ListenerDay.user_id))))
        for i in range(len(edges) - 1)
    ]
    row = (await db.execute(select(*cols).where(_in(d, edges[0], edges[-1])))).one()
    return [int(v or 0) for v in row]


async def _bucket_counts_at(db: AsyncSession, ts_col, from_, edges: list[date]) -> list[int]:
    """COUNT(*) per bucket of a timestamp column (`from_` is the subquery or
    table it lives on), bucketed on UTC midnights."""
    bounds = [_midnight(e) for e in edges]
    cols = [
        func.sum(case((_in(ts_col, bounds[i], bounds[i + 1]), 1), else_=0))
        for i in range(len(bounds) - 1)
    ]
    row = (
        await db.execute(select(*cols).select_from(from_).where(_in(ts_col, bounds[0], bounds[-1])))
    ).one()
    return [int(v or 0) for v in row]


def _hours(seconds: int) -> float:
    return round(seconds / 3600, 1)


async def usage_report(
    db: AsyncSession,
    start: date,
    end: date,
    granularity: str,
    *,
    top_limit: int = REPORT_TOP_SERMONS,
) -> dict:
    """The `GET /admin/analytics/report` body. Raises `ContentError(422)` for
    an empty, inverted or over-366-day period."""
    if end <= start:
        raise ContentError("`to` must be after `from`.", status_code=422)
    if (end - start).days > REPORT_MAX_DAYS:
        raise ContentError(
            f"A report covers at most {REPORT_MAX_DAYS} days.", status_code=422
        )
    if granularity not in REPORT_GRANULARITIES:
        raise ContentError("Unknown granularity.", status_code=422)

    edges = report_edges(start, end, granularity)
    whole = [start, end]
    spd = SermonPlayDaily
    first_ever = (
        select(func.min(PlaybackSession.first_played_at).label("first_ever"))
        .group_by(PlaybackSession.user_id)
        .subquery()
    )
    viewers = select(User.created_at.label("created_at")).where(
        User.role == UserRole.VIEWER
    ).subquery()

    plays = await _bucket_sums(db, spd.plays, spd.day, edges)
    completions = await _bucket_sums(db, spd.completions, spd.day, edges)
    watched = await _bucket_sums(db, spd.watched_seconds, spd.day, edges)
    listeners = await _bucket_distinct_listeners(db, edges)
    new_listeners = await _bucket_counts_at(db, first_ever.c.first_ever, first_ever, edges)
    signups = await _bucket_counts_at(db, viewers.c.created_at, viewers, edges)
    (period_listeners,) = await _bucket_distinct_listeners(db, whole)

    data_from = (await db.execute(select(func.min(spd.day)))).scalar_one_or_none()

    top_rows = (
        await db.execute(
            select(
                Sermon.id,
                Sermon.title,
                func.sum(spd.plays).label("plays"),
                func.sum(spd.completions).label("completions"),
                func.sum(spd.watched_seconds).label("watched"),
            )
            .join(Sermon, Sermon.id == spd.sermon_id)
            .where(_in(spd.day, start, end))
            .group_by(Sermon.id, Sermon.title)
            .order_by(func.sum(spd.plays).desc(), Sermon.title)
            .limit(top_limit)
        )
    ).all()

    series = [
        {
            "start": edges[i],
            "end": edges[i + 1],
            "plays": plays[i],
            "completions": completions[i],
            "watch_hours": _hours(watched[i]),
            "listeners": listeners[i],
            "new_listeners": new_listeners[i],
            "signups": signups[i],
        }
        for i in range(len(edges) - 1)
    ]
    return {
        "period": {"from": start, "to": end, "granularity": granularity},
        "data_available_from": data_from,
        "kpis": {
            "plays": sum(plays),
            "completions": sum(completions),
            "watch_hours": _hours(sum(watched)),
            "listeners": period_listeners,
            "new_listeners": sum(new_listeners),
            "signups": sum(signups),
        },
        "series": series,
        "top_sermons": [
            {
                "sermon_id": sid,
                "title": title,
                "plays": int(p or 0),
                "completions": int(c or 0),
                "watch_hours": _hours(int(w or 0)),
            }
            for sid, title, p, c, w in top_rows
        ],
    }


# Excel / Sheets treat a cell starting with any of these as a formula. Same
# set as the admin portal's own CSV export
# (`components/subscriptions/subscriptions-csv.ts`).
_FORMULA_LEAD = ("=", "+", "-", "@", "\t", "\r")

TIMESERIES_COLUMNS = (
    "period_start", "period_end", "plays", "completions", "watch_hours",
    "listeners", "new_listeners", "signups",
)
TOP_SERMONS_COLUMNS = ("sermon_id", "title", "plays", "completions", "watch_hours")


def csv_cell(value) -> str:
    """One CSV field: OWASP formula guard first (leading `'` when the value
    would otherwise be read as a formula), then RFC 4180 quoting."""
    text = "" if value is None else str(value)
    if text.startswith(_FORMULA_LEAD):
        text = "'" + text
    if any(c in text for c in ',"\r\n'):
        text = '"' + text.replace('"', '""') + '"'
    return text


def report_csv(report: dict, kind: str) -> str:
    """The export body: UTF-8 BOM (so Excel opens it as UTF-8), CRLF line
    endings, every cell through `csv_cell`."""
    if kind == "timeseries":
        header = TIMESERIES_COLUMNS
        rows = [
            (b["start"], b["end"], b["plays"], b["completions"], b["watch_hours"],
             b["listeners"], b["new_listeners"], b["signups"])
            for b in report["series"]
        ]
    elif kind == "top_sermons":
        header = TOP_SERMONS_COLUMNS
        rows = [
            (t["sermon_id"], t["title"], t["plays"], t["completions"], t["watch_hours"])
            for t in report["top_sermons"]
        ]
    else:
        raise ValueError(f"unknown export kind {kind!r}")
    lines = [",".join(csv_cell(c) for c in header)]
    lines += [",".join(csv_cell(c) for c in row) for row in rows]
    return "﻿" + "\r\n".join(lines) + "\r\n"
