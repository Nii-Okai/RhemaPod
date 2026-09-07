import pytest

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"       # >= 12 chars, not common
NEW_PW = "brand-new-passphrase-9"


async def register(client, email="user@example.com", password=PW):
    return await client.post(
        "/api/v1/auth/register", json={"email": email, "password": password}
    )


async def login(client, email="user@example.com", password=PW):
    return await client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )


async def test_register_returns_viewer(client):
    r = await register(client)
    assert r.status_code == 201
    body = r.json()
    assert body["email"] == "user@example.com"
    assert body["role"] == "viewer"
    assert body["is_active"] is True
    assert "password" not in body and "password_hash" not in body


async def test_short_password_rejected(client):
    r = await register(client, password="short1")
    assert r.status_code == 422


async def test_common_password_rejected(client):
    r = await register(client, password="password1234")
    assert r.status_code == 422


async def test_duplicate_register_rejected(client):
    await register(client)
    r = await register(client)
    assert r.status_code == 400


async def test_login_returns_token_pair(client):
    await register(client)
    r = await login(client)
    assert r.status_code == 200
    body = r.json()
    assert body["access_token"] and body["refresh_token"]
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 15 * 60


async def test_login_wrong_password(client):
    await register(client)
    r = await login(client, password="totally-wrong-pw")
    assert r.status_code == 401


async def test_me_requires_auth(client):
    r = await client.get("/api/v1/auth/me")
    assert r.status_code in (401, 403)


async def test_me_with_token(client):
    await register(client)
    tokens = (await login(client)).json()
    r = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert r.status_code == 200
    assert r.json()["email"] == "user@example.com"


async def test_refresh_rotates(client):
    await register(client)
    tokens = (await login(client)).json()
    r = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 200
    new_tokens = r.json()
    assert new_tokens["refresh_token"] != tokens["refresh_token"]

    reuse = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert reuse.status_code == 401


async def test_access_token_rejected_as_refresh(client):
    # Type confusion guard: an access token must not work on /refresh.
    await register(client)
    tokens = (await login(client)).json()
    r = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["access_token"]}
    )
    assert r.status_code == 401


async def test_logout_revokes_refresh(client):
    await register(client)
    tokens = (await login(client)).json()
    await client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    r = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 401


async def test_role_enforcement_forbids_viewer(client):
    await register(client)
    tokens = (await login(client)).json()
    r = await client.get(
        "/api/v1/users",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert r.status_code == 403


async def test_change_password_requires_current(client):
    await register(client)
    tokens = (await login(client)).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    # Wrong current password rejected.
    bad = await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "wrong-current-pw", "new_password": NEW_PW},
        headers=headers,
    )
    assert bad.status_code == 400

    # Correct current password succeeds.
    ok = await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": PW, "new_password": NEW_PW},
        headers=headers,
    )
    assert ok.status_code == 200

    # Old password no longer works, new one does.
    assert (await login(client, password=PW)).status_code == 401
    assert (await login(client, password=NEW_PW)).status_code == 200


async def test_change_password_revokes_refresh(client):
    await register(client)
    tokens = (await login(client)).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": PW, "new_password": NEW_PW},
        headers=headers,
    )
    # Refresh token issued before the change must be revoked.
    r = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 401


async def test_forgot_password_is_generic(client):
    r1 = await client.post(
        "/api/v1/auth/forgot-password", json={"email": "nobody@example.com"}
    )
    await register(client)
    r2 = await client.post(
        "/api/v1/auth/forgot-password", json={"email": "user@example.com"}
    )
    assert r1.status_code == r2.status_code == 200
    assert r1.json() == r2.json()


async def test_password_reset_flow(client):
    await register(client)
    from app.core import security, token_store

    tokens = (await login(client)).json()
    me = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    user_id = me.json()["id"]
    # Mint + register the one-shot jti exactly as /auth/forgot-password does.
    reset_token, jti = security.create_reset_token(user_id)
    await token_store.register_single_use(jti, 3600)

    r = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": reset_token, "new_password": NEW_PW},
    )
    assert r.status_code == 200
    assert (await login(client, password=PW)).status_code == 401
    assert (await login(client, password=NEW_PW)).status_code == 200

    # Single-use: the same token replayed inside its TTL is now rejected.
    replay = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": reset_token, "new_password": "yet-another-passphrase-1"},
    )
    assert replay.status_code == 400
    assert (await login(client, password=NEW_PW)).status_code == 200
