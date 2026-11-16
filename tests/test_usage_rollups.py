"""Usage rollups written inside `record_progress` (`plan-admin-settings.md`
§A.4.1/S4) — against real Postgres (`pg_client`/`pg_engine`), not the SQLite
`client`/`engine` most of the suite uses.

Why Postgres only: the whole point of this step is correctness under
*concurrent* pings for the same (user, sermon) or the same (day, sermon) —
`record_progress` now does a locked read (`SELECT ... FOR UPDATE`, Postgres
only) to derive each ping's rollup delta without a Python read-modify-write
on any counter. SQLite has no row locking to speak of, so a concurrency test
against it would prove nothing; `tests/test_analytics.py` (SQLite, unchanged)
already proves the dialect-neutral behaviour (restart threshold,
max-position, sticky completion) still holds.

Named cases below match the three interleavings `status.md`'s S1 test
strategy calls out explicitly: first-play race, a restart racing a forward
ping, and a completion transition hit by two pings — plus the single-ping
happy-path cases DoD-7 also requires.
"""
from __future__ import annotations

import asyncio
import uuid as _uuid
from datetime import date, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.models import ListenerDay, PlaybackSession, SermonPlayDaily, User, UserRole
from app.services import analytics_service

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"


async def make_user(pg_client, pg_engine, email, role):
    await pg_client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    from sqlalchemy import text

    Session = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await s.execute(
            text("UPDATE users SET role = :r WHERE email = :e"),
            {"r": role.upper(), "e": email},
        )
        await s.commit()
    tokens = (await pg_client.post(
        "/api/v1/auth/login", json={"email": email, "password": PW}
    )).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def make_viewer(pg_client, email="viewer@example.com"):
    await pg_client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    tokens = (await pg_client.post(
        "/api/v1/auth/login", json={"email": email, "password": PW}
    )).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def make_viewers_direct(pg_engine, emails):
    """Insert N viewer users directly via the ORM, bypassing
    `/auth/register`+`/auth/login` entirely. The hot-row test below needs
    many distinct listeners, but each register+login round trip draws from
    the *same* `ip:{client}` token-bucket (`GlobalRateLimitMiddleware`,
    `ip_rate_limit_burst=20`) since every request in a test comes from the
    same ASGI test client "IP" — registering that many users through the
    real HTTP endpoints trips 429s that have nothing to do with the rollup
    logic under test. `record_progress` is called directly (not through an
    authenticated HTTP call) for each simulated listener below, so no token
    is needed for these users at all."""
    Session = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)
    users = []
    async with Session() as s:
        for email in emails:
            u = User(email=email, role=UserRole.VIEWER, is_active=True)
            s.add(u)
            users.append(u)
        await s.commit()
        for u in users:
            await s.refresh(u)
    return users


async def publish(pg_client, ed, mgr, **body):
    sid = (await pg_client.post("/api/v1/sermons", json=body, headers=ed)).json()["id"]
    await pg_client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await pg_client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    await pg_client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)
    return sid


async def set_duration(pg_engine, sid, seconds):
    Session = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)
    from app.models.models import Sermon

    async with Session() as s:
        sermon = await s.get(Sermon, _uuid.UUID(str(sid)))
        sermon.duration_seconds = seconds
        await s.commit()


async def _user_by_email(pg_engine, email):
    from app.models.models import User

    Session = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        return (await s.execute(
            select(User).where(User.email == email)
        )).scalar_one()


async def _rollup_row(pg_engine, sid, day=None):
    Session = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        return (await s.execute(
            select(SermonPlayDaily).where(
                SermonPlayDaily.sermon_id == _uuid.UUID(str(sid)),
                *([SermonPlayDaily.day == day] if day else []),
            )
        )).scalar_one_or_none()


async def _listener_day_rows(pg_engine, user_id, day=None):
    Session = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        return (await s.execute(
            select(ListenerDay).where(
                ListenerDay.user_id == user_id,
                *([ListenerDay.day == day] if day else []),
            )
        )).scalars().all()


def _today_utc() -> date:
    from datetime import datetime

    return datetime.now(timezone.utc).date()


# ── single-ping happy path ───────────────────────────────────────────────────

async def test_single_ping_creates_rollup_rows_same_txn(pg_client, pg_engine):
    ed = await make_user(pg_client, pg_engine, "e@example.com", "editor")
    mgr = await make_user(pg_client, pg_engine, "m@example.com", "manager")
    sid = await publish(pg_client, ed, mgr, title="S")
    v = await make_viewer(pg_client)
    user = await _user_by_email(pg_engine, "viewer@example.com")

    r = await pg_client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 30, "watched_delta": 30}, headers=v,
    )
    assert r.status_code == 200

    row = await _rollup_row(pg_engine, sid, _today_utc())
    assert row is not None
    assert row.plays == 1
    assert row.completions == 0
    assert row.watched_seconds == 30

    listeners = await _listener_day_rows(pg_engine, user.id, _today_utc())
    assert len(listeners) == 1


async def test_restart_increments_plays_not_completions(pg_client, pg_engine):
    ed = await make_user(pg_client, pg_engine, "e@example.com", "editor")
    mgr = await make_user(pg_client, pg_engine, "m@example.com", "manager")
    sid = await publish(pg_client, ed, mgr, title="S")
    v = await make_viewer(pg_client)

    await pg_client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 500, "watched_delta": 500}, headers=v,
    )
    # Backward jump > 60s is a restart.
    await pg_client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 5, "watched_delta": 5}, headers=v,
    )

    row = await _rollup_row(pg_engine, sid, _today_utc())
    assert row.plays == 2
    assert row.completions == 0
    assert row.watched_seconds == 505


async def test_forward_ping_does_not_increment_plays(pg_client, pg_engine):
    ed = await make_user(pg_client, pg_engine, "e@example.com", "editor")
    mgr = await make_user(pg_client, pg_engine, "m@example.com", "manager")
    sid = await publish(pg_client, ed, mgr, title="S")
    v = await make_viewer(pg_client)

    await pg_client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 30, "watched_delta": 30}, headers=v,
    )
    await pg_client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 60, "watched_delta": 30}, headers=v,
    )

    row = await _rollup_row(pg_engine, sid, _today_utc())
    assert row.plays == 1
    assert row.watched_seconds == 60


async def test_completion_transition_increments_completions_once(pg_client, pg_engine):
    ed = await make_user(pg_client, pg_engine, "e@example.com", "editor")
    mgr = await make_user(pg_client, pg_engine, "m@example.com", "manager")
    sid = await publish(pg_client, ed, mgr, title="S")
    await set_duration(pg_engine, sid, 1000)
    v = await make_viewer(pg_client)

    await pg_client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 800, "watched_delta": 800}, headers=v,
    )
    row = await _rollup_row(pg_engine, sid, _today_utc())
    assert row.completions == 0

    # Crosses the 90% threshold — the transition.
    await pg_client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 950, "watched_delta": 150}, headers=v,
    )
    row = await _rollup_row(pg_engine, sid, _today_utc())
    assert row.completions == 1

    # Sticky: a further completed ping must not recount.
    await pg_client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 980, "watched_delta": 30}, headers=v,
    )
    row = await _rollup_row(pg_engine, sid, _today_utc())
    assert row.completions == 1


async def test_watched_seconds_delta_accumulates(pg_client, pg_engine):
    ed = await make_user(pg_client, pg_engine, "e@example.com", "editor")
    mgr = await make_user(pg_client, pg_engine, "m@example.com", "manager")
    sid = await publish(pg_client, ed, mgr, title="S")
    v = await make_viewer(pg_client)

    for pos, delta in [(10, 10), (20, 10), (30, 10)]:
        await pg_client.post(
            f"/api/v1/sermons/{sid}/progress",
            json={"position_seconds": pos, "watched_delta": delta}, headers=v,
        )

    row = await _rollup_row(pg_engine, sid, _today_utc())
    assert row.watched_seconds == 30
    assert row.plays == 1


async def test_listener_day_idempotent_on_conflict_do_nothing(pg_client, pg_engine):
    ed = await make_user(pg_client, pg_engine, "e@example.com", "editor")
    mgr = await make_user(pg_client, pg_engine, "m@example.com", "manager")
    sid = await publish(pg_client, ed, mgr, title="S")
    v = await make_viewer(pg_client)
    user = await _user_by_email(pg_engine, "viewer@example.com")

    for pos in (10, 20, 30):
        await pg_client.post(
            f"/api/v1/sermons/{sid}/progress",
            json={"position_seconds": pos, "watched_delta": 10}, headers=v,
        )

    listeners = await _listener_day_rows(pg_engine, user.id, _today_utc())
    assert len(listeners) == 1


async def test_two_distinct_listeners_same_sermon_two_listener_day_rows(pg_client, pg_engine):
    ed = await make_user(pg_client, pg_engine, "e@example.com", "editor")
    mgr = await make_user(pg_client, pg_engine, "m@example.com", "manager")
    sid = await publish(pg_client, ed, mgr, title="S")
    v1 = await make_viewer(pg_client, "viewer1@example.com")
    v2 = await make_viewer(pg_client, "viewer2@example.com")

    await pg_client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 10, "watched_delta": 10}, headers=v1,
    )
    await pg_client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 10, "watched_delta": 10}, headers=v2,
    )

    row = await _rollup_row(pg_engine, sid, _today_utc())
    assert row.plays == 2
    assert row.watched_seconds == 20


# ── concurrency: the three named interleavings ───────────────────────────────

async def test_concurrent_first_play_race(pg_client, pg_engine):
    """Two overlapping *first-ever* pings for the same (user, sermon), from
    two independent sessions on the same engine — exactly the scenario a
    plain `SELECT ... FOR UPDATE` pre-read can't lock (nothing exists yet to
    lock). Must land exactly one `plays` increment, not two, matching the
    single surviving `playback_sessions` row the existing concurrent-first-
    write test already proves exists."""
    ed = await make_user(pg_client, pg_engine, "e@example.com", "editor")
    mgr = await make_user(pg_client, pg_engine, "m@example.com", "manager")
    sid = _uuid.UUID(await publish(pg_client, ed, mgr, title="S"))
    await make_viewer(pg_client)
    user = await _user_by_email(pg_engine, "viewer@example.com")

    Session = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)

    async def ping(pos, delta):
        async with Session() as s:
            return await analytics_service.record_progress(
                s, user, sid, position_seconds=pos, watched_delta=delta
            )

    results = await asyncio.gather(ping(10, 10), ping(20, 20), return_exceptions=True)
    raised = [r for r in results if isinstance(r, Exception)]
    assert not raised, f"a concurrent first ping raised: {raised!r}"

    row = await _rollup_row(pg_engine, sid, _today_utc())
    assert row.plays == 1, f"expected exactly one play, got {row.plays}"
    assert row.watched_seconds == 30

    async with Session() as s:
        sessions = (await s.execute(
            select(PlaybackSession).where(PlaybackSession.sermon_id == sid)
        )).scalars().all()
    assert len(sessions) == 1

    listeners = await _listener_day_rows(pg_engine, user.id, _today_utc())
    assert len(listeners) == 1


async def test_concurrent_restart_races_forward_ping(pg_client, pg_engine):
    """One session sends a restart (big backward jump) while another sends an
    ordinary forward ping for the same (user, sermon), at the same time.
    Whichever order they're actually applied in, exactly one restart must be
    counted (the row already has play_count=1 from an earlier ping, and only
    one of the two concurrent pings here is a genuine restart relative to
    that stored position)."""
    ed = await make_user(pg_client, pg_engine, "e@example.com", "editor")
    mgr = await make_user(pg_client, pg_engine, "m@example.com", "manager")
    sid = _uuid.UUID(await publish(pg_client, ed, mgr, title="S"))
    await make_viewer(pg_client)
    user = await _user_by_email(pg_engine, "viewer@example.com")

    # Seed an initial play at position 500 (so a later ping to position 5
    # is unambiguously a restart; a ping to 530 is unambiguously forward).
    Session = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await analytics_service.record_progress(
            s, user, sid, position_seconds=500, watched_delta=500
        )

    async def ping(pos, delta):
        async with Session() as s:
            return await analytics_service.record_progress(
                s, user, sid, position_seconds=pos, watched_delta=delta
            )

    results = await asyncio.gather(ping(5, 5), ping(530, 30), return_exceptions=True)
    raised = [r for r in results if isinstance(r, Exception)]
    assert not raised, f"a concurrent restart/forward ping raised: {raised!r}"

    row = await _rollup_row(pg_engine, sid, _today_utc())
    # One play from the seed ping, exactly one more from the restart ping —
    # the forward ping must not add a second one regardless of interleaving.
    assert row.plays == 2, f"expected exactly 2 plays total, got {row.plays}"
    assert row.watched_seconds == 535


async def test_concurrent_completion_transition_hit_by_two_pings(pg_client, pg_engine):
    """Two pings that would each independently cross the completion
    threshold, fired concurrently at the same (user, sermon) already sitting
    just below the threshold. Completion is sticky and must be counted
    exactly once, never twice, regardless of which ping's transaction
    commits first."""
    ed = await make_user(pg_client, pg_engine, "e@example.com", "editor")
    mgr = await make_user(pg_client, pg_engine, "m@example.com", "manager")
    sid = _uuid.UUID(await publish(pg_client, ed, mgr, title="S"))
    await set_duration(pg_engine, sid, 1000)
    await make_viewer(pg_client)
    user = await _user_by_email(pg_engine, "viewer@example.com")

    Session = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        # Below the 90% threshold (900).
        await analytics_service.record_progress(
            s, user, sid, position_seconds=850, watched_delta=850
        )

    async def ping(pos, delta):
        async with Session() as s:
            return await analytics_service.record_progress(
                s, user, sid, position_seconds=pos, watched_delta=delta
            )

    # Both cross the threshold on their own.
    results = await asyncio.gather(ping(950, 100), ping(960, 110), return_exceptions=True)
    raised = [r for r in results if isinstance(r, Exception)]
    assert not raised, f"a concurrent completion ping raised: {raised!r}"

    row = await _rollup_row(pg_engine, sid, _today_utc())
    assert row.completions == 1, f"expected exactly one completion, got {row.completions}"
    assert row.plays == 1  # neither ping is a restart relative to 850


# ── single-ping combined interleavings (S5 review) ──────────────────────────

async def test_restart_and_completion_transition_in_single_ping(pg_client, pg_engine):
    """A single ping can simultaneously be a restart (backward jump > 60s)
    *and* the ping that flips `completed` false -> true, because the client
    sends `position_seconds` and an explicit `completed` flag independently
    (`ProgressUpdate.completed`, `content_schemas.py` L728) — nothing forces
    them to agree. The two deltas are derived from two independent
    expressions in `record_progress` (`is_restart` from the position
    comparison; `completion_delta` from `prior_completed` vs
    `session_row.completed`), not from a single mutually-exclusive CASE, so
    both must land in the same UPDATE. This is the exact interleaving named
    in the plan's S5 instruction ("a restart vs completion in one ping") and
    was not covered by any of S4's 12 tests: the existing completion test
    never moves backward, and the existing restart test never sends an
    explicit `completed` flag."""
    ed = await make_user(pg_client, pg_engine, "e@example.com", "editor")
    mgr = await make_user(pg_client, pg_engine, "m@example.com", "manager")
    sid = await publish(pg_client, ed, mgr, title="S")
    await set_duration(pg_engine, sid, 1000)
    v = await make_viewer(pg_client)

    # Below the 90% threshold (900), not completed.
    await pg_client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 850, "watched_delta": 850}, headers=v,
    )
    row = await _rollup_row(pg_engine, sid, _today_utc())
    assert row.plays == 1
    assert row.completions == 0

    # One ping: a big backward jump (850 -> 5, > 60s => restart) *and* an
    # explicit completed=True (independent of position). Both deltas must
    # land from this one ping.
    r = await pg_client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 5, "watched_delta": 5, "completed": True},
        headers=v,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["play_count"] == 2
    assert body["completed"] is True

    row = await _rollup_row(pg_engine, sid, _today_utc())
    assert row.plays == 2, f"expected the restart to add a second play, got {row.plays}"
    assert row.completions == 1, (
        f"expected the same ping's false->true completed transition to add "
        f"exactly one completion, got {row.completions}"
    )
    assert row.watched_seconds == 855

    # Sticky + no further restart: one more ordinary forward ping must not
    # recount either delta.
    await pg_client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 20, "watched_delta": 15}, headers=v,
    )
    row = await _rollup_row(pg_engine, sid, _today_utc())
    assert row.plays == 2
    assert row.completions == 1


async def test_concurrent_restart_and_completion_in_one_ping_each(pg_client, pg_engine):
    """Two concurrent pings for the same (user, sermon), each independently
    combining a backward jump with an explicit completed=True, fired from a
    seeded position that both would individually qualify as a restart
    against. Because the second statement to acquire the `FOR UPDATE` lock
    reads the row *as the first one left it* (not the stale pre-race
    position), only the ping that is actually serialized first is a restart
    relative to live state — the second one is now a (small) forward/short
    jump relative to whichever near-zero position the first ping just wrote,
    so it must NOT double-count as a second restart. This is the control
    proving the design derives each delta from live post-lock state, not
    from two independently-stale snapshots: `plays` must land at exactly
    seed(1) + one restart(1) = 2, never 3, and `completions` (sticky) at
    exactly 1, regardless of which of the two pings' transaction wins the
    race to the lock first."""
    ed = await make_user(pg_client, pg_engine, "e@example.com", "editor")
    mgr = await make_user(pg_client, pg_engine, "m@example.com", "manager")
    sid = _uuid.UUID(await publish(pg_client, ed, mgr, title="S"))
    await set_duration(pg_engine, sid, 1000)
    await make_viewer(pg_client)
    user = await _user_by_email(pg_engine, "viewer@example.com")

    Session = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        # Below the 90% threshold (900), far enough from 0/20 that both
        # concurrent pings below are unambiguous restarts *against this
        # seeded value* (though only one of them will still be a restart
        # once serialized against the other's write — see above).
        await analytics_service.record_progress(
            s, user, sid, position_seconds=850, watched_delta=850
        )

    async def ping(pos, delta, completed):
        async with Session() as s:
            return await analytics_service.record_progress(
                s, user, sid, position_seconds=pos, watched_delta=delta,
                completed=completed,
            )

    results = await asyncio.gather(
        ping(0, 0, True), ping(20, 20, True), return_exceptions=True
    )
    raised = [r for r in results if isinstance(r, Exception)]
    assert not raised, f"a concurrent restart+completion ping raised: {raised!r}"

    row = await _rollup_row(pg_engine, sid, _today_utc())
    assert row.plays == 2, (
        f"expected exactly 2 plays total (seed + exactly one serialized "
        f"restart, not two independent ones), got {row.plays}"
    )
    assert row.completions == 1, f"expected exactly one completion, got {row.completions}"


# ── hot-row contention (K7) ──────────────────────────────────────────────────

async def test_hot_row_many_concurrent_listeners_one_sermon_no_deadlock(pg_client, pg_engine):
    """K7: a popular Sunday sermon concentrates many *different* listeners'
    pings onto one `sermon_play_daily` row (keyed by (day, sermon_id), not
    by user). S4's own 12 tests only ever exercise 2 concurrent writers to
    that row (incidentally, via the 2-session concurrency cases). This pushes
    fan-in to 15 distinct listeners hitting the same row at once, each via
    their own independent session/connection — the scenario the plan's K7
    risk actually names. It asserts Postgres's row-lock wait-queue behaviour
    (every writer eventually commits, deltas land exactly-once-each, no
    deadlock/timeout), not throughput — consistent with the plan's "measure
    and report, don't optimise speculatively" instruction for this risk."""
    ed = await make_user(pg_client, pg_engine, "e@example.com", "editor")
    mgr = await make_user(pg_client, pg_engine, "m@example.com", "manager")
    sid = _uuid.UUID(await publish(pg_client, ed, mgr, title="S"))

    N = 15
    emails = [f"listener{i}@example.com" for i in range(N)]
    listeners = await make_viewers_direct(pg_engine, emails)

    Session = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)

    async def ping(user):
        async with Session() as s:
            return await analytics_service.record_progress(
                s, user, sid, position_seconds=10, watched_delta=10
            )

    results = await asyncio.gather(*(ping(u) for u in listeners), return_exceptions=True)
    raised = [r for r in results if isinstance(r, Exception)]
    assert not raised, f"concurrent writers to one hot row raised: {raised!r}"

    row = await _rollup_row(pg_engine, sid, _today_utc())
    assert row.plays == N, f"expected {N} plays (one per distinct listener), got {row.plays}"
    assert row.watched_seconds == N * 10

    listener_rows = []
    for u in listeners:
        listener_rows.extend(await _listener_day_rows(pg_engine, u.id, _today_utc()))
    assert len(listener_rows) == N


# ── dialect parity ───────────────────────────────────────────────────────────

async def _run_dialect_parity_scenario(http, eng):
    """Same ping sequence used against both dialects below. Deliberately
    *not* run against both `client` and `pg_client` inside one test: both
    fixtures mutate the same global `main.app.dependency_overrides[get_db]`,
    so whichever fixture's setup runs last silently wins for every HTTP call
    made during the test, including ones made through the *other* client —
    there is no way to safely interleave them in one test function. Each
    dialect gets its own test instead, both asserting the same expected
    values, which is an equivalent proof of parity."""
    ed = await make_user(http, eng, "e@example.com", "editor")
    mgr = await make_user(http, eng, "m@example.com", "manager")
    sid = await publish(http, ed, mgr, title="S")
    await set_duration(eng, sid, 1000)
    v = await make_viewer(http)
    await http.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 800, "watched_delta": 800}, headers=v,
    )
    r = await http.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 950, "watched_delta": 150}, headers=v,
    )
    r2 = await http.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 5, "watched_delta": 5}, headers=v,
    )
    return r.json(), r2.json()


def _assert_expected_parity_values(completed_resp, restart_resp):
    assert completed_resp["completed"] is True
    assert completed_resp["play_count"] == 1
    assert completed_resp["watched_seconds"] == 950
    assert restart_resp["completed"] is True  # sticky
    assert restart_resp["play_count"] == 2  # the big backward jump is a restart
    assert restart_resp["watched_seconds"] == 955


async def test_dialect_parity_sqlite(client, engine):
    """`playback_sessions`'s own semantics (restart threshold, sticky
    completion) on SQLite, unchanged by the rollup additions."""
    completed_resp, restart_resp = await _run_dialect_parity_scenario(client, engine)
    _assert_expected_parity_values(completed_resp, restart_resp)


async def test_dialect_parity_postgres(pg_client, pg_engine):
    """Same scenario, same expected values, on real Postgres — the dialect
    the rollup's locked read/update actually runs on."""
    completed_resp, restart_resp = await _run_dialect_parity_scenario(pg_client, pg_engine)
    _assert_expected_parity_values(completed_resp, restart_resp)
