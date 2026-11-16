"""Me-page profile editing (Isaac's ask, session 2026-10-09): `PATCH /auth/me/profile`
(first/last name + gender) and the avatar upload-ticket/confirm pair. `PATCH /auth/me`
(plain `full_name`, the comments flow's own name prompt) is untouched and stays covered
by `test_comments.py`'s own `test_au_me_*` tests — this file is additive, not a
replacement for those.

Not covered here: that `update_profile_name` shares `PROFILE_LIMITS` with
`update_full_name` (both call `comments_service._charge(actor.id, "profile", ...)`,
verifiable by inspection) — this file's own `client`/`engine` fixture pair backs onto a
`FakeRedis` that doesn't implement `.ttl()`, which the rate-limited-request's own
retry-after lookup needs, so a 6th-request-in-an-hour test here 500s on the fixture
itself rather than the code under test. `test_comments.py`'s heavier `pg_client` harness
already exercises `PROFILE_LIMITS` end-to-end against `update_full_name`; the shared
bucket is the same four lines of code, not a second one worth a second harness.
"""
import pytest

pytestmark = pytest.mark.asyncio

API = "/api/v1"
PW = "correct-horse-battery"


async def register_and_login(client):
    email = "profile-user@example.com"
    await client.post(f"{API}/auth/register", json={"email": email, "password": PW})
    tokens = (await client.post(f"{API}/auth/login", json={"email": email, "password": PW})).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def test_update_name_recomputes_full_name_and_returns_new_fields(client):
    headers = await register_and_login(client)
    r = await client.patch(
        f"{API}/auth/me/profile", json={"first_name": "Ada", "last_name": "Lovelace"}, headers=headers
    )
    assert r.status_code == 200
    body = r.json()
    assert body["first_name"] == "Ada"
    assert body["last_name"] == "Lovelace"
    assert body["full_name"] == "Ada Lovelace"

    me = (await client.get(f"{API}/auth/me", headers=headers)).json()
    assert me["full_name"] == "Ada Lovelace"


async def test_first_name_without_last_name_is_rejected(client):
    headers = await register_and_login(client)
    r = await client.patch(f"{API}/auth/me/profile", json={"first_name": "Ada"}, headers=headers)
    assert r.status_code == 422


async def test_name_still_goes_through_content_moderation(client):
    headers = await register_and_login(client)
    r = await client.patch(
        f"{API}/auth/me/profile",
        json={"first_name": "visit example.com", "last_name": "Lovelace"},
        headers=headers,
    )
    assert r.status_code == 422


async def test_gender_update_alone(client):
    headers = await register_and_login(client)
    r = await client.patch(f"{API}/auth/me/profile", json={"gender": "female"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["gender"] == "female"
    # Unrelated fields untouched.
    assert r.json()["first_name"] is None


async def test_name_and_gender_together_in_one_request(client):
    headers = await register_and_login(client)
    r = await client.patch(
        f"{API}/auth/me/profile",
        json={"first_name": "Grace", "last_name": "Hopper", "gender": "female"},
        headers=headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["full_name"] == "Grace Hopper" and body["gender"] == "female"


async def test_invalid_gender_value_is_422(client):
    headers = await register_and_login(client)
    r = await client.patch(f"{API}/auth/me/profile", json={"gender": "other"}, headers=headers)
    assert r.status_code == 422


async def test_extra_fields_are_rejected(client):
    headers = await register_and_login(client)
    r = await client.patch(f"{API}/auth/me/profile", json={"role": "admin"}, headers=headers)
    assert r.status_code == 422


async def test_avatar_ticket_and_confirm(client):
    headers = await register_and_login(client)
    ticket = await client.post(
        f"{API}/auth/me/avatar/upload-ticket",
        json={"filename": "selfie.jpg", "content_type": "image/jpeg"},
        headers=headers,
    )
    assert ticket.status_code == 201
    body = ticket.json()
    assert body["upload_url"].startswith("https://")
    assert body["headers"]["Content-Type"] == "image/jpeg"
    assert body["avatar_key"].startswith("avatars/")

    confirm = await client.post(
        f"{API}/auth/me/avatar/confirm", params={"avatar_key": body["avatar_key"]}, headers=headers
    )
    assert confirm.status_code == 200
    assert confirm.json()["avatar_url"]

    me = (await client.get(f"{API}/auth/me", headers=headers)).json()
    assert me["avatar_url"]


async def test_avatar_confirm_rejects_a_key_outside_the_caller_s_own_prefix(client):
    headers = await register_and_login(client)
    r = await client.post(
        f"{API}/auth/me/avatar/confirm",
        params={"avatar_key": "avatars/00000000-0000-0000-0000-000000000000/x.jpg"},
        headers=headers,
    )
    assert r.status_code == 400


async def test_avatar_confirm_without_a_real_upload_is_409(client):
    headers = await register_and_login(client)
    my_id = (await client.get(f"{API}/auth/me", headers=headers)).json()["id"]

    fake_key = f"avatars/{my_id}/never-uploaded.jpg"
    r = await client.post(f"{API}/auth/me/avatar/confirm", params={"avatar_key": fake_key}, headers=headers)
    assert r.status_code == 409


async def test_avatar_ticket_rejects_unsupported_content_type(client):
    headers = await register_and_login(client)
    r = await client.post(
        f"{API}/auth/me/avatar/upload-ticket",
        json={"filename": "doc.pdf", "content_type": "application/pdf"},
        headers=headers,
    )
    assert r.status_code == 400


async def test_oversize_avatar_is_rejected_and_cleaned_up(client, monkeypatch):
    from app.core import storage as storage_module

    headers = await register_and_login(client)
    ticket = (
        await client.post(
            f"{API}/auth/me/avatar/upload-ticket",
            json={"filename": "big.jpg", "content_type": "image/jpeg"},
            headers=headers,
        )
    ).json()
    key = ticket["avatar_key"]

    store = storage_module.get_storage()
    monkeypatch.setattr(store, "object_size", lambda bucket, k: 50 * 1024 * 1024)

    r = await client.post(f"{API}/auth/me/avatar/confirm", params={"avatar_key": key}, headers=headers)
    assert r.status_code == 413
    assert not store.object_exists(storage_module.settings.object_store_media_bucket, key)
