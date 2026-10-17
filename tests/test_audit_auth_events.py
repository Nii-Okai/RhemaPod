"""Auth-path audit events (`plans/plan-admin-settings.md` §A.3, step S8).

`auth.login` (password, Google, Apple) and `auth.logout` are fail-open in
their own session; `auth.password_changed` / `auth.password_reset` are in the
same transaction as the password write; `auth.login_failed` is written only
for an existing account, by a background job that runs after the 401 has been
sent. All on real Postgres (`pg_client`): the INET column, the JSONB
`details` and the "no extra DB work on the request path" check only mean
something against the production dialect.
"""
from __future__ import annotations

import time
import uuid
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import event, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.services.audit_service as audit_service_module
from app.core import email as email_module
from app.models.models import AuditAction, AuditLog, AuditOutcome, User
from tests.test_oauth import (  # noqa: F401 — fixtures used by name
    _apple_sign_in,
    _google_sign_in,
    _rsa_key,
    _wire_static_jwks,
)

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"
UA = "Mozilla/5.0 (auth-audit-test)"


@pytest.fixture
def sessions(pg_engine):
    return async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)


async def _register(pg_client, email: str) -> None:
    r = await pg_client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    assert r.status_code == 201


async def _login(pg_client, email: str, password: str = PW, **headers):
    return await pg_client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
        headers={"User-Agent": UA, **headers},
    )


async def _rows(sessions, action: AuditAction | None = None) -> list[AuditLog]:
    stmt = select(AuditLog).order_by(AuditLog.created_at)
    if action is not None:
        stmt = stmt.where(AuditLog.action == action)
    async with sessions() as s:
        return list((await s.execute(stmt)).scalars())


async def _user_id(sessions, email: str) -> uuid.UUID:
    async with sessions() as s:
        return (await s.execute(select(User.id).where(User.email == email))).scalar_one()


async def _set(sessions, sql: str, **params) -> None:
    async with sessions() as s:
        await s.execute(text(sql), params)
        await s.commit()


# ── auth.login ──────────────────────────────────────────────────────────────


async def test_password_login_writes_auth_login(pg_client, sessions):
    await _register(pg_client, "ada@example.com")
    r = await _login(pg_client, "ada@example.com", **{"X-Correlation-ID": "corr-login"})
    assert r.status_code == 200

    rows = await _rows(sessions, AuditAction.LOGIN)
    assert len(rows) == 1
    row = rows[0]
    assert row.outcome == AuditOutcome.SUCCESS
    assert row.actor_id == await _user_id(sessions, "ada@example.com")
    assert row.actor_email == "ada@example.com"
    assert row.actor_role == "viewer"
    assert row.details == {"method": "password"}
    assert row.ip == "127.0.0.1"
    assert row.user_agent == UA
    assert row.correlation_id == "corr-login"


async def test_login_audit_failure_still_returns_tokens(pg_client, sessions, monkeypatch):
    """Fail-open (DoD bullet 4): a real insert failure in the detached audit
    session — here a CHECK violation, forced by handing `record` an outcome
    outside the enum — still returns 200 with tokens and logs
    `audit_write_failed`."""
    await _register(pg_client, "ada@example.com")
    events: list[dict] = []

    class _Recorder:
        def error(self, event_name, **kw):
            events.append({"event": event_name, **kw})

    real_record = audit_service_module.record

    async def _bad_outcome(db, action, **kw):
        return await real_record(db, action, **{**kw, "outcome": "not_an_outcome"})

    monkeypatch.setattr(audit_service_module, "record", _bad_outcome)
    monkeypatch.setattr(audit_service_module, "log", _Recorder())

    r = await _login(pg_client, "ada@example.com")
    assert r.status_code == 200
    assert r.json()["access_token"]
    assert any(
        e["event"] == "audit_write_failed" and e["action"] == "auth.login" for e in events
    )
    assert await _rows(sessions, AuditAction.LOGIN) == []


async def test_google_sign_in_records_method_and_new_account(pg_client, sessions, _rsa_key):
    first = await _google_sign_in(pg_client, _rsa_key, "g-sub-1")
    assert first.status_code == 200
    # A different `iat` mints a distinct token; the same one would be a replay.
    again = await _google_sign_in(pg_client, _rsa_key, "g-sub-1", iat=int(time.time()) - 5)
    assert again.status_code == 200

    rows = await _rows(sessions, AuditAction.LOGIN)
    assert [r.details for r in rows] == [
        {"method": "google", "new_account": True},
        {"method": "google", "new_account": False},
    ]
    assert rows[0].actor_email == "g-sub-1@example.com"


async def test_apple_sign_in_records_method(pg_client, sessions, _rsa_key):
    r = await _apple_sign_in(pg_client, _rsa_key, "a-sub-1")
    assert r.status_code == 200

    rows = await _rows(sessions, AuditAction.LOGIN)
    assert [r.details for r in rows] == [{"method": "apple", "new_account": True}]


async def test_rejected_oauth_token_writes_nothing(pg_client, sessions, _rsa_key):
    r = await _google_sign_in(pg_client, _rsa_key, "g-sub-2", email_verified=False)
    assert r.status_code == 403
    assert await _rows(sessions) == []


# ── auth.login_failed ───────────────────────────────────────────────────────


async def test_wrong_password_for_known_account_writes_login_failed(pg_client, sessions):
    await _register(pg_client, "ada@example.com")
    r = await _login(pg_client, "ada@example.com", "not-the-password")
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid email or password"
    assert r.json()["correlation_id"]

    rows = await _rows(sessions, AuditAction.LOGIN_FAILED)
    assert len(rows) == 1
    assert rows[0].outcome == AuditOutcome.FAILURE
    assert rows[0].actor_email == "ada@example.com"
    assert rows[0].details == {"method": "password", "reason": "bad_password"}
    assert rows[0].ip == "127.0.0.1"
    assert rows[0].user_agent == UA


async def test_deactivated_account_login_failed_reason_is_inactive(pg_client, sessions):
    await _register(pg_client, "ada@example.com")
    await _set(sessions, "UPDATE users SET is_active = false WHERE email = :e", e="ada@example.com")

    r = await _login(pg_client, "ada@example.com")
    assert r.status_code == 401

    rows = await _rows(sessions, AuditAction.LOGIN_FAILED)
    assert [row.details["reason"] for row in rows] == ["inactive"]


async def test_unknown_email_writes_no_row(pg_client, sessions):
    r = await _login(pg_client, "nobody@example.com", "whatever-password")
    assert r.status_code == 401
    assert await _rows(sessions) == []


async def test_unknown_and_known_email_failures_are_indistinguishable(pg_client, sessions):
    await _register(pg_client, "ada@example.com")
    known = await _login(pg_client, "ada@example.com", "not-the-password")
    unknown = await _login(pg_client, "nobody@example.com", "not-the-password")

    assert known.status_code == unknown.status_code == 401
    k, u = known.json(), unknown.json()
    assert k.keys() == u.keys()
    assert k["detail"] == u["detail"]


async def test_unknown_email_still_runs_the_password_hash(pg_client, monkeypatch):
    """Latency half of DoD bullet 5. `authenticate` once short-circuited
    `user is None or not verify_password(...)`, so an unknown email skipped
    Argon2 entirely and answered ~10x faster than a known one. Both paths
    must now pay for exactly one verify."""
    from app.core import security

    calls: list[str | None] = []
    real_verify = security.verify_password

    def _spy(plain, hashed):
        calls.append(hashed)
        return real_verify(plain, hashed)

    monkeypatch.setattr(security, "verify_password", _spy)
    await _register(pg_client, "ada@example.com")

    await _login(pg_client, "nobody@example.com", "not-the-password")
    assert calls == [None]  # the dummy verify ran

    calls.clear()
    await _login(pg_client, "ada@example.com", "not-the-password")
    assert len(calls) == 1 and calls[0] is not None


async def test_login_failed_adds_no_db_work_to_the_request_path(
    pg_client, pg_engine, sessions, monkeypatch,
):
    """DoD bullet 5: the account lookup and the audit insert for
    `auth.login_failed` run only in the background job, after the response.
    Every statement is recorded against a marker set when that job starts;
    the request-path statements for a known email must be identical to an
    unknown email's, and no `audit_log` statement may precede the marker."""
    await _register(pg_client, "ada@example.com")

    trace: list[str] = []

    def _on_execute(conn, cursor, statement, params, context, executemany):
        trace.append(statement)

    real_job = audit_service_module.record_login_failed

    async def _marked_job(email, *, ctx):
        trace.append("<<background>>")
        await real_job(email, ctx=ctx)

    monkeypatch.setattr(audit_service_module, "record_login_failed", _marked_job)
    event.listen(pg_engine.sync_engine, "before_cursor_execute", _on_execute)
    try:
        def _request_path() -> list[str]:
            return trace[: trace.index("<<background>>")]

        trace.clear()
        await _login(pg_client, "ada@example.com", "not-the-password")
        known_path, known_background = _request_path(), trace[trace.index("<<background>>"):]

        trace.clear()
        await _login(pg_client, "nobody@example.com", "not-the-password")
        unknown_path = _request_path()
    finally:
        event.remove(pg_engine.sync_engine, "before_cursor_execute", _on_execute)

    assert known_path == unknown_path
    assert not any("audit_log" in stmt for stmt in known_path)
    assert any("INSERT INTO audit_log" in stmt for stmt in known_background)


async def test_login_failed_job_is_fail_open(pg_client, sessions, monkeypatch):
    await _register(pg_client, "ada@example.com")
    events: list[dict] = []

    class _Recorder:
        def error(self, event_name, **kw):
            events.append({"event": event_name, **kw})

    real_record = audit_service_module.record

    async def _bad_outcome(db, action, **kw):
        return await real_record(db, action, **{**kw, "outcome": "not_an_outcome"})

    monkeypatch.setattr(audit_service_module, "record", _bad_outcome)
    monkeypatch.setattr(audit_service_module, "log", _Recorder())

    r = await _login(pg_client, "ada@example.com", "not-the-password")
    assert r.status_code == 401
    assert any(
        e["event"] == "audit_write_failed" and e["action"] == "auth.login_failed"
        for e in events
    )


# ── auth.logout ─────────────────────────────────────────────────────────────


async def test_logout_writes_auth_logout(pg_client, sessions):
    await _register(pg_client, "ada@example.com")
    tokens = (await _login(pg_client, "ada@example.com")).json()

    r = await pg_client.post(
        "/api/v1/auth/logout",
        json={"refresh_token": tokens["refresh_token"]},
        headers={"Authorization": f"Bearer {tokens['access_token']}", "User-Agent": UA},
    )
    assert r.status_code == 200

    rows = await _rows(sessions, AuditAction.LOGOUT)
    assert len(rows) == 1
    assert rows[0].actor_email == "ada@example.com"
    assert rows[0].user_agent == UA


# ── auth.password_changed / auth.password_reset (same transaction) ──────────


async def test_change_password_writes_row(pg_client, sessions):
    await _register(pg_client, "ada@example.com")
    tokens = (await _login(pg_client, "ada@example.com")).json()

    r = await pg_client.post(
        "/api/v1/auth/change-password",
        json={"current_password": PW, "new_password": "a-brand-new-passphrase"},
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert r.status_code == 200

    rows = await _rows(sessions, AuditAction.PASSWORD_CHANGED)
    assert len(rows) == 1
    assert rows[0].actor_email == "ada@example.com"


async def test_wrong_current_password_writes_no_row(pg_client, sessions):
    await _register(pg_client, "ada@example.com")
    tokens = (await _login(pg_client, "ada@example.com")).json()

    r = await pg_client.post(
        "/api/v1/auth/change-password",
        json={"current_password": "nope-nope-nope", "new_password": "a-brand-new-passphrase"},
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert r.status_code == 400
    assert await _rows(sessions, AuditAction.PASSWORD_CHANGED) == []


async def test_forgot_password_reset_records_token_type(pg_client, sessions, monkeypatch):
    await _register(pg_client, "ada@example.com")
    sender = AsyncMock()
    monkeypatch.setattr(email_module, "send_password_reset", sender)

    await pg_client.post("/api/v1/auth/forgot-password", json={"email": "ada@example.com"})
    token = sender.await_args.args[1]

    r = await pg_client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "a-brand-new-passphrase"},
        headers={"User-Agent": UA},
    )
    assert r.status_code == 200

    rows = await _rows(sessions, AuditAction.PASSWORD_RESET)
    assert len(rows) == 1
    assert rows[0].actor_email == "ada@example.com"
    assert rows[0].details == {"token_type": "reset"}
    assert rows[0].user_agent == UA


async def test_invite_set_password_records_invite_token_type(pg_client, sessions):
    await _register(pg_client, "admin@example.com")
    await _set(sessions, "UPDATE users SET role = 'ADMIN' WHERE email = :e", e="admin@example.com")
    admin = (await _login(pg_client, "admin@example.com")).json()["access_token"]

    created = (await pg_client.post(
        "/api/v1/users",
        json={"email": "new.ed@example.com", "role": "editor"},
        headers={"Authorization": f"Bearer {admin}"},
    )).json()
    token = created["invite_link"].split("token=", 1)[1]

    r = await pg_client.post(
        "/api/v1/auth/reset-password",
        json={"token": token, "new_password": "a-brand-new-passphrase"},
    )
    assert r.status_code == 200

    rows = await _rows(sessions, AuditAction.PASSWORD_RESET)
    assert [row.details for row in rows] == [{"token_type": "invite"}]
    assert rows[0].actor_email == "new.ed@example.com"
