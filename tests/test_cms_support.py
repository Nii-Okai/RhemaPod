"""Backend support for the CMS: pagination, staff list fields, episode
auto-numbering, client-supplied duration, and stale-upload sweeping.
"""
import pytest

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"
VIDEO = {"filename": "s.mp4", "content_type": "video/mp4", "media_type": "video"}


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


# ── staff list: pagination + workflow fields ──────────────────────────────────
async def test_staff_list_is_paginated(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    for i in range(7):
        await client.post("/api/v1/sermons", json={"title": f"S{i}"}, headers=ed)

    page = (await client.get("/api/v1/sermons?limit=3&offset=0", headers=ed)).json()
    assert page["total"] == 7
    assert page["limit"] == 3 and page["offset"] == 0
    assert len(page["items"]) == 3

    page2 = (await client.get("/api/v1/sermons?limit=3&offset=3", headers=ed)).json()
    assert len(page2["items"]) == 3
    assert not ({i["id"] for i in page["items"]} & {i["id"] for i in page2["items"]})


async def test_staff_list_exposes_status(client, engine):
    """The CMS table can't work without this — it was the blocking gap."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Draft one"}, headers=ed
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)

    item = (await client.get("/api/v1/sermons", headers=ed)).json()["items"][0]
    assert item["status"] == "pending_review"
    assert item["created_by"] and item["created_at"]


async def test_staff_list_includes_related_names(client, engine):
    """Names come denormalised so a table renders without N lookups per row."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sp = (await client.post(
        "/api/v1/speakers", json={"name": "Pastor Daniel"}, headers=ed
    )).json()
    cat = (await client.post(
        "/api/v1/categories", json={"name": "Sunday", "slug": "sunday"}, headers=mgr
    )).json()
    ser = (await client.post(
        "/api/v1/series", json={"title": "Grace"}, headers=ed
    )).json()
    await client.post(
        "/api/v1/sermons",
        json={"title": "S", "speaker_id": sp["id"], "category_id": cat["id"],
              "series_id": ser["id"]},
        headers=ed,
    )
    item = (await client.get("/api/v1/sermons", headers=ed)).json()["items"][0]
    assert item["speaker_name"] == "Pastor Daniel"
    assert item["category_name"] == "Sunday"
    assert item["series_title"] == "Grace"


async def test_staff_list_title_search(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    await client.post("/api/v1/sermons", json={"title": "Walking in Grace"}, headers=ed)
    await client.post("/api/v1/sermons", json={"title": "Power of Prayer"}, headers=ed)
    page = (await client.get("/api/v1/sermons?q=grace", headers=ed)).json()
    assert page["total"] == 1


async def test_users_list_paginated(client, engine):
    admin = await make_user(client, engine, "a@example.com", "admin")
    page = (await client.get("/api/v1/users?limit=1", headers=admin)).json()
    assert "items" in page and page["total"] >= 1 and len(page["items"]) == 1


async def test_announcements_admin_paginated(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    for i in range(4):
        await client.post(
            "/api/v1/announcements",
            json={"title": f"A{i}", "body": "text"}, headers=mgr,
        )
    page = (await client.get(
        "/api/v1/announcements/admin/all?limit=2", headers=mgr
    )).json()
    assert page["total"] == 4 and len(page["items"]) == 2


# ── episode auto-numbering ────────────────────────────────────────────────────
async def test_episode_numbers_auto_increment(client, engine):
    """Editors shouldn't have to track episode numbers by hand."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    series = (await client.post(
        "/api/v1/series", json={"title": "Grace"}, headers=ed
    )).json()

    first = (await client.post(
        "/api/v1/sermons", json={"title": "Ep A", "series_id": series["id"]}, headers=ed
    )).json()
    second = (await client.post(
        "/api/v1/sermons", json={"title": "Ep B", "series_id": series["id"]}, headers=ed
    )).json()
    third = (await client.post(
        "/api/v1/sermons", json={"title": "Ep C", "series_id": series["id"]}, headers=ed
    )).json()

    assert [first["episode_number"], second["episode_number"], third["episode_number"]] == [1, 2, 3]


async def test_explicit_episode_number_wins(client, engine):
    """A number can still be set by hand for reordering."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    series = (await client.post(
        "/api/v1/series", json={"title": "S"}, headers=ed
    )).json()
    r = (await client.post(
        "/api/v1/sermons",
        json={"title": "Pilot", "series_id": series["id"], "episode_number": 0},
        headers=ed,
    )).json()
    assert r["episode_number"] == 0

    nxt = (await client.post(
        "/api/v1/sermons", json={"title": "Next", "series_id": series["id"]}, headers=ed
    )).json()
    assert nxt["episode_number"] == 1


async def test_standalone_sermon_has_no_episode_number(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    r = (await client.post(
        "/api/v1/sermons", json={"title": "Standalone"}, headers=ed
    )).json()
    assert r["episode_number"] is None


async def test_moving_into_series_assigns_number(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    series = (await client.post(
        "/api/v1/series", json={"title": "S"}, headers=ed
    )).json()
    await client.post(
        "/api/v1/sermons", json={"title": "Ep1", "series_id": series["id"]}, headers=ed
    )
    loose = (await client.post(
        "/api/v1/sermons", json={"title": "Loose"}, headers=ed
    )).json()

    moved = (await client.patch(
        f"/api/v1/sermons/{loose['id']}",
        json={"series_id": series["id"]}, headers=ed,
    )).json()
    assert moved["episode_number"] == 2


# ── duration from the client ──────────────────────────────────────────────────
async def test_confirm_records_duration(client, engine):
    """The browser reads duration before uploading; nothing server-side can."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed
    )).json()

    r = await client.post(
        f"/api/v1/uploads/{ticket['job_id']}/confirm",
        json={"duration_seconds": 2535}, headers=ed,
    )
    assert r.status_code == 200

    item = (await client.get("/api/v1/sermons", headers=ed)).json()["items"][0]
    assert item["duration_seconds"] == 2535


async def test_confirm_without_duration_still_works(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed
    )).json()
    r = await client.post(f"/api/v1/uploads/{ticket['job_id']}/confirm", headers=ed)
    assert r.status_code == 200 and r.json()["status"] == "ready"


async def test_absurd_duration_rejected(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed
    )).json()
    r = await client.post(
        f"/api/v1/uploads/{ticket['job_id']}/confirm",
        json={"duration_seconds": 999999}, headers=ed,
    )
    assert r.status_code == 422


# ── stale upload sweep ────────────────────────────────────────────────────────
async def test_sweep_marks_abandoned_uploads_failed(client, engine):
    """A tab closed mid-upload leaves a job stuck; the sweep makes it honest."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed)

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.services.media_service import sweep_stale_jobs

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        # Zero-hour cutoff: everything not yet confirmed counts as stale.
        swept = await sweep_stale_jobs(s, older_than_hours=0)
    assert swept == 1

    jobs = (await client.get(f"/api/v1/sermons/{sid}/uploads", headers=ed)).json()
    assert jobs[0]["status"] == "failed"
    assert "timed out" in jobs[0]["error_message"]


async def test_sweep_leaves_completed_jobs_alone(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed
    )).json()
    await client.post(f"/api/v1/uploads/{ticket['job_id']}/confirm", headers=ed)

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.services.media_service import sweep_stale_jobs

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        assert await sweep_stale_jobs(s, older_than_hours=0) == 0
