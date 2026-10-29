"""D9 (plans/plan-account-deletion-backend.md): `POST /auth/me/delete`.

Real Postgres (alembic-migrated), `FakeRedis`, the stub Apple client, and a
locally signed JWKS for the OAuth proofs. Nothing mocks the ORM or the session.
"""
from __future__ import annotations

import asyncio
import time
import uuid

import pytest
from sqlalchemy import func, select

from app.core import email as email_module
from app.core import security
from app.core import storage as storage_module
from app.core.apple_revocation import (
    StubAppleRevocationClient,
    set_apple_revocation_client,
)
from app.core.config import get_settings
from app.core.rate_limit import login_rate_limit_key
from app.models.models import (
    AuditAction,
    AuditLog,
    AuthProvider,
    User,
    UserIdentity,
    UserRole,
)
from app.services import account_deletion_service, auth_service
from tests.comments_pg import (  # noqa: F401
    capture_logs,
    db_rows,
    make_user,
    pg_client,
    pg_engine,
    pg_migrated_db,
    pg_server,
    published_sermon,
    sessions,
)
from tests.conftest import _fake
from tests.kitchen_sink import seed_kitchen_sink_viewer
from tests.test_oauth import (  # noqa: F401  (autouse JWKS wiring + token helpers)
    _APPLE_AUD,
    _GOOGLE_AUD,
    _apple_claims,
    _google_claims,
    _mint,
    _rsa_key,
    _wire_static_jwks,
)

pytestmark = pytest.mark.asyncio

settings = get_settings()
PW = "correct-horse-battery"
URL = "/api/v1/auth/me/delete"
GENERIC_403 = account_deletion_service.REAUTH_FAILED_MESSAGE
BUCKET = settings.object_store_media_bucket


# ── helpers ──────────────────────────────────────────────────────────────────
@pytest.fixture
def apple():
    stub = StubAppleRevocationClient()
    set_apple_revocation_client(stub)
    yield stub
    set_apple_revocation_client(None)


@pytest.fixture
def notices(monkeypatch, sessions):
    """Records `send_account_deleted` calls and whether the user row was already
    gone when each one ran (i.e. sent after commit)."""
    sent: list[dict] = []

    async def fake(to: str) -> None:
        async with sessions() as s:
            n = (await s.execute(
                select(func.count()).select_from(User).where(User.email == to)
            )).scalar_one()
        sent.append({"to": to, "row_already_gone": n == 0})

    monkeypatch.setattr(email_module, "send_account_deleted", fake)
    return sent


async def _viewer(
    make_user, sessions, *, password: str | None = PW, google: bool = False,
    apple: bool = False,
):
    tu = await make_user(role="viewer", full_name="Self Deleter")
    async with sessions() as s:
        u = await s.get(User, tu.id)
        u.password_hash = security.hash_password(password) if password else None
        if google:
            s.add(UserIdentity(user_id=tu.id, provider=AuthProvider.GOOGLE,
                               provider_subject=f"g-{tu.id}"))
        if apple:
            s.add(UserIdentity(user_id=tu.id, provider=AuthProvider.APPLE,
                               provider_subject=f"a-{tu.id}"))
        await s.commit()
    return tu


def _g_token(key, uid, **ov) -> str:
    return _mint(key, _google_claims(f"g-{uid}", **ov))


def _a_token(key, uid, nonce="n-1", **ov) -> str:
    return _mint(key, _apple_claims(f"a-{uid}", nonce, **ov))


def _pw(password=PW, **extra):
    return {"method": "password", "password": password, **extra}


def _google(token, **extra):
    return {"method": "google", "id_token": token, **extra}


def _apple_body(token, nonce="n-1", code="auth-code-1"):
    return {"method": "apple", "identity_token": token, "raw_nonce": nonce,
            "authorization_code": code}


async def _post(c, tu, body, headers=None):
    return await c.post(URL, json=body, headers={**tu.headers, **(headers or {})})


async def _exists(sessions, uid) -> bool:
    async with sessions() as s:
        return await s.get(User, uid) is not None


async def _deleted_rows(sessions, uid, exclude=()) -> list[AuditLog]:
    async with sessions() as s:
        return list((await s.execute(
            select(AuditLog).where(
                AuditLog.action == AuditAction.USER_DELETED,
                AuditLog.target_id == uid,
                AuditLog.id.not_in(list(exclude)),
            )
        )).scalars().all())


# ── happy paths ──────────────────────────────────────────────────────────────
async def test_password_happy_path_erases_audits_and_notifies(
    pg_client, sessions, make_user, apple, notices, capture_logs
):
    tu = await _viewer(make_user, sessions)
    login = await pg_client.post("/api/v1/auth/login", json={"email": tu.email, "password": PW})
    assert login.status_code == 200, login.text
    refresh = login.json()["refresh_token"]

    r = await _post(pg_client, tu, _pw())
    assert r.status_code == 204 and r.content == b""
    assert not await _exists(sessions, tu.id)

    rows = await _deleted_rows(sessions, tu.id)
    assert len(rows) == 1
    row = rows[0]
    assert row.actor_id == row.target_id == tu.id
    assert row.actor_email is None and row.target_label is None
    assert row.details == {
        "role": "viewer", "self_service": True, "providers": [], "apple_revoked": None,
    }
    assert apple.calls == []
    # Notice goes to the snapshotted address, after the commit.
    assert notices == [{"to": tu.email, "row_already_gone": True}]
    assert tu.email not in capture_logs.text()

    # The deleted user's access token is dead, and so is their refresh token.
    assert (await pg_client.get("/api/v1/auth/me", headers=tu.headers)).status_code == 401
    assert (await pg_client.post(
        "/api/v1/auth/refresh", json={"refresh_token": refresh}
    )).status_code == 401


async def test_google_happy_path(pg_client, sessions, make_user, apple, notices, _rsa_key):
    tu = await _viewer(make_user, sessions, password=None, google=True)
    r = await _post(pg_client, tu, _google(_g_token(_rsa_key, tu.id)))
    assert r.status_code == 204
    assert not await _exists(sessions, tu.id)
    (row,) = await _deleted_rows(sessions, tu.id)
    assert row.details["providers"] == ["google"] and row.details["apple_revoked"] is None
    assert apple.calls == []


async def test_apple_happy_path_revokes_then_erases(
    pg_client, sessions, make_user, apple, notices, _rsa_key
):
    tu = await _viewer(make_user, sessions, password=None, apple=True)
    r = await _post(pg_client, tu, _apple_body(_a_token(_rsa_key, tu.id), code="code-xyz"))
    assert r.status_code == 204
    assert apple.calls == ["code-xyz"]
    assert not await _exists(sessions, tu.id)
    (row,) = await _deleted_rows(sessions, tu.id)
    assert row.details["apple_revoked"] is True and row.details["providers"] == ["apple"]
    assert "apple_skip_reason" not in row.details


async def test_apple_linked_password_with_flag_skips_revocation(
    pg_client, sessions, make_user, apple, notices
):
    tu = await _viewer(make_user, sessions, apple=True)
    r = await _post(pg_client, tu, _pw(apple_unavailable=True))
    assert r.status_code == 204
    assert apple.calls == []
    (row,) = await _deleted_rows(sessions, tu.id)
    assert row.details["apple_revoked"] is False
    assert row.details["apple_skip_reason"] == "apple_unavailable"


async def test_flag_is_ignored_on_account_without_apple(
    pg_client, sessions, make_user, apple, notices
):
    tu = await _viewer(make_user, sessions)
    assert (await _post(pg_client, tu, _pw(apple_unavailable=True))).status_code == 204
    (row,) = await _deleted_rows(sessions, tu.id)
    assert row.details["apple_revoked"] is None
    assert "apple_skip_reason" not in row.details


# ── request-shape and authz errors ───────────────────────────────────────────
async def test_unauthenticated_is_401(pg_client):
    r = await pg_client.post(URL, json=_pw())
    assert r.status_code == 401


@pytest.mark.parametrize("body", [
    {}, {"method": "sms"}, {"method": "password"}, {"method": "google"},
    {"method": "apple", "identity_token": "t", "raw_nonce": "n"},
    {"method": "apple", "identity_token": "t", "raw_nonce": "n",
     "authorization_code": "c", "apple_unavailable": True},
])
async def test_malformed_bodies_are_422_and_delete_nothing(
    pg_client, sessions, make_user, body
):
    """A stolen access token with no proof gets a 422, never a deletion."""
    tu = await _viewer(make_user, sessions)
    r = await _post(pg_client, tu, body)
    assert r.status_code == 422
    assert await _exists(sessions, tu.id)


@pytest.mark.parametrize("role", ["editor", "manager", "admin"])
async def test_staff_get_403_for_every_role(pg_client, sessions, make_user, role):
    tu = await make_user(role=role)
    r = await _post(pg_client, tu, _pw())
    assert r.status_code == 403
    assert r.json()["detail"] == "Staff accounts are removed by an administrator"
    assert await _exists(sessions, tu.id)


async def test_wrong_password_is_403_not_401(pg_client, sessions, make_user, apple):
    tu = await _viewer(make_user, sessions)
    r = await _post(pg_client, tu, _pw("not-the-password"))
    assert r.status_code == 403 and r.json()["detail"] == GENERIC_403
    assert await _exists(sessions, tu.id)


async def test_every_reauth_failure_cause_has_the_same_response(
    pg_client, sessions, make_user, apple, _rsa_key
):
    pw_only = await _viewer(make_user, sessions)
    g_only = await _viewer(make_user, sessions, password=None, google=True)
    a_only = await _viewer(make_user, sessions, password=None, apple=True)
    now = int(time.time())
    cases = [
        (pw_only, _pw("nope")),                                              # wrong password
        (g_only, _pw()),                                                     # password, none set
        (pw_only, _google(_g_token(_rsa_key, pw_only.id))),                  # Google not linked
        (pw_only, _apple_body(_a_token(_rsa_key, pw_only.id))),              # Apple not linked
        (g_only, _google(_mint(_rsa_key, _google_claims("someone-else")))),  # sub mismatch
        (g_only, _google(_g_token(_rsa_key, g_only.id, iat=now - 3600, exp=now + 600))),  # stale
        (a_only, _apple_body(_a_token(_rsa_key, a_only.id, nonce="n-1"), nonce="n-2")),  # nonce
        (g_only, _google("not.a.jwt")),                                      # garbage
    ]
    seen = set()
    for tu, body in cases:
        r = await _post(pg_client, tu, body)
        assert r.status_code == 403, (body["method"], r.text)
        seen.add(r.text.split('"correlation_id"')[0])
        assert await _exists(sessions, tu.id)
    assert len(seen) == 1
    assert apple.calls == []


async def test_stale_iat_boundary_follows_the_setting(
    pg_client, sessions, make_user, apple, notices, _rsa_key, monkeypatch
):
    monkeypatch.setattr(settings, "account_deletion_reauth_max_age_seconds", 60)
    tu = await _viewer(make_user, sessions, password=None, google=True)
    now = int(time.time())
    old = _g_token(_rsa_key, tu.id, iat=now - 120, exp=now + 600)
    assert (await _post(pg_client, tu, _google(old))).status_code == 403
    fresh = _g_token(_rsa_key, tu.id, iat=now - 10, exp=now + 600)
    assert (await _post(pg_client, tu, _google(fresh))).status_code == 204


async def test_future_iat_beyond_leeway_is_stale(
    pg_client, sessions, make_user, apple, notices, _rsa_key
):
    tu = await _viewer(make_user, sessions, password=None, google=True)
    now = int(time.time())
    # `nbf` absent, so only the freshness check can reject this one.
    future = _g_token(_rsa_key, tu.id, iat=now + 3600, exp=now + 7200)
    assert (await _post(pg_client, tu, _google(future))).status_code == 403
    assert await _exists(sessions, tu.id)
    skew = _g_token(_rsa_key, tu.id, iat=now + 10, exp=now + 600)  # inside leeway
    assert (await _post(pg_client, tu, _google(skew))).status_code == 204


async def test_replayed_identity_token_is_403(
    pg_client, sessions, make_user, apple, _rsa_key
):
    tu = await _viewer(make_user, sessions, password=None, google=True)
    token = _g_token(_rsa_key, tu.id)
    # The same token is spent by a sign-in first (claim-once ledger).
    assert (await pg_client.post(
        "/api/v1/auth/oauth/google", json={"id_token": token}
    )).status_code == 200
    r = await _post(pg_client, tu, _google(token))
    assert r.status_code == 403 and r.json()["detail"] == GENERIC_403
    assert await _exists(sessions, tu.id)


async def test_deletion_proof_is_single_use(pg_client, sessions, make_user, apple, _rsa_key):
    """A proof used on a request that then fails (here: a 400 from Apple) cannot
    be presented again."""
    tu = await _viewer(make_user, sessions, password=None, apple=True)
    apple.script("invalid_grant")
    token = _a_token(_rsa_key, tu.id)
    assert (await _post(pg_client, tu, _apple_body(token))).status_code == 400
    r = await _post(pg_client, tu, _apple_body(token))
    assert r.status_code == 403 and r.json()["detail"] == GENERIC_403


# ── Apple-fork preconditions ─────────────────────────────────────────────────
async def test_apple_linked_non_apple_proof_without_flag_is_409(
    pg_client, sessions, make_user, apple, _rsa_key
):
    tu = await _viewer(make_user, sessions, google=True, apple=True)
    for body in (_pw(), _google(_g_token(_rsa_key, tu.id))):
        r = await _post(pg_client, tu, body)
        assert r.status_code == 409 and r.json()["detail"] == "Apple re-auth required"
    assert await _exists(sessions, tu.id)


async def test_apple_only_account_with_flag_is_409_support_path(
    pg_client, sessions, make_user, apple
):
    tu = await _viewer(make_user, sessions, password=None, apple=True)
    r = await _post(pg_client, tu, _pw(apple_unavailable=True))
    assert r.status_code == 409
    assert r.json()["detail"] == account_deletion_service.APPLE_ONLY_MESSAGE
    assert await _exists(sessions, tu.id)


async def test_apple_google_account_with_flag_and_google_proof_succeeds(
    pg_client, sessions, make_user, apple, notices, _rsa_key
):
    tu = await _viewer(make_user, sessions, password=None, google=True, apple=True)
    r = await _post(pg_client, tu, _google(_g_token(_rsa_key, tu.id), apple_unavailable=True))
    assert r.status_code == 204
    (row,) = await _deleted_rows(sessions, tu.id)
    assert row.details["apple_skip_reason"] == "apple_unavailable"
    assert row.details["providers"] == ["apple", "google"]


# ── ordering pin: revoke before any erasure ──────────────────────────────────
@pytest.mark.parametrize("reason,status,detail", [
    ("invalid_grant", 400, account_deletion_service.APPLE_EXPIRED_MESSAGE),
    ("unavailable", 503, account_deletion_service.APPLE_UNAVAILABLE_MESSAGE),
    ("misconfigured", 503, account_deletion_service.APPLE_UNAVAILABLE_MESSAGE),
])
async def test_apple_failure_deletes_nothing(
    pg_client, sessions, make_user, published_sermon, _rsa_key, reason, status, detail
):
    ks = await seed_kitchen_sink_viewer(sessions, make_user, published_sermon, active=True)
    token = _a_token(_rsa_key, ks.user_id)
    snapshot: dict = {}

    async def on_call(code: str) -> None:
        async with sessions() as s:
            snapshot["user"] = await s.get(User, ks.user_id) is not None
            snapshot["deleted_rows"] = len(await _deleted_rows(sessions, ks.user_id, ks.prior_audit_ids))
            snapshot["identities"] = (await s.execute(
                select(func.count()).select_from(UserIdentity)
                .where(UserIdentity.user_id == ks.user_id)
            )).scalar_one()

    stub = StubAppleRevocationClient([reason], on_call=on_call)
    set_apple_revocation_client(stub)
    try:
        spy_deleted: list = []

        class Spy:
            def __getattr__(self, n):
                return getattr(inner, n)

            def delete_object(self, bucket, key):
                spy_deleted.append(key)

        inner = storage_module.get_storage()
        storage_module.set_storage(Spy())
        headers = {"Authorization": "Bearer " + security.create_access_token(
            str(ks.user_id), "viewer")}
        r = await pg_client.post(URL, json=_apple_body(token), headers=headers)
    finally:
        set_apple_revocation_client(None)
        storage_module.set_storage(inner)

    assert r.status_code == status and r.json()["detail"] == detail
    assert stub.calls == ["auth-code-1"]  # exactly one revoke attempt, no retry
    assert snapshot == {"user": True, "deleted_rows": 0, "identities": 2}
    assert await _exists(sessions, ks.user_id)
    assert await _deleted_rows(sessions, ks.user_id, ks.prior_audit_ids) == []
    assert spy_deleted == []


async def test_apple_code_for_another_identity_is_400_and_deletes_nothing(
    pg_client, sessions, make_user, published_sermon, _rsa_key
):
    """The exchange's id_token `sub` differs from the linked Apple subject:
    invalid_grant (400), nothing erased."""
    ks = await seed_kitchen_sink_viewer(sessions, make_user, published_sermon, active=True)
    stub = StubAppleRevocationClient(returned_sub="a-someone-else")
    set_apple_revocation_client(stub)
    try:
        headers = {"Authorization": "Bearer " + security.create_access_token(
            str(ks.user_id), "viewer")}
        r = await pg_client.post(
            URL, json=_apple_body(_a_token(_rsa_key, ks.user_id)), headers=headers
        )
    finally:
        set_apple_revocation_client(None)
    assert r.status_code == 400
    assert r.json()["detail"] == account_deletion_service.APPLE_EXPIRED_MESSAGE
    assert stub.expected_subs == [f"a-{ks.user_id}"]
    assert await _exists(sessions, ks.user_id)
    assert await _deleted_rows(sessions, ks.user_id, ks.prior_audit_ids) == []


async def test_no_row_lock_held_during_apple_call(
    pg_client, sessions, make_user, published_sermon, _rsa_key
):
    """`FOR UPDATE NOWAIT` from another connection succeeds while the Apple call
    is in flight (it raises LockNotAvailable if the delete held the row lock),
    and no transaction of the request is left open on its connection."""
    from sqlalchemy import text

    ks = await seed_kitchen_sink_viewer(sessions, make_user, published_sermon, active=True)
    outcome: dict = {}

    async def on_call(code: str) -> None:
        async with sessions() as s:
            await s.execute(
                text("SELECT id FROM users WHERE id = :i FOR UPDATE NOWAIT"), {"i": ks.user_id}
            )
            outcome["locked"] = True
            idle = (await s.execute(text(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
                "AND state = 'idle in transaction' AND pid <> pg_backend_pid()"
            ))).scalar_one()
            outcome["idle_in_txn"] = idle
            await s.rollback()

    stub = StubAppleRevocationClient(on_call=on_call)
    set_apple_revocation_client(stub)
    try:
        headers = {"Authorization": "Bearer " + security.create_access_token(
            str(ks.user_id), "viewer")}
        r = await pg_client.post(
            URL, json=_apple_body(_a_token(_rsa_key, ks.user_id)), headers=headers
        )
    finally:
        set_apple_revocation_client(None)
    assert r.status_code == 204, r.text
    assert outcome == {"locked": True, "idle_in_txn": 0}
    assert not await _exists(sessions, ks.user_id)


async def test_misconfigured_logs_at_error_level(
    pg_client, sessions, make_user, apple, _rsa_key, capture_logs
):
    tu = await _viewer(make_user, sessions, password=None, apple=True)
    apple.script("misconfigured")
    r = await _post(pg_client, tu, _apple_body(_a_token(_rsa_key, tu.id)))
    assert r.status_code == 503
    assert any(e["event"] == "apple_revocation_misconfigured" for e in capture_logs.records)


# ── RESTRICT history ─────────────────────────────────────────────────────────
async def _demoted_ex_staff(make_user, sessions, published_sermon):
    ex = await make_user(role="editor")
    await published_sermon(owner=ex)
    async with sessions() as s:
        u = await s.get(User, ex.id)
        u.role = UserRole.VIEWER
        u.password_hash = security.hash_password(PW)
        await s.commit()
    return ex


async def test_restrict_history_is_409_precheck(
    pg_client, sessions, make_user, published_sermon, apple
):
    ex = await _demoted_ex_staff(make_user, sessions, published_sermon)
    r = await _post(pg_client, ex, _pw())
    assert r.status_code == 409 and "sermons (1)" in r.json()["detail"]
    assert await _exists(sessions, ex.id)
    assert await _deleted_rows(sessions, ex.id) == []


async def test_integrity_error_backstop_is_409_not_500(
    pg_client, sessions, make_user, published_sermon, apple, monkeypatch, notices
):
    """The precheck is blinded, so the DB's own ON DELETE RESTRICT is what
    stops the delete; the transaction (audit row included) rolls back."""
    ex = await _demoted_ex_staff(make_user, sessions, published_sermon)

    async def blind(db, user_id, message_template):
        return None

    monkeypatch.setattr(auth_service, "ensure_no_authored_history", blind)
    r = await _post(pg_client, ex, _pw())
    assert r.status_code == 409
    assert await _exists(sessions, ex.id)
    assert await _deleted_rows(sessions, ex.id) == []
    assert notices == []


# ── rate limiting ────────────────────────────────────────────────────────────
async def test_sixth_attempt_is_429_even_from_different_ips(
    pg_client, sessions, make_user, apple, monkeypatch
):
    monkeypatch.setattr(settings, "trusted_proxies", ["127.0.0.1"])
    tu = await _viewer(make_user, sessions)
    for i in range(5):
        r = await _post(pg_client, tu, _pw("wrong-password"),
                        headers={"X-Forwarded-For": f"203.0.113.{i + 1}"})
        assert r.status_code == 403, r.text
    r = await _post(pg_client, tu, _pw(), headers={"X-Forwarded-For": "198.51.100.77"})
    assert r.status_code == 429
    assert await _exists(sessions, tu.id)


async def test_password_attempt_consumes_the_login_key(pg_client, sessions, make_user, apple):
    tu = await _viewer(make_user, sessions)
    await _post(pg_client, tu, _pw("wrong-password"))
    keys = [k for k in _fake.store if k.startswith("ratelimit:login:")]
    assert len(keys) == 1 and _fake.store[keys[0]] == "1"
    assert tu.email.lower() not in keys[0]  # hashed, never the address
    assert keys[0] == "ratelimit:" + login_rate_limit_key("127.0.0.1", tu.email)
    await _post(pg_client, tu, _pw("wrong-password"))
    assert _fake.store[keys[0]] == "2"
    assert _fake.store[f"ratelimit:account_delete:{tu.id}"] == "2"


async def test_oauth_attempt_does_not_touch_the_login_key(
    pg_client, sessions, make_user, apple, _rsa_key
):
    tu = await _viewer(make_user, sessions, password=None, google=True)
    await _post(pg_client, tu, _google(_g_token(_rsa_key, tu.id, iat=1, exp=int(time.time()) + 60)))
    assert not [k for k in _fake.store if k.startswith("ratelimit:login:")]


async def test_shared_login_key_exhaustion_is_429(
    pg_client, sessions, make_user, apple, monkeypatch
):
    monkeypatch.setattr(settings, "login_rate_limit", 1)
    tu = await _viewer(make_user, sessions)
    assert (await _post(pg_client, tu, _pw("wrong-password"))).status_code == 403
    assert (await _post(pg_client, tu, _pw())).status_code == 429
    assert await _exists(sessions, tu.id)


async def test_redis_down_fails_closed_for_delete_but_not_login(
    pg_client, sessions, make_user, apple
):
    tu = await _viewer(make_user, sessions)
    with _fake.failing():
        r = await _post(pg_client, tu, _pw())
        assert r.status_code == 503
        assert r.json()["detail"] == "Account deletion is temporarily unavailable. Try again shortly."
        login = await pg_client.post(
            "/api/v1/auth/login", json={"email": tu.email, "password": PW}
        )
        assert login.status_code != 429  # the login limiter still fails open
    assert await _exists(sessions, tu.id)


# ── best-effort tail ─────────────────────────────────────────────────────────
async def test_smtp_failure_still_204_with_rows_gone(
    pg_client, sessions, make_user, apple, monkeypatch, capture_logs
):
    async def boom(to: str) -> None:
        raise RuntimeError("smtp down")

    monkeypatch.setattr(email_module, "send_account_deleted", boom)
    tu = await _viewer(make_user, sessions)
    r = await _post(pg_client, tu, _pw())
    assert r.status_code == 204
    assert not await _exists(sessions, tu.id)
    assert any(e["event"] == "account_deleted_notice_failed" for e in capture_logs.records)
    assert tu.email not in capture_logs.text()


async def test_notice_does_not_log_recipient_or_body(monkeypatch, capture_logs):
    """Console backend: the account-deleted notice logs neither the address nor
    the body; other emails still do."""
    monkeypatch.setattr(email_module.settings, "smtp_host", "")
    assert not email_module.settings.email_is_live
    await email_module.send_account_deleted("gone@example.com")
    await email_module.send_email_verification("kept@example.com", "123456")
    text = capture_logs.text()
    assert "gone@example.com" not in text and "was deleted at your request" not in text
    assert "kept@example.com" in text


async def test_storage_failure_still_204(pg_client, sessions, make_user, apple, notices):
    tu = await _viewer(make_user, sessions)
    async with sessions() as s:
        (await s.get(User, tu.id)).avatar_key = f"avatars/{tu.id}/a.png"
        await s.commit()
    inner = storage_module.get_storage()

    class Failing:
        def __getattr__(self, n):
            return getattr(inner, n)

        def delete_object(self, bucket, key):
            raise RuntimeError("storage down")

    storage_module.set_storage(Failing())
    try:
        r = await _post(pg_client, tu, _pw())
    finally:
        storage_module.set_storage(inner)
    assert r.status_code == 204
    assert not await _exists(sessions, tu.id)


# ── idempotency ──────────────────────────────────────────────────────────────
async def test_sequential_repeat_is_401(pg_client, sessions, make_user, apple, notices):
    tu = await _viewer(make_user, sessions)
    assert (await _post(pg_client, tu, _pw())).status_code == 204
    assert (await _post(pg_client, tu, _pw())).status_code == 401


async def test_concurrent_double_submit_deletes_once(
    pg_client, sessions, make_user, apple, notices
):
    tu = await _viewer(make_user, sessions)
    results = await asyncio.gather(
        _post(pg_client, tu, _pw()), _post(pg_client, tu, _pw()), _post(pg_client, tu, _pw()),
    )
    codes = sorted(r.status_code for r in results)
    assert codes.count(204) == 1, codes
    assert set(codes) <= {204, 401}, codes
    assert len(await _deleted_rows(sessions, tu.id)) == 1
    assert not await _exists(sessions, tu.id)
    assert len(notices) == 1


# ── UserPublic additive fields ───────────────────────────────────────────────
async def test_me_exposes_has_password_and_linked_providers(
    pg_client, sessions, make_user
):
    both = await _viewer(make_user, sessions, google=True, apple=True)
    none = await _viewer(make_user, sessions, password=None, google=True)
    r = (await pg_client.get("/api/v1/auth/me", headers=both.headers)).json()
    assert r["has_password"] is True and r["linked_providers"] == ["apple", "google"]
    r = (await pg_client.get("/api/v1/auth/me", headers=none.headers)).json()
    assert r["has_password"] is False and r["linked_providers"] == ["google"]


async def test_members_list_fills_linked_providers(pg_client, sessions, make_user):
    admin = await make_user(role="admin")
    v = await _viewer(make_user, sessions, google=True)
    page = (await pg_client.get("/api/v1/users/members", headers=admin.headers)).json()
    item = next(i for i in page["items"] if i["id"] == str(v.id))
    assert item["linked_providers"] == ["google"] and item["has_password"] is True
