"""app/scripts/preflight.py's Stream check.

`Settings.production_preflight` (app/core/config.py) already refuses to
construct Settings at all with Stream live but no webhook secret, or in
production on the stub. This script also runs against staging, which that
validator does not cover, so it needs its own guard — same idiom as
test_preflight_cdn.py.
"""
import pytest

pytestmark = pytest.mark.asyncio


async def test_check_stream_ok_on_stub_in_development():
    from app.scripts.preflight import _check_stream

    assert await _check_stream() == "local stub (development)"


async def test_check_stream_ok_when_live_with_webhook_secret_and_signing_key(monkeypatch):
    from app.core import stream as stream_module
    from app.core.config import get_settings
    from app.scripts.preflight import _check_stream

    monkeypatch.setattr(get_settings(), "cf_account_id", "acct_x")
    monkeypatch.setattr(get_settings(), "cf_stream_api_token", "cfut_x")
    monkeypatch.setattr(get_settings(), "cf_stream_webhook_secret", "whsec_x")
    monkeypatch.setattr(get_settings(), "cf_stream_signing_key_id", "key_x")
    monkeypatch.setattr(get_settings(), "cf_stream_signing_key_pem", "pem_x")
    stream_module.set_provider(None)
    try:
        assert await _check_stream() == "cloudflare"
    finally:
        stream_module.set_provider(stream_module.LocalStream())


async def test_check_stream_fails_when_live_without_webhook_secret(monkeypatch):
    from app.core import stream as stream_module
    from app.core.config import get_settings
    from app.scripts.preflight import _check_stream

    monkeypatch.setattr(get_settings(), "cf_account_id", "acct_x")
    monkeypatch.setattr(get_settings(), "cf_stream_api_token", "cfut_x")
    monkeypatch.setattr(get_settings(), "cf_stream_webhook_secret", None)
    monkeypatch.setattr(get_settings(), "cf_stream_signing_key_id", "key_x")
    monkeypatch.setattr(get_settings(), "cf_stream_signing_key_pem", "pem_x")
    stream_module.set_provider(None)
    try:
        with pytest.raises(RuntimeError, match="CF_STREAM_WEBHOOK_SECRET"):
            await _check_stream()
    finally:
        stream_module.set_provider(stream_module.LocalStream())


async def test_check_stream_fails_when_live_without_signing_key(monkeypatch):
    """Staging isn't covered by Settings.production_preflight (which early-
    returns past non-production), so this script needs its own guard for the
    signing key too — same reasoning as the webhook-secret check above."""
    from app.core import stream as stream_module
    from app.core.config import get_settings
    from app.scripts.preflight import _check_stream

    monkeypatch.setattr(get_settings(), "cf_account_id", "acct_x")
    monkeypatch.setattr(get_settings(), "cf_stream_api_token", "cfut_x")
    monkeypatch.setattr(get_settings(), "cf_stream_webhook_secret", "whsec_x")
    monkeypatch.setattr(get_settings(), "cf_stream_signing_key_id", None)
    monkeypatch.setattr(get_settings(), "cf_stream_signing_key_pem", None)
    stream_module.set_provider(None)
    try:
        with pytest.raises(RuntimeError, match="CF_STREAM_SIGNING_KEY_ID"):
            await _check_stream()
    finally:
        stream_module.set_provider(stream_module.LocalStream())
