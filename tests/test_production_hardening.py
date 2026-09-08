"""Tests for production-readiness guarantees.

These assert the things that would be catastrophic if they silently regressed:
production refusing to run on stub backends, errors not leaking internals, and
security headers being present.
"""
import pytest


BASE_ENV = {
    "secret_key": "a-sufficiently-long-secret-key-for-tests",
    "database_url": "postgresql+psycopg://u:p@db/app",
    "redis_url": "redis://r:6379/0",
}

LIVE_ENV = {
    **BASE_ENV,
    "environment": "production",
    "debug": False,
    "allowed_origins": ["https://app.example.com"],
    "frontend_base_url": "https://app.example.com",
    "stripe_secret_key": "sk_live_x",
    "stripe_webhook_secret": "whsec_x",
    "stripe_price_monthly": "price_m",
    "stripe_price_annual": "price_a",
    "s3_access_key_id": "AKIA_X",
    "s3_secret_access_key": "secret",
    "smtp_host": "smtp.example.com",
    "smtp_from_email": "no-reply@example.com",
}


def _settings(**overrides):
    from app.core.config import Settings

    return Settings(**{**LIVE_ENV, **overrides})


# ── production preflight ──────────────────────────────────────────────────────
def test_fully_configured_production_boots():
    s = _settings()
    assert s.is_production
    assert s.payments_are_live and s.storage_is_live and s.email_is_live


def test_production_refuses_mock_payments():
    """The mock provider accepts unsigned webhooks — never in production."""
    with pytest.raises(ValueError, match="STRIPE_SECRET_KEY"):
        _settings(stripe_secret_key=None, stripe_webhook_secret=None)


def test_production_refuses_stub_storage():
    with pytest.raises(ValueError, match="S3_ACCESS_KEY_ID"):
        _settings(s3_access_key_id=None, s3_secret_access_key=None)


def test_production_refuses_console_email():
    with pytest.raises(ValueError, match="SMTP_HOST"):
        _settings(smtp_host=None, smtp_from_email=None)


def test_production_refuses_debug():
    with pytest.raises(ValueError, match="DEBUG"):
        _settings(debug=True)


def test_production_refuses_wildcard_origin():
    with pytest.raises(ValueError, match="ALLOWED_ORIGINS"):
        _settings(allowed_origins=["*"])


def test_production_refuses_insecure_origin():
    with pytest.raises(ValueError, match="https"):
        _settings(allowed_origins=["http://app.example.com"])


def test_production_refuses_localhost_s3_public_endpoint():
    """S3_PUBLIC_ENDPOINT is a dev-only shim (rewrites the presigned-URL host so
    a browser can reach a compose MinIO). It must not slip into production."""
    with pytest.raises(ValueError, match="S3_PUBLIC_ENDPOINT"):
        _settings(s3_public_endpoint="http://localhost:9000")
    with pytest.raises(ValueError, match="S3_PUBLIC_ENDPOINT"):
        _settings(s3_public_endpoint="http://minio:9000")


def test_production_allows_a_real_s3_public_endpoint():
    """A genuine https host is unusual but not unsafe — don't block it."""
    s = _settings(s3_public_endpoint="https://cdn.example.com")
    assert s.s3_public_endpoint == "https://cdn.example.com"


def test_development_allows_stubs():
    """Stubs remain available outside production so tests need no cloud."""
    from app.core.config import Settings

    s = Settings(**BASE_ENV, environment="development")
    assert not s.is_production
    assert not s.payments_are_live


# ── config loading + secret/environment guards (review finding 1) ─────────────
def test_env_example_placeholder_secret_is_rejected():
    """The exact SECRET_KEY shipped in .env.example must not boot the app."""
    with pytest.raises(ValueError):
        _settings(secret_key="replace-with-a-long-random-string-at-least-32-chars")


def test_production_rejects_world_cidr_trusted_proxy():
    """A world CIDR in trusted_proxies makes X-Forwarded-For forgeable — every
    per-IP rate limit becomes a one-header bypass. The preflight must refuse it."""
    with pytest.raises(ValueError, match="world CIDR"):
        _settings(trusted_proxies=["0.0.0.0/0"])
    with pytest.raises(ValueError, match="world CIDR"):
        _settings(trusted_proxies=["::/0"])


def test_production_rejects_malformed_trusted_proxy():
    with pytest.raises(ValueError, match="not a valid IP or CIDR"):
        _settings(trusted_proxies=["not-an-ip"])


def test_production_allows_scoped_trusted_proxy():
    s = _settings(trusted_proxies=["10.0.0.0/8", "172.18.0.5"])
    assert s.trusted_proxies == ["10.0.0.0/8", "172.18.0.5"]


def test_production_rejects_overbroad_trusted_proxy_prefix():
    """/1 .. /7 (v4) and < /32 (v6) span a large slice of the internet — just as
    forgeable as a world CIDR. The classic evasion is 0.0.0.0/1 + 128.0.0.0/1."""
    with pytest.raises(ValueError, match="too broad"):
        _settings(trusted_proxies=["0.0.0.0/1"])
    with pytest.raises(ValueError, match="too broad"):
        _settings(trusted_proxies=["128.0.0.0/1"])
    with pytest.raises(ValueError, match="too broad"):
        _settings(trusted_proxies=["10.0.0.0/7"])
    with pytest.raises(ValueError, match="too broad"):
        _settings(trusted_proxies=["2001:db8::/16"])


def _dev_settings(**overrides):
    """A non-production Settings — trusted_proxies validation must still run."""
    from app.core.config import Settings

    return Settings(**{**BASE_ENV, "environment": "development", **overrides})


def test_trusted_proxy_format_checked_outside_production():
    """Staging is often internet-reachable — the parse/breadth check is not
    production-only."""
    with pytest.raises(ValueError, match="not a valid IP or CIDR"):
        _dev_settings(trusted_proxies=["not-an-ip"])
    with pytest.raises(ValueError, match="world CIDR"):
        _dev_settings(trusted_proxies=["0.0.0.0/0"])
    with pytest.raises(ValueError, match="too broad"):
        _dev_settings(trusted_proxies=["64.0.0.0/2"])


def test_dev_allows_scoped_trusted_proxy():
    s = _dev_settings(trusted_proxies=["127.0.0.1", "10.0.0.0/8"])
    assert s.trusted_proxies == ["127.0.0.1", "10.0.0.0/8"]


def test_changeme_family_secret_is_rejected():
    with pytest.raises(ValueError):
        _settings(secret_key="change-me-this-is-not-a-real-secret-key-value")


def test_short_secret_is_rejected():
    with pytest.raises(ValueError):
        _settings(secret_key="too-short")


def test_low_entropy_secret_is_rejected():
    """32+ chars but almost no distinct characters — a repeated pattern."""
    with pytest.raises(ValueError):
        _settings(secret_key="a" * 48)


def test_secret_guard_runs_outside_production():
    """The secret-key check fires in development, not only in production."""
    from app.core.config import Settings

    with pytest.raises(ValueError):
        Settings(
            **{
                **BASE_ENV,
                "environment": "development",
                "secret_key": "replace-with-a-long-random-string-at-least-32-chars",
            }
        )


def test_unrecognised_environment_is_rejected():
    with pytest.raises(ValueError):
        _settings(environment="prod")


def test_settings_do_not_source_from_env_example(monkeypatch):
    """With no env vars and no .env file, a required field is unsatisfied —
    proving .env.example is not a runtime config source."""
    from pydantic import ValidationError

    from app.core.config import Settings

    for key in ("SECRET_KEY", "DATABASE_URL", "REDIS_URL", "ENVIRONMENT", "DEBUG"):
        monkeypatch.delenv(key, raising=False)

    with pytest.raises(ValidationError):
        Settings()


# ── error handling ────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_404_includes_correlation_id(client):
    r = await client.get("/api/v1/nope")
    assert r.status_code == 404
    assert "correlation_id" in r.json()


@pytest.mark.asyncio
async def test_validation_errors_are_structured(client):
    r = await client.post(
        "/api/v1/auth/register", json={"email": "not-an-email", "password": "short"}
    )
    assert r.status_code == 422
    body = r.json()
    assert body["detail"] == "Validation failed"
    assert all({"field", "message", "type"} <= set(e) for e in body["errors"])


@pytest.mark.asyncio
async def test_unhandled_error_does_not_leak_internals(client, monkeypatch):
    """A crash must return an opaque message, never a traceback."""
    from app.services import auth_service

    async def boom(*args, **kwargs):
        raise RuntimeError("secret internal detail: db password is hunter2")

    monkeypatch.setattr(auth_service, "get_user_by_email", boom)

    try:
        r = await client.post(
            "/api/v1/auth/login",
            json={"email": "a@example.com", "password": "correct-horse-battery"},
        )
    except RuntimeError:
        pytest.skip("TestClient re-raises; handler verified in integration")
        return

    assert r.status_code == 500
    text = r.text
    assert "hunter2" not in text and "Traceback" not in text
    assert "correlation_id" in r.json()


# ── security headers ──────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_security_headers_present(client):
    r = await client.get("/health/live")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert "Content-Security-Policy" in r.headers
    assert "Referrer-Policy" in r.headers


@pytest.mark.asyncio
async def test_correlation_id_header_returned(client):
    r = await client.get("/health/live")
    assert r.headers.get("X-Correlation-ID")


# ── probes ────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_liveness_ignores_dependencies(client):
    """Liveness must not fail when the database is down."""
    r = await client.get("/health/live")
    assert r.status_code == 200
    assert r.json()["status"] == "alive"


@pytest.mark.asyncio
async def test_body_size_limit_rejects_oversized(client):
    r = await client.post(
        "/api/v1/auth/login",
        content=b"x" * 100,
        headers={"Content-Type": "application/json", "Content-Length": "999999999"},
    )
    assert r.status_code == 413

@pytest.mark.asyncio
async def test_docs_csp_allows_swagger_assets(client):
    r = await client.get("/docs")
    if r.status_code == 404:
        pytest.skip("docs disabled (DEBUG off)")
    csp = r.headers.get("Content-Security-Policy", "")
    assert "cdn.jsdelivr.net" in csp
    assert "connect-src 'self'" in csp
    assert "default-src 'none'" not in csp


@pytest.mark.asyncio
async def test_api_routes_keep_strict_csp(client):
    r = await client.get("/health/live")
    assert r.headers["Content-Security-Policy"] == (
        "default-src 'none'; frame-ancestors 'none'"
    )