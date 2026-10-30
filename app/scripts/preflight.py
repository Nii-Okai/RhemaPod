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


async def _r2_probe(client, bucket: str) -> str:
    """`HeadBucket`, falling back to a scoped `ListObjectsV2` when the token
    is object-scoped and `HeadBucket` comes back 403 (plan §A.2.5 — R2.2
    records which one the real dev token needs). boto3 is synchronous, so
    the actual network call runs in a thread.
    """
    from botocore.exceptions import ClientError

    def _probe() -> str:
        try:
            client.head_bucket(Bucket=bucket)
            return "head_bucket"
        except ClientError as exc:
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            code = exc.response.get("Error", {}).get("Code", "")
            if status == 403 or code in ("403", "AccessDenied"):
                client.list_objects_v2(Bucket=bucket, MaxKeys=1)
                return "list_objects_v2 (head_bucket refused with 403)"
            raise

    return await asyncio.to_thread(_probe)


async def _archive_probe(client, bucket: str) -> str:
    """`HeadBucket` -> `GetBucketVersioning` == Enabled -> an
    abort-incomplete-multipart-upload lifecycle rule is present ->
    `GetObjectLockConfiguration` has a GOVERNANCE default retention (plan
    §A.2.5). Each stage only runs once the previous one has passed, and a
    failure names the stage it failed at rather than a bare boto3 error.
    """
    def _probe() -> str:
        client.head_bucket(Bucket=bucket)

        versioning = client.get_bucket_versioning(Bucket=bucket)
        status = versioning.get("Status")
        if status != "Enabled":
            raise RuntimeError(
                f"bucket versioning is {status!r}, must be 'Enabled'"
            )

        lifecycle = client.get_bucket_lifecycle_configuration(Bucket=bucket)
        rules = lifecycle.get("Rules", [])
        if not any("AbortIncompleteMultipartUpload" in rule for rule in rules):
            raise RuntimeError(
                "no abort-incomplete-multipart-upload lifecycle rule found"
            )

        lock = client.get_object_lock_configuration(Bucket=bucket)
        default_retention = (
            lock.get("ObjectLockConfiguration", {})
            .get("Rule", {})
            .get("DefaultRetention", {})
        )
        mode = default_retention.get("Mode")
        if mode != "GOVERNANCE":
            raise RuntimeError(
                f"object lock default retention mode is {mode!r}, must be "
                "'GOVERNANCE'"
            )
        return "head_bucket + versioning + lifecycle + object-lock all ok"

    return await asyncio.to_thread(_probe)


async def _check_storage() -> str:
    from app.core.config import get_settings
    from app.core.storage import LocalStorage, S3Storage, get_storage

    s = get_settings()
    backend = get_storage()
    if isinstance(backend, LocalStorage):
        if s.is_production:
            raise RuntimeError("stub storage backend active in production")
        return "local stub (development)"
    assert isinstance(backend, S3Storage)
    # Prove the credentials actually work against the real R2 endpoint, not
    # just that they're present — a presigned URL alone never touches the
    # network (it's local signing), so it can't catch a bad key or a wrong
    # bucket the way HeadBucket can.
    probe = await _r2_probe(backend._client, s.object_store_media_bucket)
    return f"r2: {s.object_store_media_bucket} ({probe})"


async def _check_archive() -> str:
    from app.core.config import get_settings
    from app.core.storage import LocalArchiveStore, S3ArchiveStore, get_archive_store

    s = get_settings()
    backend = get_archive_store()
    if isinstance(backend, LocalArchiveStore):
        if s.is_production:
            raise RuntimeError("stub archive backend active in production")
        return "local stub (development)"
    assert isinstance(backend, S3ArchiveStore)
    probe = await _archive_probe(backend._client, s.archive_store_bucket)
    return f"aws: {s.archive_store_bucket} ({probe})"


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


async def _check_email() -> str:
    from app.core.config import get_settings
    from app.core.email import RESEND_API_HOST

    s = get_settings()
    if not s.email_is_live:
        if s.is_production:
            raise RuntimeError("console email backend active in production")
        if s.email_transport == "resend_api":
            raise RuntimeError("EMAIL_TRANSPORT=resend_api needs RESEND_API_KEY and SMTP_FROM_EMAIL")
        return "console (development)"
    if s.email_transport == "resend_api":
        return f"resend_api: {RESEND_API_HOST}"
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


async def _check_apple_revocation() -> str:
    """Apple revocation config, no network call. `production_preflight` covers
    production at Settings construction; this also covers staging."""
    from app.core.config import get_settings

    s = get_settings()
    if not s.oauth_apple_enabled:
        return "not required (OAUTH_APPLE_ENABLED is false)"
    problems = s._apple_revocation_problems()
    if problems:
        raise RuntimeError("; ".join(problems))
    return "http"


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
        _check("archive", _check_archive()),
        _check("cdn", _check_cdn()),
        _check("stream", _check_stream()),
        _check("apple", _check_apple_revocation()),
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
