"""Sermon/series likes (Isaac's ask, session 2026-10-09): `PUT`/`DELETE
/catalog/sermons/{id}/like` and `PUT`/`DELETE /series/{id}/like`, plus the
`like_count`/`liked_by_me` fields on `SermonDetail` and `SeriesPublic`.
"""
import itertools

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


async def make_viewer(client, email="viewer@example.com"):
    await client.post(f"{API}/auth/register", json={"email": email, "password": PW})
    tokens = (await client.post(f"{API}/auth/login", json={"email": email, "password": PW})).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def publish_sermon(client, editor, manager, sid):
    await client.post(f"{API}/sermons/{sid}/submit", headers=editor)
    await client.post(f"{API}/approvals/sermons/{sid}/approve", headers=manager)
    await client.post(f"{API}/approvals/sermons/{sid}/publish", headers=manager)


async def make_published_sermon(client, engine, title="A Sermon"):
    editor = await make_user(client, engine, _unique_email("ed"), "editor")
    manager = await make_user(client, engine, _unique_email("mgr"), "manager")
    sid = (await client.post(f"{API}/sermons", json={"title": title}, headers=editor)).json()["id"]
    await publish_sermon(client, editor, manager, sid)
    return sid


async def make_published_series(client, engine, title="A Series"):
    manager = await make_user(client, engine, _unique_email("smgr"), "manager")
    series_id = (await client.post(f"{API}/series", json={"title": title}, headers=manager)).json()["id"]
    await client.patch(f"{API}/series/{series_id}", json={"status": "published"}, headers=manager)
    return series_id


# ── Sermon likes ───────────────────────────────────────────────────────────────
async def test_like_sermon_sets_liked_and_increments_count(client, engine):
    sid = await make_published_sermon(client, engine)
    viewer = await make_viewer(client)

    r = await client.put(f"{API}/catalog/sermons/{sid}/like", headers=viewer)
    assert r.status_code == 200
    assert r.json() == {"liked": True, "like_count": 1}


async def test_liking_twice_is_idempotent_not_a_409(client, engine):
    sid = await make_published_sermon(client, engine)
    viewer = await make_viewer(client)

    await client.put(f"{API}/catalog/sermons/{sid}/like", headers=viewer)
    r = await client.put(f"{API}/catalog/sermons/{sid}/like", headers=viewer)
    assert r.status_code == 200
    assert r.json() == {"liked": True, "like_count": 1}


async def test_unlike_clears_liked_and_decrements_count(client, engine):
    sid = await make_published_sermon(client, engine)
    viewer = await make_viewer(client)
    await client.put(f"{API}/catalog/sermons/{sid}/like", headers=viewer)

    r = await client.delete(f"{API}/catalog/sermons/{sid}/like", headers=viewer)
    assert r.status_code == 200
    assert r.json() == {"liked": False, "like_count": 0}


async def test_unliking_something_never_liked_is_a_no_op(client, engine):
    sid = await make_published_sermon(client, engine)
    viewer = await make_viewer(client)

    r = await client.delete(f"{API}/catalog/sermons/{sid}/like", headers=viewer)
    assert r.status_code == 200
    assert r.json() == {"liked": False, "like_count": 0}


async def test_sermon_detail_reflects_like_count_and_per_viewer_liked_state(client, engine):
    sid = await make_published_sermon(client, engine)
    liker = await make_viewer(client, "liker@example.com")
    other = await make_viewer(client, "other@example.com")
    await client.put(f"{API}/catalog/sermons/{sid}/like", headers=liker)

    mine = (await client.get(f"{API}/catalog/sermons/{sid}", headers=liker)).json()
    assert mine["like_count"] == 1 and mine["liked_by_me"] is True

    theirs = (await client.get(f"{API}/catalog/sermons/{sid}", headers=other)).json()
    assert theirs["like_count"] == 1 and theirs["liked_by_me"] is False

    anon = (await client.get(f"{API}/catalog/sermons/{sid}")).json()
    assert anon["like_count"] == 1 and anon["liked_by_me"] is False


async def test_two_viewers_liking_the_same_sermon_both_count(client, engine):
    sid = await make_published_sermon(client, engine)
    a = await make_viewer(client, "a@example.com")
    b = await make_viewer(client, "b@example.com")
    await client.put(f"{API}/catalog/sermons/{sid}/like", headers=a)
    await client.put(f"{API}/catalog/sermons/{sid}/like", headers=b)

    r = await client.get(f"{API}/catalog/sermons/{sid}")
    assert r.json()["like_count"] == 2


async def test_liking_a_nonexistent_sermon_is_404(client, engine):
    viewer = await make_viewer(client)
    import uuid

    r = await client.put(f"{API}/catalog/sermons/{uuid.uuid4()}/like", headers=viewer)
    assert r.status_code == 404


async def test_liking_an_unpublished_sermon_is_404_for_a_viewer(client, engine):
    editor = await make_user(client, engine, "ed2@example.com", "editor")
    viewer = await make_viewer(client)
    sid = (await client.post(f"{API}/sermons", json={"title": "Draft"}, headers=editor)).json()["id"]

    r = await client.put(f"{API}/catalog/sermons/{sid}/like", headers=viewer)
    assert r.status_code == 404


async def test_liking_requires_authentication(client, engine):
    sid = await make_published_sermon(client, engine)
    r = await client.put(f"{API}/catalog/sermons/{sid}/like")
    assert r.status_code == 401


# ── Series likes ─────────────────────────────────────────────────────────────
async def test_like_series_sets_liked_and_increments_count(client, engine):
    series_id = await make_published_series(client, engine)
    viewer = await make_viewer(client)

    r = await client.put(f"{API}/series/{series_id}/like", headers=viewer)
    assert r.status_code == 200
    assert r.json() == {"liked": True, "like_count": 1}


async def test_unlike_series(client, engine):
    series_id = await make_published_series(client, engine)
    viewer = await make_viewer(client)
    await client.put(f"{API}/series/{series_id}/like", headers=viewer)

    r = await client.delete(f"{API}/series/{series_id}/like", headers=viewer)
    assert r.status_code == 200
    assert r.json() == {"liked": False, "like_count": 0}


async def test_series_detail_and_list_both_reflect_like_state(client, engine):
    series_id = await make_published_series(client, engine)
    viewer = await make_viewer(client)
    await client.put(f"{API}/series/{series_id}/like", headers=viewer)

    detail = (await client.get(f"{API}/series/{series_id}", headers=viewer)).json()
    assert detail["like_count"] == 1 and detail["liked_by_me"] is True

    listing = (await client.get(f"{API}/series", headers=viewer)).json()
    row = next(s for s in listing if s["id"] == series_id)
    assert row["like_count"] == 1 and row["liked_by_me"] is True

    anon_listing = (await client.get(f"{API}/series")).json()
    anon_row = next(s for s in anon_listing if s["id"] == series_id)
    assert anon_row["like_count"] == 1 and anon_row["liked_by_me"] is False


async def test_liking_a_nonexistent_series_is_404(client, engine):
    viewer = await make_viewer(client)
    import uuid

    r = await client.put(f"{API}/series/{uuid.uuid4()}/like", headers=viewer)
    assert r.status_code == 404
