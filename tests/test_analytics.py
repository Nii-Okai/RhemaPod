import pytest

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"


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
