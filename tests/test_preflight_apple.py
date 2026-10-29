"""Apple revocation preflight (plan D5, §A.5).

`Settings.production_preflight` refuses to construct Settings at all in
production with `oauth_apple_enabled` and a stub backend / missing or unusable
key. app/scripts/preflight.py repeats the check for staging. Neither makes a
network call.
"""
import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa

from tests.test_production_hardening import LIVE_ENV

def _pem(key) -> str:
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


P256 = _pem(ec.generate_private_key(ec.SECP256R1()))
P384 = _pem(ec.generate_private_key(ec.SECP384R1()))
RSA = _pem(rsa.generate_private_key(public_exponent=65537, key_size=2048))

APPLE_OK = {
    "oauth_apple_enabled": True,
    "apple_revocation_backend": "http",
    "apple_key_id": "ABC123DEFG",
    "apple_private_key": P256,
}


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Sentinel: any attempt to send an HTTP request fails the test."""
    calls: list[str] = []

    async def _async_send(self, request, **kw):
        calls.append(str(request.url))
        raise AssertionError("preflight made a network call")

    def _sync_send(self, request, **kw):
        calls.append(str(request.url))
        raise AssertionError("preflight made a network call")

    monkeypatch.setattr(httpx.AsyncClient, "send", _async_send)
    monkeypatch.setattr(httpx.Client, "send", _sync_send)
    yield calls
    assert calls == []


def _settings(**overrides):
    from app.core.config import Settings

    return Settings(**{**LIVE_ENV, **overrides})


def test_production_accepts_ephemeral_p256_key():
    s = _settings(**APPLE_OK)
    assert s.apple_revocation_backend == "http"


def test_production_accepts_single_line_escaped_p256_key():
    s = _settings(**{**APPLE_OK, "apple_private_key": P256.strip().replace("\n", "\\n")})
    assert s.apple_private_key.get_secret_value() == P256.strip()


def test_production_refuses_stub_backend():
    with pytest.raises(ValueError, match="APPLE_REVOCATION_BACKEND"):
        _settings(**{**APPLE_OK, "apple_revocation_backend": "stub"})


def test_production_refuses_missing_key_id():
    with pytest.raises(ValueError, match="APPLE_KEY_ID"):
        _settings(**{**APPLE_OK, "apple_key_id": None})


def test_production_refuses_missing_private_key():
    with pytest.raises(ValueError, match="APPLE_PRIVATE_KEY is required"):
        _settings(**{**APPLE_OK, "apple_private_key": None})


@pytest.mark.parametrize(
    ("label", "pem"),
    [("rsa", RSA), ("p384", P384), ("garbage", "not a pem at all")],
)
def test_production_refuses_unusable_private_key(label, pem):
    with pytest.raises(ValueError, match="APPLE_PRIVATE_KEY is unusable") as exc:
        _settings(**{**APPLE_OK, "apple_private_key": pem})
    # The message must not echo key material.
    assert "BEGIN" not in str(exc.value) and "not a pem at all" not in str(exc.value)


def test_apple_disabled_production_passes_on_stub():
    s = _settings(oauth_apple_enabled=False)
    assert s.apple_revocation_backend == "stub"


def test_non_production_with_stub_passes():
    s = _settings(environment="development", oauth_apple_enabled=True)
    assert s.apple_revocation_backend == "stub"


# ── app/scripts/preflight.py (also covers staging) ────────────────────────────


async def test_script_check_not_required_when_apple_disabled(monkeypatch):
    from app.core.config import get_settings
    from app.scripts.preflight import _check_apple_revocation

    monkeypatch.setattr(get_settings(), "oauth_apple_enabled", False)
    assert "not required" in await _check_apple_revocation()


async def test_script_check_fails_on_stub_when_apple_enabled(monkeypatch):
    from app.core.config import get_settings
    from app.scripts.preflight import _check_apple_revocation

    s = get_settings()
    monkeypatch.setattr(s, "oauth_apple_enabled", True)
    monkeypatch.setattr(s, "apple_revocation_backend", "stub")
    with pytest.raises(RuntimeError, match="APPLE_REVOCATION_BACKEND"):
        await _check_apple_revocation()


async def test_script_check_passes_with_p256_key(monkeypatch):
    from pydantic import SecretStr

    from app.core.config import get_settings
    from app.scripts.preflight import _check_apple_revocation

    s = get_settings()
    monkeypatch.setattr(s, "oauth_apple_enabled", True)
    monkeypatch.setattr(s, "apple_revocation_backend", "http")
    monkeypatch.setattr(s, "apple_key_id", "ABC123DEFG")
    monkeypatch.setattr(s, "apple_private_key", SecretStr(P256))
    assert await _check_apple_revocation() == "http"


async def test_script_check_fails_on_rsa_key(monkeypatch):
    from pydantic import SecretStr

    from app.core.config import get_settings
    from app.scripts.preflight import _check_apple_revocation

    s = get_settings()
    monkeypatch.setattr(s, "oauth_apple_enabled", True)
    monkeypatch.setattr(s, "apple_revocation_backend", "http")
    monkeypatch.setattr(s, "apple_key_id", "ABC123DEFG")
    monkeypatch.setattr(s, "apple_private_key", SecretStr(RSA))
    with pytest.raises(RuntimeError, match="unusable"):
        await _check_apple_revocation()
