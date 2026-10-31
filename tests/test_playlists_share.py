"""Share-links Phase 2 (S12): signed-in non-owners can read a PUBLIC playlist.

Real Postgres (`pg_client`/`pg_engine`). Matrix: owner / non-owner x public /
private / missing / blocked (both directions), the uniform 404 body, "First L."
owner naming with no full name/email/user id leaking, item filtering, owner-only
mutations, and the make-public content rule.
"""
import itertools
import uuid

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.text_safety import BLOCKED_TERMS
from app.models.models import Sermon, SermonStatus, User, UserBlock

pytestmark = pytest.mark.asyncio

API = "/api/v1"
PW = "correct-horse-battery"
_n = itertools.count()
NOT_FOUND = {"detail": "Playlist not found"}


def err(r):
    """Error body minus the per-request correlation_id (unique by design)."""
    body = r.json()
    assert isinstance(body.pop("correlation_id"), str)
    return body


def _sessions(engine):
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Who:
    def __init__(self, headers, email, user_id):
        self.headers, self.email, self.id = headers, email, user_id


async def make_user(client, engine, role="viewer", full_name=None):
    email = f"pls{next(_n)}@example.com"
    await client.post(f"{API}/auth/register", json={"email": email, "password": PW})
    async with _sessions(engine)() as s:
        user = (await s.execute(select(User).where(User.email == email))).scalar_one()
        user.role = type(user.role)(role)
        user.full_name = full_name
        await s.commit()
        uid = user.id
    tokens = (await client.post(f"{API}/auth/login", json={"email": email, "password": PW})).json()
    return Who({"Authorization": f"Bearer {tokens['access_token']}"}, email, uid)


async def block(engine, blocker, blocked):
    async with _sessions(engine)() as s:
        s.add(UserBlock(blocker_id=blocker.id, blocked_id=blocked.id))
        await s.commit()


async def make_playlist(client, who, **body):
    body.setdefault("name", "Morning Dew")
    r = await client.post(f"{API}/playlists", json=body, headers=who.headers)
    assert r.status_code == 201, r.text
    return r.json()


async def publish_sermon(client, engine, title, series_id=None):
    ed = await make_user(client, engine, "editor")
    mgr = await make_user(client, engine, "manager")
    body = {"title": title}
    if series_id:
        body["series_id"] = series_id
    sid = (await client.post(f"{API}/sermons", json=body, headers=ed.headers)).json()["id"]
    await client.post(f"{API}/sermons/{sid}/submit", headers=ed.headers)
    await client.post(f"{API}/approvals/sermons/{sid}/approve", headers=mgr.headers)
    r = await client.post(f"{API}/approvals/sermons/{sid}/publish", headers=mgr.headers)
    assert r.status_code == 200, r.text
    return sid


async def add(client, who, pid, sid):
    r = await client.post(f"{API}/playlists/{pid}/items", json={"sermon_id": sid}, headers=who.headers)
    assert r.status_code == 201, r.text
    return r.json()


async def get(client, who, pid):
    return await client.get(f"{API}/playlists/{pid}", headers=who.headers)


# ── Access matrix ────────────────────────────────────────────────────────────
async def test_owner_reads_own_private_playlist_with_full_name(pg_client, pg_engine):
    owner = await make_user(pg_client, pg_engine, full_name="Nii Kwame Okai")
    pl = await make_playlist(pg_client, owner)
    r = await get(pg_client, owner, pl["id"])
    assert r.status_code == 200
    assert r.json()["is_owner"] is True
    assert r.json()["owner_name"] == "Nii Kwame Okai"
    assert r.json()["is_public"] is False


async def test_non_owner_reads_public_playlist(pg_client, pg_engine):
    owner = await make_user(pg_client, pg_engine, full_name="Nii Kwame Okai")
    viewer = await make_user(pg_client, pg_engine)
    pl = await make_playlist(pg_client, owner, is_public=True, description="Gentle songs")
    r = await get(pg_client, viewer, pl["id"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_owner"] is False
    assert body["owner_name"] == "Nii O."
    assert body["name"] == "Morning Dew"
    assert body["items"] == []


async def test_non_owner_response_never_leaks_owner_identity(pg_client, pg_engine):
    owner = await make_user(pg_client, pg_engine, full_name="Nii Kwame Okai")
    viewer = await make_user(pg_client, pg_engine)
    pl = await make_playlist(pg_client, owner, is_public=True)
    sid = await publish_sermon(pg_client, pg_engine, "Grace")
    await add(pg_client, owner, pl["id"], sid)
    raw = (await get(pg_client, viewer, pl["id"])).text
    for secret in ("Kwame", "Nii Kwame Okai", owner.email, str(owner.id)):
        assert secret not in raw, secret


async def test_single_name_owner_shown_as_is(pg_client, pg_engine):
    owner = await make_user(pg_client, pg_engine, full_name="Ama")
    viewer = await make_user(pg_client, pg_engine)
    pl = await make_playlist(pg_client, owner, is_public=True)
    assert (await get(pg_client, viewer, pl["id"])).json()["owner_name"] == "Ama"


async def test_private_missing_and_blocked_share_one_identical_404(pg_client, pg_engine):
    owner = await make_user(pg_client, pg_engine)
    viewer = await make_user(pg_client, pg_engine)
    blocked_by_viewer = await make_user(pg_client, pg_engine)
    blocker_of_viewer = await make_user(pg_client, pg_engine)

    private = await make_playlist(pg_client, owner)
    pub_a = await make_playlist(pg_client, blocked_by_viewer, is_public=True)
    pub_b = await make_playlist(pg_client, blocker_of_viewer, is_public=True)
    await block(pg_engine, viewer, blocked_by_viewer)  # viewer blocked owner A
    await block(pg_engine, blocker_of_viewer, viewer)  # owner B blocked viewer

    responses = [
        await get(pg_client, viewer, private["id"]),
        await get(pg_client, viewer, str(uuid.uuid4())),
        await get(pg_client, viewer, pub_a["id"]),
        await get(pg_client, viewer, pub_b["id"]),
    ]
    for r in responses:
        assert r.status_code == 404
        assert err(r) == NOT_FOUND
    assert len({r.status_code for r in responses}) == 1


async def test_block_does_not_affect_unrelated_viewers_or_the_owner(pg_client, pg_engine):
    owner = await make_user(pg_client, pg_engine)
    blocked = await make_user(pg_client, pg_engine)
    other = await make_user(pg_client, pg_engine)
    pl = await make_playlist(pg_client, owner, is_public=True)
    await block(pg_engine, owner, blocked)
    assert (await get(pg_client, blocked, pl["id"])).status_code == 404
    assert (await get(pg_client, other, pl["id"])).status_code == 200
    assert (await get(pg_client, owner, pl["id"])).status_code == 200


async def test_unauthenticated_is_401(pg_client, pg_engine):
    owner = await make_user(pg_client, pg_engine)
    pl = await make_playlist(pg_client, owner, is_public=True)
    assert (await pg_client.get(f"{API}/playlists/{pl['id']}")).status_code == 401


async def test_list_still_returns_only_own_playlists(pg_client, pg_engine):
    owner = await make_user(pg_client, pg_engine)
    viewer = await make_user(pg_client, pg_engine)
    await make_playlist(pg_client, owner, is_public=True)
    r = await pg_client.get(f"{API}/playlists", headers=viewer.headers)
    assert r.status_code == 200 and r.json() == []


# ── Items ────────────────────────────────────────────────────────────────────
async def test_non_owner_items_exclude_unpublished_sermons(pg_client, pg_engine):
    owner = await make_user(pg_client, pg_engine)
    viewer = await make_user(pg_client, pg_engine)
    pl = await make_playlist(pg_client, owner, is_public=True)
    live = await publish_sermon(pg_client, pg_engine, "Live")
    gone = await publish_sermon(pg_client, pg_engine, "Gone")
    await add(pg_client, owner, pl["id"], live)
    await add(pg_client, owner, pl["id"], gone)
    async with _sessions(pg_engine)() as s:
        await s.execute(update(Sermon).where(Sermon.id == uuid.UUID(gone)).values(status=SermonStatus.UNPUBLISHED))
        await s.commit()
    body = (await get(pg_client, viewer, pl["id"])).json()
    assert [i["sermon"]["title"] for i in body["items"]] == ["Live"]
    assert body["item_count"] == 1


async def test_non_owner_sees_null_series_title_for_draft_series(pg_client, pg_engine):
    owner = await make_user(pg_client, pg_engine)
    viewer = await make_user(pg_client, pg_engine)
    ed = await make_user(pg_client, pg_engine, "editor")
    series = (await pg_client.post(f"{API}/series", json={"title": "Secret Draft Series"}, headers=ed.headers)).json()
    sid = await publish_sermon(pg_client, pg_engine, "Episode", series_id=series["id"])
    pl = await make_playlist(pg_client, owner, is_public=True)
    await add(pg_client, owner, pl["id"], sid)
    r = await get(pg_client, viewer, pl["id"])
    assert r.status_code == 200
    item = r.json()["items"][0]["sermon"]
    assert item["series_title"] is None
    assert "Secret Draft Series" not in r.text


# ── Owner-only mutations ─────────────────────────────────────────────────────
async def test_non_owner_cannot_mutate_a_public_playlist(pg_client, pg_engine):
    owner = await make_user(pg_client, pg_engine)
    intruder = await make_user(pg_client, pg_engine)
    pl = await make_playlist(pg_client, owner, is_public=True)
    sid = await publish_sermon(pg_client, pg_engine, "Mine")
    detail = await add(pg_client, owner, pl["id"], sid)
    item_id = detail["items"][0]["id"]
    h, base = intruder.headers, f"{API}/playlists/{pl['id']}"

    calls = [
        await pg_client.patch(base, json={"name": "Hijacked"}, headers=h),
        await pg_client.delete(base, headers=h),
        await pg_client.post(f"{base}/items", json={"sermon_id": sid}, headers=h),
        await pg_client.delete(f"{base}/items/{item_id}", headers=h),
        await pg_client.put(f"{base}/items/order", json={"item_ids": [item_id]}, headers=h),
        await pg_client.post(
            f"{base}/cover/upload-ticket", json={"filename": "a.png", "content_type": "image/png"}, headers=h
        ),
        await pg_client.post(f"{base}/cover/confirm", params={"cover_key": "x"}, headers=h),
    ]
    for r in calls:
        assert r.status_code == 404, r.text
        assert err(r) == NOT_FOUND
    still = (await get(pg_client, owner, pl["id"])).json()
    assert still["name"] == "Morning Dew" and len(still["items"]) == 1


# ── Make-public content rule ─────────────────────────────────────────────────
def _blocked_word() -> str:
    return sorted(t for t in BLOCKED_TERMS if " " not in t and len(t) >= 4)[0]


@pytest.mark.parametrize("field", ["name", "description"])
@pytest.mark.parametrize(
    "bad",
    ["see https://example.com now", "call me on 0244 123 456", "mail me at a.b@gmail.com", "BLOCKED"],
)
async def test_make_public_rejects_unsafe_text(pg_client, pg_engine, field, bad):
    owner = await make_user(pg_client, pg_engine)
    pl = await make_playlist(pg_client, owner)
    bad = _blocked_word() if bad == "BLOCKED" else bad
    patch = {"is_public": True, field: bad}
    r = await pg_client.patch(f"{API}/playlists/{pl['id']}", json=patch, headers=owner.headers)
    assert r.status_code == 400, r.text
    assert set(err(r)) == {"detail"} and isinstance(r.json()["detail"], str)
    after = await get(pg_client, owner, pl["id"])
    assert after.json()["is_public"] is False and after.json()["name"] == "Morning Dew"


async def test_make_public_checks_stored_text_when_only_flag_changes(pg_client, pg_engine):
    owner = await make_user(pg_client, pg_engine)
    pl = await make_playlist(pg_client, owner, description="visit www.example.com")
    r = await pg_client.patch(f"{API}/playlists/{pl['id']}", json={"is_public": True}, headers=owner.headers)
    assert r.status_code == 400


async def test_create_public_with_unsafe_text_is_400(pg_client, pg_engine):
    owner = await make_user(pg_client, pg_engine)
    r = await pg_client.post(
        f"{API}/playlists", json={"name": "https://spam.example", "is_public": True}, headers=owner.headers
    )
    assert r.status_code == 400


async def test_private_playlist_may_hold_any_text(pg_client, pg_engine):
    owner = await make_user(pg_client, pg_engine)
    pl = await make_playlist(pg_client, owner, name="https://spam.example")
    r = await pg_client.patch(f"{API}/playlists/{pl['id']}", json={"description": "call 0244 123 456"}, headers=owner.headers)
    assert r.status_code == 200


async def test_make_public_with_clean_text_is_200(pg_client, pg_engine):
    owner = await make_user(pg_client, pg_engine)
    pl = await make_playlist(pg_client, owner, description="Songs for quiet mornings")
    r = await pg_client.patch(f"{API}/playlists/{pl['id']}", json={"is_public": True}, headers=owner.headers)
    assert r.status_code == 200 and r.json()["is_public"] is True
