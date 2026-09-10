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
            text("UPDATE users SET role = :role WHERE email = :email"),
            {"role": role.upper(), "email": email},
        )
        await s.commit()
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": email, "password": PW}
    )).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def _token_from_link(link: str) -> str:
    return link.split("token=", 1)[1]


async def db_user_id(engine, email):
    """The user's id, read straight from the DB fixture.

    `GET /api/v1/users` is hard-scoped to staff roles for every actor
    (plan §A.6) — a viewer is not in it, so role-management tests seed their
    target through the DB and take the id from the created row rather than
    discovering it via the list endpoint. Used for staff targets too, so every
    test in this module is decoupled from the list endpoint's scoping.
    """
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import User

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        return str((await s.execute(
            select(User).where(User.email == email)
        )).scalar_one().id)


# ── staff creation + invite flow ──────────────────────────────────────────────
async def test_admin_creates_editor_and_invite_activates(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")

    r = await client.post(
        "/api/v1/users",
        json={"email": "editor@example.com", "full_name": "Ed", "role": "editor"},
        headers=admin,
    )
    assert r.status_code == 201
    body = r.json()
    assert body["user"]["role"] == "editor"
    assert body["user"]["is_active"] is True
    assert body["invite_link"]  # surfaced in dev

    # New staff cannot log in yet (temp password is unknown to them).
    bad = await client.post(
        "/api/v1/auth/login",
        json={"email": "editor@example.com", "password": PW},
    )
    assert bad.status_code == 401

    # They set their password via the invite link, then log in.
    token = _token_from_link(body["invite_link"])

    # The invite carries its own type marker, distinct from a self-service reset.
    from app.core import security

    payload = security.decode_token(token, security.INVITE)
    assert payload is not None and payload["type"] == "invite"

    r = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "my-own-strong-pass"},
    )
    assert r.status_code == 200
    ok = await client.post(
        "/api/v1/auth/login",
        json={"email": "editor@example.com", "password": "my-own-strong-pass"},
    )
    assert ok.status_code == 200

    # Single-use: the invite link cannot be replayed to reset the password again.
    replay = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "a-different-strong-pass"},
    )
    assert replay.status_code == 400
    still_ok = await client.post(
        "/api/v1/auth/login",
        json={"email": "editor@example.com", "password": "my-own-strong-pass"},
    )
    assert still_ok.status_code == 200


async def test_viewer_cannot_create_staff(client, engine):
    await client.post("/api/v1/auth/register", json={"email": "v@example.com", "password": PW})
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": "v@example.com", "password": PW}
    )).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    r = await client.post(
        "/api/v1/users", json={"email": "x@example.com", "role": "editor"}, headers=headers
    )
    assert r.status_code == 403


async def test_cannot_create_viewer_via_staff_endpoint(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    r = await client.post(
        "/api/v1/users", json={"email": "x@example.com", "role": "viewer"}, headers=admin
    )
    assert r.status_code == 422


async def test_manager_cannot_create_admin(client, engine):
    manager = await make_user(client, engine, "mgr@example.com", "manager")
    r = await client.post(
        "/api/v1/users", json={"email": "x@example.com", "role": "admin"}, headers=manager
    )
    assert r.status_code == 400  # not permitted to create admin


async def test_manager_can_create_editor(client, engine):
    manager = await make_user(client, engine, "mgr@example.com", "manager")
    r = await client.post(
        "/api/v1/users", json={"email": "ed@example.com", "role": "editor"}, headers=manager
    )
    assert r.status_code == 201


async def test_duplicate_staff_email_rejected(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    await client.post(
        "/api/v1/users", json={"email": "dup@example.com", "role": "editor"}, headers=admin
    )
    r = await client.post(
        "/api/v1/users", json={"email": "dup@example.com", "role": "editor"}, headers=admin
    )
    assert r.status_code == 400


# ── role changes ──────────────────────────────────────────────────────────────
async def test_admin_changes_role(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    await make_user(client, engine, "v@example.com", "viewer")

    # The viewer is not in GET /users (staff-scoped) — take its id from the DB.
    vid = await db_user_id(engine, "v@example.com")

    r = await client.patch(
        f"/api/v1/users/{vid}/role", json={"role": "manager"}, headers=admin
    )
    assert r.status_code == 200 and r.json()["role"] == "manager"


async def test_manager_can_promote_to_editor_only(client, engine):
    manager = await make_user(client, engine, "mgr@example.com", "manager")
    await make_user(client, engine, "v@example.com", "viewer")
    vid = await db_user_id(engine, "v@example.com")

    # Editor: allowed.
    r = await client.patch(
        f"/api/v1/users/{vid}/role", json={"role": "editor"}, headers=manager
    )
    assert r.status_code == 200
    # Admin: forbidden for a manager.
    r = await client.patch(
        f"/api/v1/users/{vid}/role", json={"role": "admin"}, headers=manager
    )
    assert r.status_code == 400


async def test_manager_cannot_modify_another_manager(client, engine):
    await make_user(client, engine, "admin@example.com", "admin")
    manager = await make_user(client, engine, "mgr@example.com", "manager")
    await make_user(client, engine, "mgr2@example.com", "manager")

    other_id = await db_user_id(engine, "mgr2@example.com")

    r = await client.patch(
        f"/api/v1/users/{other_id}/role", json={"role": "editor"}, headers=manager
    )
    assert r.status_code == 400


async def test_cannot_change_own_role(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    aid = await db_user_id(engine, "admin@example.com")
    r = await client.patch(
        f"/api/v1/users/{aid}/role", json={"role": "editor"}, headers=admin
    )
    assert r.status_code == 400


async def test_role_change_revokes_refresh(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    # Register a viewer and capture their refresh token.
    await client.post("/api/v1/auth/register", json={"email": "v@example.com", "password": PW})
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": "v@example.com", "password": PW}
    )).json()

    vid = await db_user_id(engine, "v@example.com")
    await client.patch(f"/api/v1/users/{vid}/role", json={"role": "editor"}, headers=admin)

    # Their pre-change refresh token is now revoked.
    r = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert r.status_code == 401
