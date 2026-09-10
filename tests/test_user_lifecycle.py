"""W18 — user lifecycle backend.

`PATCH /api/v1/users/{id}/active` (deactivate / reactivate), the last-admin
minimum-cardinality invariant on both `change_role` and the deactivate path,
`POST /api/v1/users/{id}/resend-invite`, and the (already-shipped) property that
a deactivated user's live access token is rejected on the next request.

The *concurrent* last-admin race is proved separately, on real PostgreSQL, in
`tests/test_last_admin_concurrent.py` — SQLite ignores `FOR UPDATE` and cannot
reproduce the interleave (plan §A.5, resolved decision 10).
"""
import pytest

from tests.conftest import _fake
from tests.test_auth_hardening import _RecordingLogger

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"


async def _register(client, email, password=PW):
    return await client.post(
        "/api/v1/auth/register", json={"email": email, "password": password}
    )


async def _login_headers(client, email, password=PW):
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def _set_role(engine, email, role):
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await s.execute(
            text("UPDATE users SET role = :r WHERE email = :e"),
            {"r": role.upper(), "e": email},
        )
        await s.commit()


async def make_user(client, engine, email, role):
    """Register `email`, force its role via the DB, return auth headers."""
    await _register(client, email)
    if role != "viewer":
        await _set_role(engine, email, role)
    return await _login_headers(client, email)


async def db_user(engine, email):
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import User

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        return (await s.execute(
            select(User).where(User.email == email)
        )).scalar_one()


async def db_user_id(engine, email):
    return str((await db_user(engine, email)).id)


def _token_from_link(link: str) -> str:
    return link.split("token=", 1)[1]


# ── deactivate / reactivate authz matrix ─────────────────────────────────────
async def test_manager_deactivates_editor(client, engine):
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    await make_user(client, engine, "ed@example.com", "editor")
    eid = await db_user_id(engine, "ed@example.com")

    r = await client.patch(
        f"/api/v1/users/{eid}/active", json={"is_active": False}, headers=mgr
    )
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["is_active"] is False
    assert body["revocation_deferred"] is False
    assert (await db_user(engine, "ed@example.com")).is_active is False


async def test_manager_cannot_deactivate_manager(client, engine):
    await make_user(client, engine, "admin@example.com", "admin")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    await make_user(client, engine, "mgr2@example.com", "manager")
    other = await db_user_id(engine, "mgr2@example.com")

    r = await client.patch(
        f"/api/v1/users/{other}/active", json={"is_active": False}, headers=mgr
    )
    assert r.status_code == 403
    assert (await db_user(engine, "mgr2@example.com")).is_active is True


async def test_manager_cannot_deactivate_admin(client, engine):
    await make_user(client, engine, "admin@example.com", "admin")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    aid = await db_user_id(engine, "admin@example.com")

    r = await client.patch(
        f"/api/v1/users/{aid}/active", json={"is_active": False}, headers=mgr
    )
    assert r.status_code == 403


async def test_manager_cannot_deactivate_self(client, engine):
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    mid = await db_user_id(engine, "mgr@example.com")

    r = await client.patch(
        f"/api/v1/users/{mid}/active", json={"is_active": False}, headers=mgr
    )
    assert r.status_code == 403


async def test_admin_deactivates_editor(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    await make_user(client, engine, "ed@example.com", "editor")
    eid = await db_user_id(engine, "ed@example.com")

    r = await client.patch(
        f"/api/v1/users/{eid}/active", json={"is_active": False}, headers=admin
    )
    assert r.status_code == 200
    assert r.json()["user"]["is_active"] is False


async def test_admin_deactivates_manager(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    await make_user(client, engine, "mgr@example.com", "manager")
    mid = await db_user_id(engine, "mgr@example.com")

    r = await client.patch(
        f"/api/v1/users/{mid}/active", json={"is_active": False}, headers=admin
    )
    assert r.status_code == 200


async def test_editor_cannot_call_active_endpoint(client, engine):
    await make_user(client, engine, "admin@example.com", "admin")
    editor = await make_user(client, engine, "ed@example.com", "editor")
    await make_user(client, engine, "ed2@example.com", "editor")
    target = await db_user_id(engine, "ed2@example.com")

    r = await client.patch(
        f"/api/v1/users/{target}/active", json={"is_active": False}, headers=editor
    )
    assert r.status_code == 403


async def test_viewer_cannot_call_active_endpoint(client, engine):
    await make_user(client, engine, "admin@example.com", "admin")
    viewer = await make_user(client, engine, "v@example.com", "viewer")
    await make_user(client, engine, "ed@example.com", "editor")
    target = await db_user_id(engine, "ed@example.com")

    r = await client.patch(
        f"/api/v1/users/{target}/active", json={"is_active": False}, headers=viewer
    )
    assert r.status_code == 403


async def test_reactivate_editor(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    await make_user(client, engine, "ed@example.com", "editor")
    eid = await db_user_id(engine, "ed@example.com")

    await client.patch(
        f"/api/v1/users/{eid}/active", json={"is_active": False}, headers=admin
    )
    r = await client.patch(
        f"/api/v1/users/{eid}/active", json={"is_active": True}, headers=admin
    )
    assert r.status_code == 200
    assert r.json()["user"]["is_active"] is True
    assert (await db_user(engine, "ed@example.com")).is_active is True


# ── last-admin invariant — sequential, both paths ────────────────────────────
async def test_admin_cannot_deactivate_last_admin(client, engine):
    """The sole active admin cannot deactivate themselves (409, not a silent
    lockout)."""
    admin = await make_user(client, engine, "admin@example.com", "admin")
    aid = await db_user_id(engine, "admin@example.com")

    r = await client.patch(
        f"/api/v1/users/{aid}/active", json={"is_active": False}, headers=admin
    )
    assert r.status_code == 409
    reloaded = await db_user(engine, "admin@example.com")
    assert reloaded.is_active is True and reloaded.role.value == "admin"


async def test_admin_cannot_deactivate_last_active_admin_when_other_admin_inactive(
    client, engine
):
    """A second *inactive* admin row does not satisfy the invariant — the last
    *active* admin is still protected."""
    admin_a = await make_user(client, engine, "a@example.com", "admin")
    await make_user(client, engine, "b@example.com", "admin")
    bid = await db_user_id(engine, "b@example.com")
    aid = await db_user_id(engine, "a@example.com")

    # A deactivates B while both are active → allowed (2 → 1).
    ok = await client.patch(
        f"/api/v1/users/{bid}/active", json={"is_active": False}, headers=admin_a
    )
    assert ok.status_code == 200

    # Now A is the last *active* admin, even though B's row still exists.
    r = await client.patch(
        f"/api/v1/users/{aid}/active", json={"is_active": False}, headers=admin_a
    )
    assert r.status_code == 409
    assert (await db_user(engine, "a@example.com")).is_active is True


async def test_admin_can_deactivate_non_last_admin(client, engine):
    admin_a = await make_user(client, engine, "a@example.com", "admin")
    await make_user(client, engine, "b@example.com", "admin")
    bid = await db_user_id(engine, "b@example.com")

    r = await client.patch(
        f"/api/v1/users/{bid}/active", json={"is_active": False}, headers=admin_a
    )
    assert r.status_code == 200
    assert (await db_user(engine, "b@example.com")).is_active is False


async def test_last_admin_cannot_be_demoted_via_change_role(client, engine):
    """The change_role path: the sole admin can only reach 'demote the last
    admin' by self-demotion, which is refused (the last-admin guard is wired
    into the same path and shares one helper with deactivate)."""
    admin = await make_user(client, engine, "admin@example.com", "admin")
    aid = await db_user_id(engine, "admin@example.com")

    r = await client.patch(
        f"/api/v1/users/{aid}/role", json={"role": "editor"}, headers=admin
    )
    assert r.status_code == 400  # "You cannot change your own role"
    assert (await db_user(engine, "admin@example.com")).role.value == "admin"


async def test_shared_last_admin_guard_blocks_then_allows(client, engine):
    """Direct exercise of the shared helper `change_role` and `set_active` both
    call: it raises 409 with one active admin and is silent with two."""
    from app.services.auth_service import ContentError, _assert_not_last_active_admin
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    await make_user(client, engine, "solo@example.com", "admin")
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Session() as s:
        solo = await db_user(engine, "solo@example.com")
        solo = await s.merge(solo)
        with pytest.raises(ContentError) as ei:
            await _assert_not_last_active_admin(s, solo)
        assert ei.value.status_code == 409

    await make_user(client, engine, "second@example.com", "admin")
    async with Session() as s:
        solo = await s.merge(await db_user(engine, "solo@example.com"))
        # Two active admins now → no raise.
        await _assert_not_last_active_admin(s, solo)


# ── Redis-down deactivation trade (GATE 6 = Option B, commit-first) ──────────
async def test_deactivate_survives_redis_outage_and_defers_revoke(
    client, engine, monkeypatch
):
    """A Redis outage must not block deactivation: is_active=False still
    commits (200), the response flags the deferred revoke, and a warning is
    logged. Contrast change_role, which 503s."""
    import app.services.auth_service as auth_module

    admin = await make_user(client, engine, "admin@example.com", "admin")
    await make_user(client, engine, "ed@example.com", "editor")
    eid = await db_user_id(engine, "ed@example.com")

    recorder = _RecordingLogger()
    monkeypatch.setattr(auth_module, "log", recorder)

    with _fake.failing():
        r = await client.patch(
            f"/api/v1/users/{eid}/active", json={"is_active": False}, headers=admin
        )

    assert r.status_code == 200
    body = r.json()
    assert body["user"]["is_active"] is False
    assert body["revocation_deferred"] is True
    assert (await db_user(engine, "ed@example.com")).is_active is False

    deferred = [
        rec for rec in recorder.records
        if rec["event"] == "deactivate_revoke_deferred"
    ]
    assert len(deferred) == 1 and deferred[0]["user_id"] == eid


# ── deactivated token rejected at next request (TEST ONLY — shipped already) ──
async def test_deactivated_user_live_access_token_rejected_next_request(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    ed_headers = await make_user(client, engine, "ed@example.com", "editor")
    eid = await db_user_id(engine, "ed@example.com")

    # The editor's access token works before deactivation.
    before = await client.get("/api/v1/subscriptions/me", headers=ed_headers)
    assert before.status_code == 200

    d = await client.patch(
        f"/api/v1/users/{eid}/active", json={"is_active": False}, headers=admin
    )
    assert d.status_code == 200

    # Same still-unexpired access token, next request → 401. get_current_user
    # re-reads the row and rejects is_active=False regardless of token TTL.
    after = await client.get("/api/v1/subscriptions/me", headers=ed_headers)
    assert after.status_code == 401


# ── resend-invite ───────────────────────────────────────────────────────────
async def _invite_editor(client, admin_headers, email="newbie@example.com"):
    r = await client.post(
        "/api/v1/users",
        json={"email": email, "full_name": "New Bie", "role": "editor"},
        headers=admin_headers,
    )
    assert r.status_code == 201
    return r.json()


async def test_resend_invite_happy_path(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    created = await _invite_editor(client, admin)
    nid = created["user"]["id"]

    r = await client.post(f"/api/v1/users/{nid}/resend-invite", headers=admin)
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["id"] == nid
    assert body["invite_link"]

    # The re-issued link completes set-password.
    token = _token_from_link(body["invite_link"])
    sp = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "fresh-strong-passphrase"},
    )
    assert sp.status_code == 200
    ok = await client.post(
        "/api/v1/auth/login",
        json={"email": "newbie@example.com", "password": "fresh-strong-passphrase"},
    )
    assert ok.status_code == 200


async def test_resend_invite_after_activation_returns_409(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    created = await _invite_editor(client, admin)
    nid = created["user"]["id"]

    token = _token_from_link(created["invite_link"])
    sp = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "chosen-strong-passphrase"},
    )
    assert sp.status_code == 200

    r = await client.post(f"/api/v1/users/{nid}/resend-invite", headers=admin)
    assert r.status_code == 409


async def test_resend_invite_redis_down_returns_503(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    created = await _invite_editor(client, admin)
    nid = created["user"]["id"]

    with _fake.failing():
        r = await client.post(f"/api/v1/users/{nid}/resend-invite", headers=admin)
    assert r.status_code == 503


async def test_manager_cannot_resend_admin_invite(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    # Admin invites another admin-to-be.
    created = await client.post(
        "/api/v1/users",
        json={"email": "admin2@example.com", "role": "admin"},
        headers=admin,
    )
    assert created.status_code == 201
    nid = created.json()["user"]["id"]

    r = await client.post(f"/api/v1/users/{nid}/resend-invite", headers=mgr)
    assert r.status_code == 403


async def test_manager_can_resend_editor_invite(client, engine):
    await make_user(client, engine, "admin@example.com", "admin")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    created = await client.post(
        "/api/v1/users",
        json={"email": "ed@example.com", "role": "editor"},
        headers=mgr,
    )
    assert created.status_code == 201
    nid = created.json()["user"]["id"]

    r = await client.post(f"/api/v1/users/{nid}/resend-invite", headers=mgr)
    assert r.status_code == 200


# ── the coordinator's extra item: create_staff on a Redis outage ────────────
async def test_create_staff_redis_down_returns_503_and_creates_nothing(client, engine):
    from sqlalchemy import func, select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import User

    admin = await make_user(client, engine, "admin@example.com", "admin")

    with _fake.failing():
        r = await client.post(
            "/api/v1/users",
            json={"email": "ghost@example.com", "role": "editor"},
            headers=admin,
        )
    assert r.status_code == 503
    assert "not created" in r.json()["detail"].lower()

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        n = (await s.execute(
            select(func.count()).select_from(User).where(User.email == "ghost@example.com")
        )).scalar_one()
    assert n == 0


# ── activated_at column: replaces the invite_pending Redis key ──────────────
async def test_user_public_carries_activated_at_through_every_serialization_site(
    client, engine
):
    """`UserPublic.activated_at` is NULL for a freshly invited account and an
    ISO timestamp once set-password completes — on `list_users`, `change_role`,
    and the `PATCH /active` lifecycle response alike."""
    admin = await make_user(client, engine, "admin@example.com", "admin")
    created = await _invite_editor(client, admin)
    nid = created["user"]["id"]
    assert "activated_at" in created["user"]
    assert created["user"]["activated_at"] is None

    lst = await client.get("/api/v1/users?role=editor", headers=admin)
    row = next(u for u in lst.json()["items"] if u["id"] == nid)
    assert row["activated_at"] is None

    token = _token_from_link(created["invite_link"])
    sp = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "chosen-strong-passphrase"},
    )
    assert sp.status_code == 200

    lst2 = await client.get("/api/v1/users?role=editor", headers=admin)
    row2 = next(u for u in lst2.json()["items"] if u["id"] == nid)
    assert row2["activated_at"] is not None
    activated_stamp = row2["activated_at"]

    cr = await client.patch(
        f"/api/v1/users/{nid}/role", json={"role": "manager"}, headers=admin
    )
    assert cr.status_code == 200
    assert cr.json()["activated_at"] == activated_stamp

    sa = await client.patch(
        f"/api/v1/users/{nid}/active", json={"is_active": False}, headers=admin
    )
    assert sa.status_code == 200
    assert sa.json()["user"]["activated_at"] == activated_stamp


async def test_forgot_password_reset_does_not_move_activated_at(client, engine):
    """A forgot-password reset on an already-activated account leaves the
    original `activated_at` untouched (the column is set only when NULL)."""
    admin = await make_user(client, engine, "admin@example.com", "admin")
    created = await _invite_editor(client, admin)
    nid = created["user"]["id"]

    sp = await client.post(
        "/api/v1/auth/reset-password",
        json={
            "token": _token_from_link(created["invite_link"]),
            "new_password": "chosen-strong-passphrase",
        },
    )
    assert sp.status_code == 200
    first = (await db_user(engine, "newbie@example.com")).activated_at
    assert first is not None

    # A second reset via the forgot-password flow.
    from app.core import security

    reset_token, _ = security.create_reset_token(nid)
    from app.core import token_store

    payload = security.decode_token(reset_token, security.RESET)
    await token_store.register_single_use(payload["jti"], 3600)
    sp2 = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": reset_token, "new_password": "another-strong-passphrase"},
    )
    assert sp2.status_code == 200
    assert (await db_user(engine, "newbie@example.com")).activated_at == first


# ── reactivation re-revokes a deferred-revoke refresh token (CWE-613) ────────
async def test_reactivation_revokes_refresh_token_left_by_a_deferred_deactivation(
    client, engine
):
    """If a deactivation deferred its refresh-token revoke (Redis was down),
    reactivating within the refresh TTL must not resurrect that token —
    `set_active`'s reactivate branch does a best-effort `revoke_refresh` too."""
    admin = await make_user(client, engine, "admin@example.com", "admin")
    await _register(client, "ed@example.com")
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": "ed@example.com", "password": PW}
    )).json()
    await _set_role(engine, "ed@example.com", "editor")
    eid = await db_user_id(engine, "ed@example.com")

    with _fake.failing():
        d = await client.patch(
            f"/api/v1/users/{eid}/active", json={"is_active": False}, headers=admin
        )
    assert d.status_code == 200
    assert d.json()["revocation_deferred"] is True

    # Redis is back. Reactivate — the best-effort revoke now runs.
    r = await client.patch(
        f"/api/v1/users/{eid}/active", json={"is_active": True}, headers=admin
    )
    assert r.status_code == 200
    assert r.json()["revocation_deferred"] is False

    # The account is active again, so a 401 here can only be the jti being gone
    # from Redis — not the is_active gate.
    rr = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert rr.status_code == 401


async def test_reactivation_under_redis_outage_still_200_with_deferred_flag(
    client, engine
):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    await make_user(client, engine, "ed@example.com", "editor")
    eid = await db_user_id(engine, "ed@example.com")

    await client.patch(
        f"/api/v1/users/{eid}/active", json={"is_active": False}, headers=admin
    )
    with _fake.failing():
        r = await client.patch(
            f"/api/v1/users/{eid}/active", json={"is_active": True}, headers=admin
        )
    assert r.status_code == 200
    assert r.json()["user"]["is_active"] is True
    assert r.json()["revocation_deferred"] is True


# ── resend-invite: per-target rate limit + prior-link retirement (CWE-770) ───
async def test_resend_invite_rate_limited_after_three_in_the_window(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    created = await _invite_editor(client, admin)
    nid = created["user"]["id"]

    for _ in range(3):
        ok = await client.post(f"/api/v1/users/{nid}/resend-invite", headers=admin)
        assert ok.status_code == 200

    r = await client.post(f"/api/v1/users/{nid}/resend-invite", headers=admin)
    assert r.status_code == 429


async def test_resend_invite_retires_the_previous_link(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    created = await _invite_editor(client, admin)
    nid = created["user"]["id"]
    first_link = created["invite_link"]

    resent = await client.post(f"/api/v1/users/{nid}/resend-invite", headers=admin)
    assert resent.status_code == 200
    second_link = resent.json()["invite_link"]
    assert second_link and second_link != first_link

    # The original link no longer completes set-password.
    old = await client.post(
        "/api/v1/auth/reset-password",
        json={
            "token": _token_from_link(first_link),
            "new_password": "totally-fresh-secret",
        },
    )
    assert old.status_code == 400

    # The latest link still works.
    new = await client.post(
        "/api/v1/auth/reset-password",
        json={
            "token": _token_from_link(second_link),
            "new_password": "totally-fresh-secret",
        },
    )
    assert new.status_code == 200


# ── break-glass: app/scripts/create_admin still works ───────────────────────
async def test_create_admin_script_bootstraps_and_promotes(client, engine, monkeypatch):
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    import app.scripts.create_admin as create_admin
    from app.models.models import User, UserRole

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(create_admin, "PrimarySession", Session)

    # Fresh bootstrap.
    await create_admin._create("root@example.com", "bootstrap-strong-pass", "Root")
    boot = await db_user(engine, "root@example.com")
    assert boot.role == UserRole.ADMIN and boot.is_active is True

    # Promote + reactivate an existing (deactivated, non-admin) user.
    await make_user(client, engine, "grace@example.com", "editor")
    await _set_role(engine, "grace@example.com", "editor")
    async with Session() as s:
        from sqlalchemy import update
        await s.execute(
            update(User).where(User.email == "grace@example.com").values(is_active=False)
        )
        await s.commit()

    await create_admin._create("grace@example.com", "irrelevant-not-used", None)
    promoted = await db_user(engine, "grace@example.com")
    assert promoted.role == UserRole.ADMIN and promoted.is_active is True
