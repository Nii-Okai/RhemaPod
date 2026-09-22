"""app/scripts/preflight.py's CDN check.

`Settings.production_preflight` (app/core/config.py) already refuses to
construct Settings at all with CDN_BASE_URL set in production. This script
also runs against staging, which that validator does not cover, so it needs
its own guard against the same misconfiguration — CDN_BASE_URL set with no
CDN request-signing implementation behind it.
"""
import pytest

pytestmark = pytest.mark.asyncio


async def test_check_cdn_ok_when_unset(monkeypatch):
    from app.core.config import get_settings
    from app.scripts.preflight import _check_cdn

    monkeypatch.setattr(get_settings(), "cdn_base_url", None)
    assert await _check_cdn() == "not configured (presigned URLs)"


async def test_check_cdn_fails_when_set_without_signing(monkeypatch):
    from app.core.config import get_settings
    from app.scripts.preflight import _check_cdn

    monkeypatch.setattr(get_settings(), "cdn_base_url", "https://cdn.example.com")
    with pytest.raises(RuntimeError, match="CDN_BASE_URL"):
        await _check_cdn()
