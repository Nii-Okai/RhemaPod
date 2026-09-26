import asyncio
import uuid as _uuid

import pytest

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"


async def _user_by_email(engine, email):
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import User

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        return (await s.execute(
            select(User).where(User.email == email)
        )).scalar_one()


async def make_user(client, engine, email, role):
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await s.execute(
            text("UPDATE users SET role = :r WHERE email = :e"),
            {"r": role.upper(), "e": email},
        )
        await s.commit()
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": email, "password": PW}
    )).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def make_viewer(client, email="viewer@example.com"):
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": email, "password": PW}
    )).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def publish(client, ed, mgr, **body):
    sid = (await client.post("/api/v1/sermons", json=body, headers=ed)).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)
    return sid


async def set_duration(engine, sid, seconds):
    """Set duration via the ORM — SQLite cannot bind a raw UUID parameter, so a
    text() UPDATE keyed on id silently matches nothing."""
    import uuid as _uuid

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import Sermon

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        sermon = await s.get(Sermon, _uuid.UUID(str(sid)))
        sermon.duration_seconds = seconds
        await s.commit()


# ── progress ──────────────────────────────────────────────────────────────────
async def test_record_and_read_progress(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    v = await make_viewer(client)

    r = await client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 120, "watched_delta": 120}, headers=v,
    )
    assert r.status_code == 200
    assert r.json()["position_seconds"] == 120

    got = await client.get(f"/api/v1/sermons/{sid}/progress", headers=v)
    assert got.json()["position_seconds"] == 120


async def test_progress_requires_auth(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    r = await client.post(
        f"/api/v1/sermons/{sid}/progress", json={"position_seconds": 10}
    )
    assert r.status_code in (401, 403)


async def test_progress_null_when_never_played(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    v = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/progress", headers=v)
    assert r.status_code == 200 and r.json() is None


async def test_progress_accumulates_watch_time(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    v = await make_viewer(client)

    await client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 30, "watched_delta": 30}, headers=v,
    )
    r = await client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 60, "watched_delta": 30}, headers=v,
    )
    assert r.json()["watched_seconds"] == 60


async def test_completion_at_ninety_percent(client, engine):
    """Trailing outros mean almost nobody hits 100%; 90% counts as finished."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    await set_duration(engine, sid, 1000)
    v = await make_viewer(client)

    r = await client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 800, "watched_delta": 800}, headers=v,
    )
    assert r.json()["completed"] is False

    r = await client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 950, "watched_delta": 150}, headers=v,
    )
    assert r.json()["completed"] is True


async def test_restart_increments_play_count(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    v = await make_viewer(client)

    await client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 500, "watched_delta": 500}, headers=v,
    )
    r = await client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 5, "watched_delta": 5}, headers=v,
    )
    assert r.json()["play_count"] == 2


# ── upsert: concurrency & clamping (finding 2) ───────────────────────────────
async def test_concurrent_first_progress_writes_do_not_500(client, engine):
    """Two overlapping first writes for the same user+sermon, from two
    independent sessions on the same engine. Pre-fix: the SELECT->add->commit
    sequence has no conflict handling, so the loser raises IntegrityError (and
    corrupts its session) and nothing persists. Post-fix: the single
    INSERT ... ON CONFLICT DO UPDATE means both succeed and exactly one row
    exists.
    """
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import PlaybackSession
    from app.services import analytics_service

    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = _uuid.UUID(await publish(client, ed, mgr, title="S"))
    await make_viewer(client)
    user = await _user_by_email(engine, "viewer@example.com")

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def ping(pos, delta):
        async with Session() as s:
            return await analytics_service.record_progress(
                s, user, sid, position_seconds=pos, watched_delta=delta
            )

    results = await asyncio.gather(
        ping(10, 10), ping(20, 20), return_exceptions=True
    )
    raised = [r for r in results if isinstance(r, Exception)]
    assert not raised, f"a concurrent first write raised: {raised!r}"

    async with Session() as s:
        rows = (await s.execute(
            select(PlaybackSession).where(PlaybackSession.sermon_id == sid)
        )).scalars().all()
    assert len(rows) == 1


async def test_concurrent_watch_deltas_are_not_lost(client, engine):
    """Two overlapping writes must total both watched deltas, not just one —
    the increment-loss half of finding 2. Pre-fix the losing transaction rolls
    back and its delta vanishes."""
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import PlaybackSession
    from app.services import analytics_service

    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = _uuid.UUID(await publish(client, ed, mgr, title="S"))
    await make_viewer(client)
    user = await _user_by_email(engine, "viewer@example.com")

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def ping(pos, delta):
        async with Session() as s:
            return await analytics_service.record_progress(
                s, user, sid, position_seconds=pos, watched_delta=delta
            )

    await asyncio.gather(ping(40, 40), ping(80, 80), return_exceptions=True)

    async with Session() as s:
        row = (await s.execute(
            select(PlaybackSession).where(PlaybackSession.sermon_id == sid)
        )).scalar_one()
    assert row.watched_seconds == 120


async def test_position_is_clamped_to_duration(client, engine):
    """A self-reported position past the sermon's real length is stored
    clamped. Pre-fix the raw value is persisted verbatim."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    await set_duration(engine, sid, 600)
    v = await make_viewer(client)

    r = await client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 5000, "watched_delta": 10}, headers=v,
    )
    assert r.status_code == 200
    assert r.json()["position_seconds"] == 600


async def test_progress_on_unpublished_rejected(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Draft"}, headers=ed
    )).json()["id"]
    v = await make_viewer(client)
    r = await client.post(
        f"/api/v1/sermons/{sid}/progress", json={"position_seconds": 10}, headers=v
    )
    assert r.status_code == 404


# ── continue watching ─────────────────────────────────────────────────────────
async def test_continue_watching_lists_unfinished(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="Unfinished")
    await set_duration(engine, sid, 1000)
    v = await make_viewer(client)

    await client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 300, "watched_delta": 300}, headers=v,
    )
    rows = (await client.get("/api/v1/me/continue-watching", headers=v)).json()
    assert len(rows) == 1
    assert rows[0]["position_seconds"] == 300
    assert rows[0]["percent_complete"] == 30


async def test_completed_excluded_from_continue_watching(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="Done")
    await set_duration(engine, sid, 100)
    v = await make_viewer(client)

    await client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 95, "watched_delta": 95}, headers=v,
    )
    assert (await client.get("/api/v1/me/continue-watching", headers=v)).json() == []


async def test_continue_watching_is_per_user(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    a = await make_viewer(client, "a@example.com")
    b = await make_viewer(client, "b@example.com")

    await client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 100, "watched_delta": 100}, headers=a,
    )
    assert len((await client.get("/api/v1/me/continue-watching", headers=a)).json()) == 1
    assert (await client.get("/api/v1/me/continue-watching", headers=b)).json() == []


async def test_history(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    v = await make_viewer(client)
    await client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 50, "watched_delta": 50}, headers=v,
    )
    rows = (await client.get("/api/v1/me/history", headers=v)).json()
    assert len(rows) == 1
    assert rows[0]["sermon_id"] == sid


async def test_history_series_scope_is_per_user(client, engine):
    """`series_id` scoping must not leak another caller's progress rows."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post(
        "/api/v1/series", json={"title": "Shared Series"}, headers=ed
    )).json()
    sid = await publish(
        client, ed, mgr, title="Ep1", series_id=series["id"], episode_number=1
    )
    a = await make_viewer(client, "a@example.com")
    b = await make_viewer(client, "b@example.com")

    await client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 10, "watched_delta": 10}, headers=a,
    )
    rows_a = (await client.get(
        f"/api/v1/me/history?series_id={series['id']}", headers=a
    )).json()
    rows_b = (await client.get(
        f"/api/v1/me/history?series_id={series['id']}", headers=b
    )).json()
    assert len(rows_a) == 1 and rows_a[0]["sermon_id"] == sid
    assert rows_b == []


async def test_history_series_scope_exceeds_hundred_row_cap(client, engine):
    """finding (decision 6): the app-wide `/me/history` cap is 100 rows, which
    mislabels an old, already-watched early episode as "new" once a series has
    more history than that. A `series_id`-scoped read must return every row
    for that series, not just the first 100 — proven here with 105.

    Sermons/progress are inserted directly via the ORM (bypassing the
    create->submit->approve->publish HTTP workflow used elsewhere in this
    file) purely for test speed; the assertions still exercise the real
    `/me/history` endpoint end-to-end.
    """
    import uuid as _uuid

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import PlaybackSession, Sermon, SermonStatus, User

    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post(
        "/api/v1/series", json={"title": "Long Series"}, headers=ed
    )).json()
    other_sid = await publish(client, ed, mgr, title="Standalone, different series")
    v = await make_viewer(client)

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        editor = (await s.execute(
            select(User).where(User.email == "e@example.com")
        )).scalar_one()
        viewer = (await s.execute(
            select(User).where(User.email == "viewer@example.com")
        )).scalar_one()
        series_id = _uuid.UUID(series["id"])

        sermon_ids = []
        for i in range(105):
            sermon = Sermon(
                title=f"Episode {i}",
                series_id=series_id,
                episode_number=i + 1,
                status=SermonStatus.PUBLISHED,
                created_by=editor.id,
            )
            s.add(sermon)
            await s.flush()
            sermon_ids.append(sermon.id)
        for sermon_id in sermon_ids:
            s.add(PlaybackSession(
                user_id=viewer.id, sermon_id=sermon_id, position_seconds=10
            ))
        # A watched row outside the series must not appear in the scoped read.
        s.add(PlaybackSession(
            user_id=viewer.id, sermon_id=_uuid.UUID(other_sid), position_seconds=5
        ))
        await s.commit()

    rows = (await client.get(
        f"/api/v1/me/history?series_id={series['id']}", headers=v
    )).json()
    assert len(rows) == 105
    returned = {r["sermon_id"] for r in rows}
    assert other_sid not in returned

    # Unscoped read is unchanged: still capped at `limit`, up to the app-wide
    # ceiling of 100 (default 50 — see `watch_history`'s `Query`).
    unscoped = (await client.get(
        "/api/v1/me/history?limit=100", headers=v
    )).json()
    assert len(unscoped) == 100


# ── admin analytics ───────────────────────────────────────────────────────────
async def test_overview_stats(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    v = await make_viewer(client)
    await client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": 100, "watched_delta": 100}, headers=v,
    )

    stats = (await client.get("/api/v1/admin/analytics/overview", headers=mgr)).json()
    assert stats["published_sermons"] == 1
    assert stats["unique_viewers"] == 1
    assert stats["total_plays"] >= 1
    assert stats["total_users"] >= 3


async def test_viewer_cannot_access_analytics(client, engine):
    v = await make_viewer(client)
    r = await client.get("/api/v1/admin/analytics/overview", headers=v)
    assert r.status_code == 403


async def test_editor_cannot_access_analytics(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    r = await client.get("/api/v1/admin/analytics/overview", headers=ed)
    assert r.status_code == 403


async def test_top_sermons(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    popular = await publish(client, ed, mgr, title="Popular")
    quiet = await publish(client, ed, mgr, title="Quiet")

    for email in ["a@example.com", "b@example.com", "c@example.com"]:
        h = await make_viewer(client, email)
        await client.post(
            f"/api/v1/sermons/{popular}/progress",
            json={"position_seconds": 100, "watched_delta": 100}, headers=h,
        )
    h = await make_viewer(client, "d@example.com")
    await client.post(
        f"/api/v1/sermons/{quiet}/progress",
        json={"position_seconds": 10, "watched_delta": 10}, headers=h,
    )

    rows = (await client.get(
        "/api/v1/admin/analytics/top-sermons", headers=mgr
    )).json()
    assert rows[0]["title"] == "Popular"
    assert rows[0]["unique_viewers"] == 3
