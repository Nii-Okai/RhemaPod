"""Regression tests for the auth-review remediation (plans/plan.md steps 2-4).

- Step 2 / finding 4: Redis-down on the auth path is a deliberate, typed 503,
  never a naked 500; the login rate limiter still fails open.
- Step 3 / finding 2: reset/invite tokens are single-use; a consume that cannot
  reach Redis rejects with 503 and leaves the password unchanged.
- Step 4 / finding 3: /auth/forgot-password never writes a token to the logs and
  stays a generic, non-enumerable response even when email delivery fails.

Each test here fails against the pre-fix code.
"""
from unittest.mock import AsyncMock

import pytest

from tests.conftest import _fake

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"
NEW_PW = "brand-new-passphrase-9"


async def _register(client, email="user@example.com", password=PW):
    return await client.post(
        "/api/v1/auth/register", json={"email": email, "password": password}
    )


async def _login(client, email="user@example.com", password=PW):
    return await client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )


class _RecordingLogger:
    """Stand-in for a structlog BoundLogger that just records what it was told."""

    def __init__(self) -> None:
        self.records: list[dict] = []

    def _record(self, level: str, event: str, **kw) -> None:
        self.records.append({"level": level, "event": event, **kw})

    def debug(self, event, **kw):
        self._record("debug", event, **kw)

    def info(self, event, **kw):
        self._record("info", event, **kw)

    def warning(self, event, **kw):
        self._record("warning", event, **kw)

    def error(self, event, **kw):
        self._record("error", event, **kw)

    def exception(self, event, **kw):
        self._record("exception", event, **kw)


# ── Step 2 / finding 4 — Redis failure posture ───────────────────────────────
async def test_login_returns_503_not_500_when_redis_down(client):
    await _register(client)
    with _fake.failing():
        r = await _login(client)
    assert r.status_code == 503
    body = r.json()
    assert body["correlation_id"]
    assert "Traceback" not in r.text


async def test_refresh_returns_503_not_500_when_redis_down(client):
    await _register(client)
    tokens = (await _login(client)).json()
    with _fake.failing():
        r = await client.post(
            "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )
    assert r.status_code == 503
    assert r.json()["correlation_id"]


async def test_logout_returns_503_rather_than_false_success_when_redis_down(client):
    await _register(client)
    tokens = (await _login(client)).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    with _fake.failing():
        r = await client.post("/api/v1/auth/logout", headers=headers)
    # A 200 here would claim the session was revoked when it was not.
    assert r.status_code == 503
    assert r.json()["correlation_id"]


async def test_rate_limiter_still_fails_open_when_redis_down(client):
    """The login limiter must keep letting requests through on a Redis outage —
    asserted directly so it can't be regressed silently."""
    from app.core.rate_limit import check_rate_limit

    with _fake.failing():
        allowed = await check_rate_limit("login:1.2.3.4:a@b.com", limit=1, window_seconds=60)
    assert allowed is True


# ── Step 3 / finding 2 — single-use reset/invite tokens ──────────────────────
async def test_reset_returns_503_and_leaves_password_unchanged_when_redis_down(client):
    await _register(client)
    from app.core import security, token_store

    tokens = (await _login(client)).json()
    me = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    user_id = me.json()["id"]
    reset_token, jti = security.create_reset_token(user_id)
    await token_store.register_single_use(jti, 3600)

    with _fake.failing():
        r = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": reset_token, "new_password": NEW_PW},
        )
    assert r.status_code == 503

    # Password must be untouched: the old one still works, the new one does not.
    assert (await _login(client, password=PW)).status_code == 200
    assert (await _login(client, password=NEW_PW)).status_code == 401


async def test_access_and_refresh_tokens_are_rejected_at_reset_password(client):
    """Widening the reset endpoint to accept {reset, invite} must not weaken the
    type-confusion guard — an access or refresh token is still refused."""
    await _register(client)
    tokens = (await _login(client)).json()

    for bad in (tokens["access_token"], tokens["refresh_token"]):
        r = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": bad, "new_password": NEW_PW},
        )
        assert r.status_code == 400


# ── Step 4 / finding 3 — no live token in the logs ──────────────────────────
async def test_forgot_password_auth_router_never_logs_a_token(client, monkeypatch):
    """The auth router itself must never put a reset token in a log line. The
    email seam is stubbed so this isolates the router's own logging."""
    import app.api.auth as auth_module
    from app.core import email as email_module

    await _register(client, email="known@example.com")

    recorder = _RecordingLogger()
    monkeypatch.setattr(auth_module, "log", recorder)
    monkeypatch.setattr(email_module, "send_password_reset", AsyncMock())

    r = await client.post(
        "/api/v1/auth/forgot-password", json={"email": "known@example.com"}
    )
    assert r.status_code == 200

    for rec in recorder.records:
        for value in rec.values():
            assert "eyJ" not in str(value), f"JWT-shaped value leaked into a log: {rec}"
        assert "reset_token" not in rec and "token" not in rec


async def test_console_email_backend_gets_link_but_token_never_reaches_app_logger(
    client, monkeypatch
):
    """The dev console email backend legitimately logs the reset link, token and
    all — the sanctioned dev affordance. What must never happen is that same
    token appearing in the application's own (auth-router) logs. This exercises
    the real console backend rather than a stub."""
    import app.api.auth as auth_module
    from app.core import email as email_module

    await _register(client, email="known@example.com")

    auth_recorder = _RecordingLogger()
    email_recorder = _RecordingLogger()
    monkeypatch.setattr(auth_module, "log", auth_recorder)
    monkeypatch.setattr(email_module, "log", email_recorder)

    r = await client.post(
        "/api/v1/auth/forgot-password", json={"email": "known@example.com"}
    )
    assert r.status_code == 200

    # The console backend really did receive the send, link and all.
    console = [
        rec for rec in email_recorder.records if rec["event"] == "email_send_console"
    ]
    assert len(console) == 1
    assert "eyJ" in console[0]["body"]

    # ...but that token never reached the auth-router logger.
    for rec in auth_recorder.records:
        for value in rec.values():
            assert "eyJ" not in str(value), f"token leaked into app logs: {rec}"


async def test_forgot_password_defers_dispatch_to_background_tasks(engine, monkeypatch):
    """The known-email side effects (jti ledger write + SMTP send) must be queued
    on BackgroundTasks, not awaited on the response path — an awaited SMTP
    connect would make the endpoint's latency answer 'does this address exist?'."""
    from fastapi import BackgroundTasks
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    import app.api.auth as auth_module
    from app.core import email as email_module
    from app.models.schemas import ForgotPasswordRequest, UserRegister
    from app.services import auth_service

    sender = AsyncMock()
    registrar = AsyncMock()
    monkeypatch.setattr(email_module, "send_password_reset", sender)
    monkeypatch.setattr(auth_module.token_store, "register_single_use", registrar)

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as db:
        await auth_service.register_user(
            db, UserRegister(email="known@example.com", password=PW)
        )
        bg = BackgroundTasks()
        resp = await auth_module.forgot_password(
            ForgotPasswordRequest(email="known@example.com"), bg, db
        )

    # Response is fully formed with neither seam touched...
    assert resp.message
    assert sender.await_count == 0
    assert registrar.await_count == 0
    # ...the work is queued instead.
    assert len(bg.tasks) == 1

    # Draining the queue (what Starlette does after sending the response) then
    # performs exactly that deferred dispatch.
    await bg()
    assert registrar.await_count == 1
    assert sender.await_count == 1


# ── Finding 4 residual — revoke-before-commit on change-password / role ──────
async def test_change_password_returns_503_and_leaves_password_unchanged_when_redis_down(
    client,
):
    await _register(client)
    tokens = (await _login(client)).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    with _fake.failing():
        r = await client.post(
            "/api/v1/auth/change-password",
            json={"current_password": PW, "new_password": NEW_PW},
            headers=headers,
        )
    assert r.status_code == 503

    # The write rolled back with the failed revoke: old password still
    # authenticates, the new one does not.
    assert (await _login(client, password=PW)).status_code == 200
    assert (await _login(client, password=NEW_PW)).status_code == 401


async def test_change_role_returns_503_and_leaves_role_unchanged_when_redis_down(
    client, engine
):
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    await _register(client, email="admin@example.com")
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await s.execute(
            text("UPDATE users SET role = 'ADMIN' WHERE email = 'admin@example.com'")
        )
        await s.commit()
    await _register(client, email="target@example.com")  # defaults to viewer

    admin_tokens = (await _login(client, email="admin@example.com")).json()
    admin_h = {"Authorization": f"Bearer {admin_tokens['access_token']}"}

    users = (await client.get("/api/v1/users", headers=admin_h)).json()["items"]
    tid = next(u["id"] for u in users if u["email"] == "target@example.com")

    with _fake.failing():
        r = await client.patch(
            f"/api/v1/users/{tid}/role", json={"role": "editor"}, headers=admin_h
        )
    assert r.status_code == 503

    users = (await client.get("/api/v1/users", headers=admin_h)).json()["items"]
    role_after = next(u["role"] for u in users if u["email"] == "target@example.com")
    assert role_after == "viewer"


async def test_forgot_password_invokes_email_seam_only_for_known_address(
    client, monkeypatch
):
    from app.core import email as email_module

    spy = AsyncMock()
    monkeypatch.setattr(email_module, "send_password_reset", spy)
    await _register(client, email="known@example.com")

    await client.post(
        "/api/v1/auth/forgot-password", json={"email": "known@example.com"}
    )
    assert spy.await_count == 1
    to_addr, token = spy.await_args.args
    assert to_addr == "known@example.com"
    assert isinstance(token, str) and token

    await client.post(
        "/api/v1/auth/forgot-password", json={"email": "nobody@example.com"}
    )
    assert spy.await_count == 1  # unknown address: seam not invoked


async def test_forgot_password_generic_even_when_email_backend_raises(
    client, monkeypatch
):
    from app.core import email as email_module

    monkeypatch.setattr(
        email_module,
        "send_password_reset",
        AsyncMock(side_effect=RuntimeError("smtp is down")),
    )
    await _register(client, email="known@example.com")

    known = await client.post(
        "/api/v1/auth/forgot-password", json={"email": "known@example.com"}
    )
    unknown = await client.post(
        "/api/v1/auth/forgot-password", json={"email": "nobody@example.com"}
    )

    # A send failure must not become the enumeration oracle the generic
    # response exists to prevent.
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()
