"""Viewer-owned playlists (Isaac's ask, session 2026-10-10): the Library tab's
"create playlists" half — `/playlists` CRUD, item add/remove/reorder, and the
cover upload-ticket/confirm pair. Every route is scoped to the caller's own
playlists, so ownership isolation gets its own tests, not just the happy path.
"""
import itertools
import uuid

import pytest

pytestmark = pytest.mark.asyncio

API = "/api/v1"
PW = "correct-horse-battery"
_counter = itertools.count()


def _unique_email(prefix: str) -> str:
    return f"{prefix}{next(_counter)}@example.com"


async def make_user(client, engine, email, role):
    await client.post(f"{API}/auth/register", json={"email": email, "password": PW})
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await s.execute(text("UPDATE users SET role = :role WHERE email = :email"), {"role": role.upper(), "email": email})
        await s.commit()
    tokens = (await client.post(f"{API}/auth/login", json={"email": email, "password": PW})).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def make_viewer(client, email=None):
    email = email or _unique_email("viewer")
    await client.post(f"{API}/auth/register", json={"email": email, "password": PW})
    tokens = (await client.post(f"{API}/auth/login", json={"email": email, "password": PW})).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def set_duration(engine, sermon_id, seconds):
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    # SQLite stores `UUID(as_uuid=True)` columns as dashless hex, not the
    # dashed string form the API returns — a raw-SQL match on `id` needs the
    # same hex form or it silently matches zero rows.
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await s.execute(
            text("UPDATE sermons SET duration_seconds = :d WHERE id = :id"),
            {"d": seconds, "id": uuid.UUID(sermon_id).hex},
        )
        await s.commit()


async def make_published_sermon(client, engine, title="A Sermon", duration_seconds=600):
    editor = await make_user(client, engine, _unique_email("ed"), "editor")
    manager = await make_user(client, engine, _unique_email("mgr"), "manager")
    sid = (await client.post(f"{API}/sermons", json={"title": title}, headers=editor)).json()["id"]
    await set_duration(engine, sid, duration_seconds)
    await client.post(f"{API}/sermons/{sid}/submit", headers=editor)
    await client.post(f"{API}/approvals/sermons/{sid}/approve", headers=manager)
    await client.post(f"{API}/approvals/sermons/{sid}/publish", headers=manager)
    return sid


async def make_playlist(client, headers, name="Morning Dew", **extra):
    r = await client.post(f"{API}/playlists", json={"name": name, **extra}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


# ── CRUD ─────────────────────────────────────────────────────────────────────
async def test_create_playlist_defaults_to_private_and_empty(client, engine):
    viewer = await make_viewer(client)
    body = await make_playlist(client, viewer)
    assert body["name"] == "Morning Dew"
    assert body["is_public"] is False
    assert body["item_count"] == 0
    assert body["total_duration_seconds"] == 0
    assert body["cover_url"] is None


async def test_create_playlist_name_is_trimmed(client, engine):
    viewer = await make_viewer(client)
    body = await make_playlist(client, viewer, name="  Road Trip  ")
    assert body["name"] == "Road Trip"


async def test_create_playlist_requires_a_name(client, engine):
    viewer = await make_viewer(client)
    r = await client.post(f"{API}/playlists", json={"name": ""}, headers=viewer)
    assert r.status_code == 422


async def test_list_playlists_only_shows_the_caller_s_own(client, engine):
    a = await make_viewer(client)
    b = await make_viewer(client)
    await make_playlist(client, a, name="A's list")
    await make_playlist(client, b, name="B's list")

    listing = (await client.get(f"{API}/playlists", headers=a)).json()
    names = {p["name"] for p in listing}
    assert names == {"A's list"}


async def test_update_playlist_rename_and_privacy(client, engine):
    viewer = await make_viewer(client)
    playlist = await make_playlist(client, viewer)

    r = await client.patch(
        f"{API}/playlists/{playlist['id']}", json={"name": "Renamed", "is_public": False}, headers=viewer
    )
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Renamed"
    assert body["is_public"] is False


async def test_update_playlist_description_can_be_cleared(client, engine):
    viewer = await make_viewer(client)
    playlist = await make_playlist(client, viewer, description="Original")

    r = await client.patch(f"{API}/playlists/{playlist['id']}", json={"description": ""}, headers=viewer)
    assert r.status_code == 200
    assert r.json()["description"] is None


async def test_update_playlist_omitted_fields_are_untouched(client, engine):
    viewer = await make_viewer(client)
    playlist = await make_playlist(client, viewer, description="Keep me")

    r = await client.patch(f"{API}/playlists/{playlist['id']}", json={"is_public": False}, headers=viewer)
    assert r.status_code == 200
    assert r.json()["description"] == "Keep me"


async def test_delete_playlist(client, engine):
    viewer = await make_viewer(client)
    playlist = await make_playlist(client, viewer)

    r = await client.delete(f"{API}/playlists/{playlist['id']}", headers=viewer)
    assert r.status_code == 204

    r = await client.get(f"{API}/playlists/{playlist['id']}", headers=viewer)
    assert r.status_code == 404


async def test_a_playlist_not_owned_by_the_caller_404s_not_403(client, engine):
    owner = await make_viewer(client)
    intruder = await make_viewer(client)
    playlist = await make_playlist(client, owner)

    assert (await client.get(f"{API}/playlists/{playlist['id']}", headers=intruder)).status_code == 404
    assert (await client.patch(
        f"{API}/playlists/{playlist['id']}", json={"name": "Hijacked"}, headers=intruder
    )).status_code == 404
    assert (await client.delete(f"{API}/playlists/{playlist['id']}", headers=intruder)).status_code == 404


async def test_playlists_require_authentication(client, engine):
    r = await client.get(f"{API}/playlists")
    assert r.status_code == 401


async def test_get_nonexistent_playlist_is_404(client, engine):
    viewer = await make_viewer(client)
    r = await client.get(f"{API}/playlists/{uuid.uuid4()}", headers=viewer)
    assert r.status_code == 404


# ── Items ────────────────────────────────────────────────────────────────────
async def test_add_item_appends_and_updates_counts(client, engine):
    viewer = await make_viewer(client)
    playlist = await make_playlist(client, viewer)
    sid = await make_published_sermon(client, engine)

    r = await client.post(f"{API}/playlists/{playlist['id']}/items", json={"sermon_id": sid}, headers=viewer)
    assert r.status_code == 201
    body = r.json()
    assert body["item_count"] == 1
    assert body["total_duration_seconds"] == 600
    assert len(body["items"]) == 1
    assert body["items"][0]["sermon"]["id"] == sid
    assert body["items"][0]["position"] == 0


async def test_adding_the_same_sermon_twice_is_allowed(client, engine):
    viewer = await make_viewer(client)
    playlist = await make_playlist(client, viewer)
    sid = await make_published_sermon(client, engine)

    await client.post(f"{API}/playlists/{playlist['id']}/items", json={"sermon_id": sid}, headers=viewer)
    r = await client.post(f"{API}/playlists/{playlist['id']}/items", json={"sermon_id": sid}, headers=viewer)
    assert r.status_code == 201
    body = r.json()
    assert body["item_count"] == 2
    assert [i["position"] for i in body["items"]] == [0, 1]


async def test_adding_an_unpublished_sermon_is_404_for_a_viewer(client, engine):
    editor = await make_user(client, engine, _unique_email("ed"), "editor")
    viewer = await make_viewer(client)
    playlist = await make_playlist(client, viewer)
    sid = (await client.post(f"{API}/sermons", json={"title": "Draft"}, headers=editor)).json()["id"]

    r = await client.post(f"{API}/playlists/{playlist['id']}/items", json={"sermon_id": sid}, headers=viewer)
    assert r.status_code == 404


async def test_adding_a_nonexistent_sermon_is_404(client, engine):
    viewer = await make_viewer(client)
    playlist = await make_playlist(client, viewer)

    r = await client.post(
        f"{API}/playlists/{playlist['id']}/items", json={"sermon_id": str(uuid.uuid4())}, headers=viewer
    )
    assert r.status_code == 404


async def test_remove_item(client, engine):
    viewer = await make_viewer(client)
    playlist = await make_playlist(client, viewer)
    sid = await make_published_sermon(client, engine)
    added = (await client.post(
        f"{API}/playlists/{playlist['id']}/items", json={"sermon_id": sid}, headers=viewer
    )).json()
    item_id = added["items"][0]["id"]

    r = await client.delete(f"{API}/playlists/{playlist['id']}/items/{item_id}", headers=viewer)
    assert r.status_code == 200
    assert r.json()["item_count"] == 0


async def test_removing_a_nonexistent_item_is_404(client, engine):
    viewer = await make_viewer(client)
    playlist = await make_playlist(client, viewer)

    r = await client.delete(f"{API}/playlists/{playlist['id']}/items/{uuid.uuid4()}", headers=viewer)
    assert r.status_code == 404


async def test_reorder_items(client, engine):
    viewer = await make_viewer(client)
    playlist = await make_playlist(client, viewer)
    s1 = await make_published_sermon(client, engine, "First")
    s2 = await make_published_sermon(client, engine, "Second")
    await client.post(f"{API}/playlists/{playlist['id']}/items", json={"sermon_id": s1}, headers=viewer)
    detail = (await client.post(
        f"{API}/playlists/{playlist['id']}/items", json={"sermon_id": s2}, headers=viewer
    )).json()
    item_ids = [i["id"] for i in detail["items"]]
    reversed_ids = list(reversed(item_ids))

    r = await client.put(
        f"{API}/playlists/{playlist['id']}/items/order", json={"item_ids": reversed_ids}, headers=viewer
    )
    assert r.status_code == 200
    body = r.json()
    assert [i["id"] for i in body["items"]] == reversed_ids
    assert [i["position"] for i in body["items"]] == [0, 1]


async def test_reorder_rejects_a_partial_or_mismatched_set(client, engine):
    viewer = await make_viewer(client)
    playlist = await make_playlist(client, viewer)
    sid = await make_published_sermon(client, engine)
    await client.post(f"{API}/playlists/{playlist['id']}/items", json={"sermon_id": sid}, headers=viewer)

    r = await client.put(
        f"{API}/playlists/{playlist['id']}/items/order", json={"item_ids": [str(uuid.uuid4())]}, headers=viewer
    )
    assert r.status_code == 400


async def test_items_cannot_be_added_to_another_viewer_s_playlist(client, engine):
    owner = await make_viewer(client)
    intruder = await make_viewer(client)
    playlist = await make_playlist(client, owner)
    sid = await make_published_sermon(client, engine)

    r = await client.post(f"{API}/playlists/{playlist['id']}/items", json={"sermon_id": sid}, headers=intruder)
    assert r.status_code == 404


# ── Cover art ────────────────────────────────────────────────────────────────
async def test_cover_ticket_and_confirm(client, engine):
    viewer = await make_viewer(client)
    playlist = await make_playlist(client, viewer)

    ticket = await client.post(
        f"{API}/playlists/{playlist['id']}/cover/upload-ticket",
        json={"filename": "cover.jpg", "content_type": "image/jpeg"},
        headers=viewer,
    )
    assert ticket.status_code == 201
    body = ticket.json()
    assert body["upload_url"].startswith("https://")
    assert body["cover_key"].startswith(f"playlist_covers/{playlist['id']}/")

    confirm = await client.post(
        f"{API}/playlists/{playlist['id']}/cover/confirm", params={"cover_key": body["cover_key"]}, headers=viewer
    )
    assert confirm.status_code == 200
    assert confirm.json()["cover_url"]

    fetched = (await client.get(f"{API}/playlists/{playlist['id']}", headers=viewer)).json()
    assert fetched["cover_url"]


async def test_cover_confirm_rejects_a_key_outside_this_playlist_s_prefix(client, engine):
    viewer = await make_viewer(client)
    playlist = await make_playlist(client, viewer)

    r = await client.post(
        f"{API}/playlists/{playlist['id']}/cover/confirm",
        params={"cover_key": f"playlist_covers/{uuid.uuid4()}/x.jpg"},
        headers=viewer,
    )
    assert r.status_code == 400


async def test_cover_cannot_be_set_on_another_viewer_s_playlist(client, engine):
    owner = await make_viewer(client)
    intruder = await make_viewer(client)
    playlist = await make_playlist(client, owner)

    r = await client.post(
        f"{API}/playlists/{playlist['id']}/cover/upload-ticket",
        json={"filename": "cover.jpg", "content_type": "image/jpeg"},
        headers=intruder,
    )
    assert r.status_code == 404
