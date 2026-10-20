"""Church settings: the singleton profile row and the content the mobile app
reads (plan-admin-settings §A.4.3/§A.5, step S12).

* `get_public` serves `GET /settings/public` through Redis cache-aside
  (`settings:public:v1`, 300s). Redis being down only costs a DB read.
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

from app.core.logging import get_logger
from app.core.redis import cache_aside, get_redis
from app.models.content_schemas import (
    ChurchSettingsAdmin,
    ChurchSettingsPublic,
    ChurchSettingsUpdate,
)
from app.models.models import AuditAction, AuditOutcome, ChurchSettings, User
from app.services import audit_service
from app.services.audit_service import AuditContext, AuditTarget
from app.services.content_service import ContentError

log = get_logger("settings")

PUBLIC_CACHE_KEY = "settings:public:v1"
PUBLIC_CACHE_TTL = 300
_SETTINGS_ID = 1
_DELETED_ACCOUNT = "Deleted account"


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
        return ChurchSettingsPublic.model_validate(row).model_dump(mode="json")

    return await cache_aside(PUBLIC_CACHE_KEY, PUBLIC_CACHE_TTL, _source)


async def get_admin(db: AsyncSession) -> ChurchSettingsAdmin:
    row = await _load(db)
    return await _to_admin(db, row)


async def _to_admin(db: AsyncSession, row: ChurchSettings) -> ChurchSettingsAdmin:
    updated_by: str | None = None
    if row.updated_by_id is not None:
        email = (
            await db.execute(select(User.email).where(User.id == row.updated_by_id))
        ).scalar_one_or_none()
        updated_by = email or _DELETED_ACCOUNT
    public = ChurchSettingsPublic.model_validate(row).model_dump()
    return ChurchSettingsAdmin(**public, updated_at=row.updated_at, updated_by=updated_by)


async def invalidate_public_cache() -> None:
    try:
        await get_redis().delete(PUBLIC_CACHE_KEY)
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
    """Weak validator from the row version (§A.5): any edit bumps it."""
    return f'W/"{version}"'


def etag_matches(if_none_match: str | None, version: int) -> bool:
    """RFC 9110 weak comparison against an `If-None-Match` list."""
    if not if_none_match:
        return False
    if if_none_match.strip() == "*":
        return True
    wanted = f'"{version}"'
    for candidate in if_none_match.split(","):
        tag = candidate.strip()
        if tag.startswith("W/"):
            tag = tag[2:]
        if tag == wanted:
            return True
    return False

