"""GET /api/v1/catalog/sermons/upcoming — the next scheduled sermon, for Home's
"next message" countdown. Scheduling reuses the publish action's `publish_at`
(see test_sermon_scheduled_publish.py); this endpoint only reads it.
"""
from datetime import datetime, timedelta, timezone

from tests.test_sermon_scheduled_publish import _scheduled_sermon, iso, make_user

# asyncio_mode = "auto" — async tests need no marker.


async def test_upcoming_is_null_when_nothing_is_scheduled(client, engine):
    r = await client.get("/api/v1/catalog/sermons/upcoming")
    assert r.status_code == 200
    assert r.json() is None


async def test_upcoming_returns_the_soonest_scheduled_sermon_without_auth(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    now = datetime.now(timezone.utc)
    await _scheduled_sermon(client, ed, mgr, iso(now + timedelta(days=6)), title="Later")
    soonest = await _scheduled_sermon(client, ed, mgr, iso(now + timedelta(days=2)), title="Sunday")

    r = await client.get("/api/v1/catalog/sermons/upcoming")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == soonest
    assert body["title"] == "Sunday"
    assert body["publish_at"]
    # The cover art is sent for the countdown; nothing playable is.
    assert "thumbnail_url" in body
    assert "description" not in body
    assert "stream_url" not in body


async def test_upcoming_ignores_released_and_unpublished_sermons(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    await _scheduled_sermon(client, ed, mgr, iso(datetime.now(timezone.utc) - timedelta(hours=1)), title="Past")
    draft = (await client.post("/api/v1/sermons", json={"title": "Draft"}, headers=ed)).json()
    assert draft["id"]

    assert (await client.get("/api/v1/catalog/sermons/upcoming")).json() is None


async def test_upcoming_sermon_stays_out_of_the_catalog(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = await _scheduled_sermon(client, ed, mgr, iso(datetime.now(timezone.utc) + timedelta(days=1)))

    listed = {row["id"] for row in (await client.get("/api/v1/catalog/sermons")).json()}
    assert sid not in listed
    assert (await client.get(f"/api/v1/catalog/sermons/{sid}")).status_code == 404
