"""Google server-auth-code exchange preflight (ADR 0015 addendum, plan D.4).

`Settings.production_preflight` refuses to construct Settings in production
when OAUTH_GOOGLE_AUTH_CODE_ENABLED is on without the web client id / secret
(or with a web id outside GOOGLE_OAUTH_CLIENT_IDS). app/scripts/preflight.py
repeats the check in every environment, so Render dev (development) is covered
too. Neither makes a network call.
"""
import httpx
import pytest
from pydantic import SecretStr

from tests.test_production_hardening import LIVE_ENV

WEB = "web-client.apps.googleusercontent.com"
OK = {
    "oauth_google_auth_code_enabled": True,
    "google_oauth_client_ids": [WEB, "ios-client"],
    "google_oauth_web_client_id": WEB,
    "google_oauth_client_secret": "GOCSPX-placeholder",
}


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    calls: list[str] = []

    async def _async_send(self, request, **kw):
        calls.append(str(request.url))
        raise AssertionError("preflight made a network call")

    monkeypatch.setattr(httpx.AsyncClient, "send", _async_send)
    yield calls
    assert calls == []


def _settings(**overrides):
    from app.core.config import Settings

    return Settings(**{**LIVE_ENV, **overrides})


def test_production_accepts_complete_config():
    s = _settings(**OK)
    assert s.google_oauth_client_secret.get_secret_value() == "GOCSPX-placeholder"
    assert "GOCSPX" not in repr(s.google_oauth_client_secret)


def test_flag_off_needs_nothing():
    s = _settings(oauth_google_auth_code_enabled=False)
    assert s.google_oauth_client_secret is None


@pytest.mark.parametrize(("override", "match"), [
    ({"google_oauth_client_secret": None}, "GOOGLE_OAUTH_CLIENT_SECRET is required"),
    ({"google_oauth_client_secret": ""}, "GOOGLE_OAUTH_CLIENT_SECRET is required"),
    ({"google_oauth_web_client_id": None}, "GOOGLE_OAUTH_WEB_CLIENT_ID is required"),
    ({"google_oauth_web_client_id": "other.apps.googleusercontent.com"},
     "must be listed in GOOGLE_OAUTH_CLIENT_IDS"),
])
def test_production_refuses_bad_config(override, match):
    with pytest.raises(ValueError, match=match):
        _settings(**{**OK, **override})


def test_non_production_construction_does_not_refuse():
    # The development-wide check lives in app/scripts/preflight.py (below).
    s = _settings(environment="development", **{**OK, "google_oauth_client_secret": None})
    assert s.google_oauth_client_secret is None


# ── app/scripts/preflight.py: every environment ───────────────────────────────
@pytest.fixture
def dev_settings(monkeypatch):
    from app.core.config import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "environment", "development")
    monkeypatch.setattr(s, "oauth_google_auth_code_enabled", True)
    monkeypatch.setattr(s, "google_oauth_client_ids", [WEB])
    monkeypatch.setattr(s, "google_oauth_web_client_id", WEB)
    monkeypatch.setattr(s, "google_oauth_client_secret", SecretStr("GOCSPX-placeholder"))
    return s


async def test_script_not_required_when_flag_off(monkeypatch):
    from app.core.config import get_settings
    from app.scripts.preflight import _check_google_auth_code

    monkeypatch.setattr(get_settings(), "oauth_google_auth_code_enabled", False)
    assert "not required" in await _check_google_auth_code()


async def test_script_passes_when_complete_in_development(dev_settings):
    from app.scripts.preflight import _check_google_auth_code

    assert await _check_google_auth_code() == "configured"


@pytest.mark.parametrize(("attr", "value", "match"), [
    ("google_oauth_client_secret", None, "GOOGLE_OAUTH_CLIENT_SECRET"),
    ("google_oauth_web_client_id", None, "GOOGLE_OAUTH_WEB_CLIENT_ID is required"),
    ("google_oauth_web_client_id", "not-listed", "must be listed in GOOGLE_OAUTH_CLIENT_IDS"),
])
async def test_script_fails_in_development(dev_settings, monkeypatch, attr, value, match):
    from app.scripts.preflight import _check_google_auth_code

    monkeypatch.setattr(dev_settings, attr, value)
    with pytest.raises(RuntimeError, match=match):
        await _check_google_auth_code()
