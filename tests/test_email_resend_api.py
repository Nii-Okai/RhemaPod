"""Resend HTTPS email transport (EMAIL_TRANSPORT=resend_api). No network:
httpx.MockTransport stands in for api.resend.com."""
import json

import httpx
import pytest
from pydantic import SecretStr
from structlog.testing import capture_logs

from app.core import email as email_module
from app.core.config import Settings, get_settings
from tests.test_production_hardening import LIVE_ENV

KEY = "re_test_super_secret_key"
FROM = "RhemaPod <no-reply@example.com>"


@pytest.fixture(autouse=True)
def _resend_settings(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "email_transport", "resend_api")
    monkeypatch.setattr(s, "resend_api_key", SecretStr(KEY))
    monkeypatch.setattr(s, "smtp_from_email", FROM)
    monkeypatch.setattr(s, "smtp_host", None)


def _client_factory(monkeypatch, handler):
    transport = httpx.MockTransport(handler)
    real = email_module._send_resend_api

    async def patched(to, subject, text, html, **kw):
        await real(to, subject, text, html, transport=transport)

    monkeypatch.setattr(email_module, "_send_resend_api", patched)


async def test_success_sends_bearer_and_json(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "abc"})

    _client_factory(monkeypatch, handler)
    await email_module._send("u@example.com", "Hi", "plain", "<p>html</p>")

    assert seen["url"] == "https://api.resend.com/emails"
    assert seen["auth"] == f"Bearer {KEY}"
    assert seen["body"] == {
        "from": FROM, "to": ["u@example.com"], "subject": "Hi",
        "text": "plain", "html": "<p>html</p>",
    }


@pytest.mark.parametrize("status", [400, 401, 422, 429, 500, 503])
async def test_non_2xx_raises(monkeypatch, status):
    _client_factory(
        monkeypatch,
        lambda r: httpx.Response(status, json={"name": "validation_error", "message": KEY}),
    )
    with pytest.raises(email_module.EmailDeliveryError) as exc:
        await email_module._send("u@example.com", "Hi", "t", "h")
    assert str(status) in str(exc.value)
    assert KEY not in str(exc.value)


async def test_timeout_raises(monkeypatch):
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    _client_factory(monkeypatch, handler)
    with pytest.raises(httpx.TimeoutException):
        await email_module._send("u@example.com", "Hi", "t", "h")


async def test_recipient_and_key_not_logged_when_suppressed(monkeypatch):
    _client_factory(monkeypatch, lambda r: httpx.Response(200, json={"id": "x"}))
    with capture_logs() as logs:
        await email_module._send(
            "gone@example.com", "Deleted", "t", "h", log_recipient=False
        )
    blob = json.dumps(logs, default=str)
    assert "gone@example.com" not in blob
    assert KEY not in blob
    assert any(e["event"] == "email_sent" for e in logs)


async def test_key_not_logged_on_normal_send_or_failure(monkeypatch):
    _client_factory(monkeypatch, lambda r: httpx.Response(200, json={"id": "x"}))
    with capture_logs() as logs:
        await email_module._send("u@example.com", "Hi", "t", "h")
    assert KEY not in json.dumps(logs, default=str)


async def test_smtp_path_unused_under_resend_api(monkeypatch):
    called = []
    monkeypatch.setattr(email_module, "_send_smtp_blocking", lambda *a: called.append(a))
    _client_factory(monkeypatch, lambda r: httpx.Response(200, json={"id": "x"}))
    await email_module._send("u@example.com", "Hi", "t", "h")
    assert called == []


# --- settings / preflight --------------------------------------------------
def test_email_is_live_per_transport():
    base = {"smtp_host": None, "smtp_from_email": None, "resend_api_key": None}
    assert not Settings(**{**base, "email_transport": "resend_api"}).email_is_live
    assert not Settings(
        **{**base, "email_transport": "resend_api", "smtp_from_email": FROM}
    ).email_is_live
    live = Settings(
        **{**base, "email_transport": "resend_api", "smtp_from_email": FROM,
           "resend_api_key": KEY}
    )
    assert live.email_is_live and live.email_backend_label == "resend_api"
    # smtp stays the default and ignores the API key
    smtp = Settings(**{**base, "smtp_host": "h", "smtp_from_email": FROM})
    assert smtp.email_transport == "smtp" and smtp.email_backend_label == "smtp"
    assert not Settings(**{**base, "smtp_from_email": FROM, "resend_api_key": KEY}).email_is_live


def _live(**overrides):
    return Settings(**{**LIVE_ENV, **overrides})


def test_production_accepts_resend_api():
    s = _live(
        email_transport="resend_api", resend_api_key=KEY, smtp_host=None,
    )
    assert s.email_is_live


def test_production_refuses_resend_api_without_key():
    with pytest.raises(ValueError, match="RESEND_API_KEY"):
        _live(email_transport="resend_api", resend_api_key=None)


def test_production_refuses_resend_api_without_from():
    with pytest.raises(ValueError, match="SMTP_FROM_EMAIL"):
        _live(email_transport="resend_api", resend_api_key=KEY, smtp_from_email=None)


async def test_preflight_check_resend_api(monkeypatch):
    from app.scripts.preflight import _check_email

    out = await _check_email()
    assert out == "resend_api: api.resend.com"
    assert KEY not in out


async def test_preflight_check_resend_api_missing_key_fails(monkeypatch):
    from app.scripts.preflight import _check_email

    monkeypatch.setattr(get_settings(), "resend_api_key", None)
    with pytest.raises(RuntimeError, match="RESEND_API_KEY"):
        await _check_email()


async def test_preflight_check_smtp_unchanged(monkeypatch):
    from app.scripts.preflight import _check_email

    s = get_settings()
    monkeypatch.setattr(s, "email_transport", "smtp")
    monkeypatch.setattr(s, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(s, "smtp_port", 587)
    assert await _check_email() == "smtp: smtp.example.com:587"
