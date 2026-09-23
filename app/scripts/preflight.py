"""Deployment preflight check.

Run this in CI/CD before promoting a build, and on the target host before
starting the app. It validates configuration and proves every external
dependency is actually reachable with the credentials provided — turning a
runtime outage into a failed deploy.

    uv run python -m app.scripts.preflight
"""
from __future__ import annotations

import asyncio
import sys


async def _check(name: str, coro) -> tuple[str, bool, str]:
    try:
        detail = await coro
        return name, True, detail or "ok"
    except Exception as exc:
        return name, False, f"{type(exc).__name__}: {exc}"


async def _check_db() -> str:
    from sqlalchemy import text
    from app.db.database import primary_engine

    async with primary_engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return "reachable"


async def _check_redis() -> str:
    from app.core.redis import get_redis

    await get_redis().ping()
    return "reachable"


async def _check_storage() -> str:
    from app.core.config import get_settings
    from app.core.storage import LocalStorage, get_storage

    s = get_settings()
    backend = get_storage()
    if isinstance(backend, LocalStorage):
        if s.is_production:
            raise RuntimeError("stub storage backend active in production")
        return "local stub (development)"
    # Prove the credentials actually work, not just that they're present.
    backend.presigned_download_url(s.s3_media_bucket, "preflight-probe", 60)
    return f"s3: {s.s3_media_bucket}"


async def _check_stream() -> str:
    from app.core.config import get_settings
    from app.core.stream import LocalStream, get_provider

    s = get_settings()
    provider = get_provider()
    if isinstance(provider, LocalStream):
        if s.is_production:
            raise RuntimeError("stub Stream provider active in production")
        return "local stub (development)"
    if not s.cf_stream_webhook_secret:
        raise RuntimeError(
            "CF_STREAM_WEBHOOK_SECRET not set — the webhook endpoint cannot "
            "verify inbound Cloudflare Stream events"
        )
    if not s.stream_signing_is_configured:
        raise RuntimeError(
            "CF_STREAM_SIGNING_KEY_ID / CF_STREAM_SIGNING_KEY_PEM not set — "
            "get_stream/get_audio_download cannot sign playback URLs for any "
            "Stream-ingested rendition"
        )
    return "cloudflare"


async def _check_payments() -> str:
    from app.core.config import get_settings
    from app.core.payments import MockProvider, get_provider

    s = get_settings()
    provider = get_provider()
    if isinstance(provider, MockProvider):
        if s.is_production:
            raise RuntimeError("mock payment provider active in production")
        return "mock (development)"
    return "stripe"


async def _check_email() -> str:
    from app.core.config import get_settings

    s = get_settings()
    if not s.email_is_live:
        if s.is_production:
            raise RuntimeError("console email backend active in production")
        return "console (development)"
    return f"smtp: {s.smtp_host}:{s.smtp_port}"


async def _check_cdn() -> str:
    """CDN_BASE_URL without CDN signing serves unsigned URLs for deterministic,
    publicly-guessable object keys — see app/core/storage.py's cdn_url_for().
    `production_preflight` in app/core/config.py already refuses to construct
    Settings at all with this set in production; this check exists so the same
    misconfiguration is caught here too (this script also runs against
    staging, which that validator does not cover)."""
    from app.core.config import get_settings

    s = get_settings()
    if not s.cdn_base_url:
        return "not configured (presigned URLs)"
    raise RuntimeError(
        "CDN_BASE_URL is set but no CDN request-signing is implemented — "
        "this would serve unsigned CDN URLs. Remove CDN_BASE_URL until "
        "cdn_url_for() in app/core/storage.py implements real signing."
    )


async def _check_migrations() -> str:
    from sqlalchemy import text
    from app.db.database import primary_engine

    async with primary_engine.connect() as conn:
        row = (await conn.execute(
            text("SELECT version_num FROM alembic_version")
        )).fetchone()
    if row is None:
        raise RuntimeError("no alembic_version row — migrations have not run")
    return f"at {row.version_num}"


async def _run() -> int:
    # Importing settings triggers the production preflight validator.
    try:
        from app.core.config import get_settings

        settings = get_settings()
    except Exception as exc:
        print("[FAIL] configuration\n")
        print(exc)
        return 1

    print(f"Environment: {settings.environment}\n")

    results = await asyncio.gather(
        _check("database", _check_db()),
        _check("migrations", _check_migrations()),
        _check("redis", _check_redis()),
        _check("storage", _check_storage()),
        _check("cdn", _check_cdn()),
        _check("stream", _check_stream()),
        _check("payments", _check_payments()),
        _check("email", _check_email()),
    )

    failed = 0
    for name, ok, detail in results:
        mark = "[ ok ]" if ok else "[FAIL]"
        print(f"{mark} {name:<12} {detail}")
        if not ok:
            failed += 1

    print()
    if failed:
        print(f"{failed} check(s) failed — do not deploy.")
        return 1
    print("All checks passed.")
    return 0


def main() -> None:
    sys.exit(asyncio.run(_run()))


if __name__ == "__main__":
    main()
