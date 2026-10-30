"""Privacy log hardening (security cross-check of the AD5 L1 data inventory):
no secrets in email subjects, no recipient in `email_sent`, hashed email in
limiter keys, key prefix only in rate-limit logs, console body dev/test only."""
import json

import httpx
import pytest
from pydantic import SecretStr
from structlog.testing import capture_logs

from app.core import email as email_module
from app.core import rate_limit
from app.core.config import get_settings
from app.core.rate_limit import email_digest, key_prefix, login_rate_limit_key
from tests.conftest import _fake

pytestmark = pytest.mark.asyncio

ADDR = "Someone@Example.com"
CODE = "483920"


async def _live_resend(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "email_transport", "resend_api")
    monkeypatch.setattr(s, "resend_api_key", SecretStr("re_k"))
    monkeypatch.setattr(s, "smtp_from_email", "A <no-reply@example.com>")
    monkeypatch.setattr(s, "smtp_host", None)
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json={"id": "x"}))
    real = email_module._send_resend_api

    async def patched(to, subject, text, html, **kw):
        await real(to, subject, text, html, transport=transport)

    monkeypatch.setattr(email_module, "_send_resend_api", patched)


async def test_verification_subject_has_no_code_and_email_sent_has_no_recipient(monkeypatch):
    await _live_resend(monkeypatch)
    with capture_logs() as logs:
        await email_module.send_email_verification(ADDR, CODE)
    sent = [e for e in logs if e["event"] == "email_sent"]
    assert len(sent) == 1
    assert "to" not in sent[0]
    assert CODE not in sent[0]["subject"]
    blob = json.dumps(logs, default=str)
    assert CODE not in blob and ADDR.lower() not in blob.lower()


async def test_no_send_subject_carries_the_secret(monkeypatch):
    await _live_resend(monkeypatch)
    token = "tok-SECRET-abc123"
    with capture_logs() as logs:
        await email_module.send_email_verification(ADDR, CODE)
        await email_module.send_password_reset(ADDR, token)
    blob = json.dumps([e for e in logs if e["event"] == "email_sent"])
    assert CODE not in blob and token not in blob


@pytest.mark.parametrize(
    "env,expect_body", [("development", True), ("test", True), ("staging", False), ("production", False)]
)
async def test_console_body_only_in_dev_and_test(monkeypatch, env, expect_body):
    s = get_settings()
    monkeypatch.setattr(s, "smtp_host", "")
    monkeypatch.setattr(s, "environment", env)
    with capture_logs() as logs:
        await email_module.send_email_verification(ADDR, CODE)
    (rec,) = [e for e in logs if e["event"] == "email_send_console"]
    assert ("body" in rec) is expect_body
    assert ("to" in rec) is expect_body
    if not expect_body:
        assert CODE not in json.dumps(rec, default=str)


async def test_deleted_notice_text_says_90_days(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "smtp_host", "")
    monkeypatch.setattr(s, "environment", "development")
    sent = []
    real = email_module._send

    async def spy(to, subject, text, html, **kw):
        sent.append(text)
        await real(to, subject, text, html, **kw)

    monkeypatch.setattr(email_module, "_send", spy)
    await email_module.send_account_deleted("gone@example.com")
    assert "90 days" in sent[0] and "30 days" not in sent[0]


async def test_key_prefix_and_digest():
    assert key_prefix("login:1.2.3.4:abcd") == "login"
    assert key_prefix("nocolon") == "nocolon"
    assert email_digest("A@B.com") == email_digest("a@b.com")
    assert login_rate_limit_key("1.1.1.1", "A@B.com") == f"login:1.1.1.1:{email_digest('a@b.com')}"


async def test_resend_and_forgot_limiter_keys_are_hashed(client):
    addr = "Hashed.Person@example.com"
    r = await client.post("/api/v1/auth/resend-verification", json={"email": addr})
    assert r.status_code == 200
    r = await client.post("/api/v1/auth/forgot-password", json={"email": addr})
    assert r.status_code == 200
    d = email_digest(addr)
    assert f"ratelimit:resend_verification:{d}" in _fake.store
    assert f"ratelimit:forgot_password:{d}" in _fake.store
    for k in _fake.store:
        assert addr.lower() not in k.lower()


async def test_rate_limit_unavailable_logs_and_error_carry_prefix_only():
    key = "forgot_password:deadbeefdeadbeef"
    with _fake.failing(), capture_logs() as logs:
        with pytest.raises(rate_limit.RateLimitUnavailable) as exc:
            await rate_limit.check_rate_limit(key, 1, 60, fail_open=False)
        assert await rate_limit.check_token_bucket("user:abc", 1, 1) is True
    assert str(exc.value) == "forgot_password"
    events = [e for e in logs if e["event"] == "rate_limit_unavailable"]
    assert [e["key_prefix"] for e in events] == ["forgot_password", "user"]
    blob = json.dumps(events)
    assert "deadbeef" not in blob and "abc" not in blob and '"key"' not in blob
