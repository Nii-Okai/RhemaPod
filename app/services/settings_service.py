"""Church settings: the singleton profile row and the content the mobile app
reads (plan-admin-settings §A.4.3/§A.5, step S12).

* `get_public` serves `GET /settings/public` through Redis cache-aside
  (`settings:public:v2:<guidelines digest>`, 300s). The comment guidelines
  are the static file `app/content/comment_guidelines.txt`, not a row
  column; the digest in the key and the ETag means a deploy that changes the
  text never serves a body cached or validated under the old one.
  Redis being down only costs a DB read.
* `update` is the one writer. It is optimistic: the caller sends the
  `version` it loaded, the write is `UPDATE ... WHERE version = :v`, and
  zero rows updated is a 409. The `settings.updated` audit row is in the
  same transaction, so a failed audit insert rolls the change back. The
  public cache key is deleted after commit; if that delete fails, the TTL
  bounds how long the old value is served (same posture as
  `content_service.invalidate_catalog_cache`).
"""
from __future__ import annotations

from sqlalchemy import func, select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app import content
from app.core.logging import get_logger
from app.core.redis import cache_aside, get_redis
from app.models.content_schemas import (
    ChurchSettingsAdmin,
    ChurchSettingsPublic,
    ChurchSettingsUpdate,
)
from app.models.models import AuditAction, AuditOutcome, ChurchSettings, User
from app.core.config import get_settings
from app.services import audit_service, content_service
from app.services.audit_service import AuditContext, AuditTarget
from app.services.content_service import ContentError

log = get_logger("settings")

PUBLIC_CACHE_TTL = 300
_SETTINGS_ID = 1
_DELETED_ACCOUNT = "Deleted account"


def public_cache_key() -> str:
    return f"settings:public:v2:{content.COMMENT_GUIDELINES_DIGEST}"


async def _load(db: AsyncSession) -> ChurchSettings:
    row = await db.get(ChurchSettings, _SETTINGS_ID)
    if row is None:
        # The migration seeds this row; missing means the database was never
        # migrated (or someone deleted it by hand). Fail loudly, not with 404.
        log.error("church_settings_missing")
        raise ContentError("Church settings are not initialised.", status_code=503)
    return row


async def get_public(db: AsyncSession) -> dict:
    """The public DTO as a JSON-ready dict, from cache when possible."""

    async def _source() -> dict:
        row = await _load(db)
        return _to_public(row).model_dump(mode="json")

    return await cache_aside(public_cache_key(), PUBLIC_CACHE_TTL, _source)


async def get_admin(db: AsyncSession) -> ChurchSettingsAdmin:
    row = await _load(db)
    return await _to_admin(db, row)


def _to_public(row: ChurchSettings) -> ChurchSettingsPublic:
    # `comment_guidelines` is not a column; it comes from the static file.
    fields = {
        name: getattr(row, name)
        for name in ChurchSettingsPublic.model_fields
        if name not in ("comment_guidelines", "sign_in_image_url")
    }
    public = ChurchSettingsPublic(
        **fields, comment_guidelines=content.COMMENT_GUIDELINES
    )
    public.sign_in_image_url = content_service._thumbnail_url(row.sign_in_image_key)
    return public


async def _to_admin(db: AsyncSession, row: ChurchSettings) -> ChurchSettingsAdmin:
    updated_by: str | None = None
    if row.updated_by_id is not None:
        email = (
            await db.execute(select(User.email).where(User.id == row.updated_by_id))
        ).scalar_one_or_none()
        updated_by = email or _DELETED_ACCOUNT
    public = _to_public(row).model_dump()
    return ChurchSettingsAdmin(**public, updated_at=row.updated_at, updated_by=updated_by)


async def invalidate_public_cache() -> None:
    try:
        await get_redis().delete(public_cache_key())
    except Exception:
        log.warning("settings_cache_invalidation_failed")


def _stale() -> ContentError:
    return ContentError(
        "These settings were changed by someone else since you loaded them. "
        "Reload to see the latest version, then reapply your edits.",
        status_code=409,
    )


async def update(
    db: AsyncSession,
    data: ChurchSettingsUpdate,
    actor: User,
    ctx: AuditContext,
) -> ChurchSettingsAdmin:
    """Apply a partial update guarded by `data.version`.

    Only fields whose value actually changes are written and audited. A
    request that changes nothing (but carries the current version) is a
    no-op: no version bump, no audit row. A stale version is a 409 either
    way, so a no-op can't hide that the editor's view is out of date.
    """
    row = await _load(db)
    if row.version != data.version:
        raise _stale()

    before: dict[str, str | None] = {}
    after: dict[str, str | None] = {}
    for name, value in data.changes().items():
        current = getattr(row, name)
        if current != value:
            before[name] = current
            after[name] = value

    if not after:
        return await _to_admin(db, row)

    # The version re-check here is what actually decides a race: two editors
    # can both pass the read above, but only one UPDATE matches.
    result = await db.execute(
        sa_update(ChurchSettings)
        .where(ChurchSettings.id == _SETTINGS_ID, ChurchSettings.version == data.version)
        .values(
            **after,
            version=ChurchSettings.version + 1,
            updated_at=func.now(),
            updated_by_id=actor.id,
        )
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:
        await db.rollback()
        raise _stale()

    changed = sorted(after)
    await audit_service.record(
        db, AuditAction.SETTINGS_UPDATED,
        actor=actor,
        target=AuditTarget(type="church_settings", id=None, label="Church settings"),
        details={"changed": changed, "before": before, "after": after},
        outcome=AuditOutcome.SUCCESS, ctx=ctx,
    )
    await db.commit()
    await invalidate_public_cache()

    await db.refresh(row)
    log.info(
        "church_settings_updated",
        by=str(actor.id),
        changed=changed,
        version=row.version,
    )
    return await _to_admin(db, row)


def etag_for(version: int) -> str:
    """Weak validator (§A.5): the row version, which any edit bumps, plus the
    guidelines digest, which changes when a deploy changes the file text.
    Opaque to clients."""
    return f'W/"{version}-{content.COMMENT_GUIDELINES_DIGEST}"'


def etag_matches(if_none_match: str | None, version: int) -> bool:
    """RFC 9110 weak comparison against an `If-None-Match` list."""
    if not if_none_match:
        return False
    if if_none_match.strip() == "*":
        return True
    wanted = f'"{version}-{content.COMMENT_GUIDELINES_DIGEST}"'
    for candidate in if_none_match.split(","):
        tag = candidate.strip()
        if tag.startswith("W/"):
            tag = tag[2:]
        if tag == wanted:
            return True
    return False



# ── Sign-in screen image ──────────────────────────────────────────────────────
# The photo beside the admin portal's sign-in form. Same direct-to-storage
# upload as a series cover: a pre-signed PUT, then a confirm that checks the
# object landed, is under the image size limit and sits under this prefix.
# Saving it bumps `version` (it is part of the public body, so the ETag must
# change) and writes a `settings.updated` audit row.

SIGN_IN_IMAGE_PREFIX = "branding/sign-in/"


def sign_in_image_ticket(filename: str, content_type: str) -> dict:
    import uuid

    from app.core import storage as storage_module

    content_service._validate_image_type(content_type)
    cfg = get_settings()
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
    if not suffix.isalnum() or len(suffix) > 5:
        suffix = "jpg"
    key = f"{SIGN_IN_IMAGE_PREFIX}{uuid.uuid4()}.{suffix}"
    url = storage_module.get_storage().presigned_upload_url(
        cfg.object_store_media_bucket, key, content_type, cfg.upload_url_expire_seconds,
    )
    return {
        "upload_url": url,
        "headers": {"Content-Type": content_type},
        "expires_in": cfg.upload_url_expire_seconds,
        "thumbnail_key": key,
    }


async def set_sign_in_image(
    db: AsyncSession, key: str | None, actor: User, ctx: AuditContext
) -> ChurchSettingsAdmin:
    """Attach an uploaded sign-in image (`key`), or go back to the built-in
    artwork (`None`)."""
    from app.core import storage as storage_module

    cfg = get_settings()
    if key is not None:
        if not key.startswith(SIGN_IN_IMAGE_PREFIX) or "/" in key[len(SIGN_IN_IMAGE_PREFIX):]:
            raise ContentError("That image key isn't a sign-in image.", status_code=400)
        store = storage_module.get_storage()
        if not store.object_exists(cfg.object_store_media_bucket, key):
            raise ContentError(
                "No uploaded image found — complete the upload first.", status_code=409
            )
        size = store.object_size(cfg.object_store_media_bucket, key)
        if size is not None and size > cfg.max_thumbnail_bytes:
            try:
                store.delete_object(cfg.object_store_media_bucket, key)
            except Exception:  # noqa: BLE001 - best-effort cleanup, still reject
                log.warning("oversize_sign_in_image_cleanup_failed", key=key)
            raise ContentError(
                f"The image is larger than the "
                f"{cfg.max_thumbnail_bytes // (1024 * 1024)} MB limit.",
                status_code=413,
            )

    row = await _load(db)
    if row.sign_in_image_key == key:
        return await _to_admin(db, row)

    before = row.sign_in_image_key
    await db.execute(
        sa_update(ChurchSettings)
        .where(ChurchSettings.id == _SETTINGS_ID)
        .values(
            sign_in_image_key=key,
            version=ChurchSettings.version + 1,
            updated_at=func.now(),
            updated_by_id=actor.id,
        )
        .execution_options(synchronize_session=False)
    )
    await audit_service.record(
        db, AuditAction.SETTINGS_UPDATED,
        actor=actor,
        target=AuditTarget(type="church_settings", id=None, label="Church settings"),
        details={
            "changed": ["sign_in_image"],
            "before": {"sign_in_image": before},
            "after": {"sign_in_image": key},
        },
        outcome=AuditOutcome.SUCCESS, ctx=ctx,
    )
    await db.commit()
    await invalidate_public_cache()
    await db.refresh(row)
    log.info("sign_in_image_updated", by=str(actor.id), removed=key is None)
    return await _to_admin(db, row)
