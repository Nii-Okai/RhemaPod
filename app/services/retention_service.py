"""Data-retention purges (ADR 0018 addendum 2026-10-30; plan-ad5 §A).

Three age-based rules, all keyed off `created_at` with a strict cutoff (a row
exactly at the boundary age is kept until the next run):

* `audit_log` `auth.*` rows are hard-**deleted** past
  `settings.audit_auth_retention_days` (365 by default).
* **Every** `audit_log` row (`auth.*` included, until the delete above takes
  it) keeps its row but has `ip`/`user_agent` **nulled** past
  `settings.audit_network_retention_days` (30 by default).
* `comment_moderation_log.body_snapshot` is nulled past 90 days.

The purge functions execute but do not commit, so `run_retention_once` can run
all of them in one transaction under a Postgres advisory lock. Callers (the CLI
wrappers in `app/scripts/`, the in-process scheduler) own the commit. Only
counts are ever logged, never row contents.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.models import AuditLog, CommentModerationLog

log = get_logger("retention")

SNAPSHOT_RETENTION = timedelta(days=90)

# Fixed key for `pg_try_advisory_xact_lock`: whichever instance holds it runs
# the purges, the rest skip. Arbitrary but stable ("RETENTION" in hex-ish).
RETENTION_ADVISORY_LOCK_KEY = 0x5245_5445_4E54_494F


class RetentionError(Exception):
    """A retention run failed at `step` (`lock`, `audit_purge`,
    `snapshot_purge` or `commit`). The original error is `__cause__`; its
    message is never copied here because SQLAlchemy messages embed bound
    parameters (audit row contents)."""

    def __init__(self, step: str) -> None:
        super().__init__(f"retention step failed: {step}")
        self.step = step


@dataclass(frozen=True)
class RetentionResult:
    skipped: bool = False
    audit_deleted: int = 0
    audit_network_nulled: int = 0
    snapshots_nulled: int = 0


async def purge_audit_log(db: AsyncSession, now: datetime | None = None) -> tuple[int, int]:
    """Delete expired `auth.*` rows, then null `ip`/`user_agent` on every
    remaining row past the network window. Returns `(deleted, nulled)`. Does
    not commit. `now` is injectable for tests."""
    settings = get_settings()
    now = now or datetime.now(UTC)
    auth_cutoff = now - timedelta(days=settings.audit_auth_retention_days)
    network_cutoff = now - timedelta(days=settings.audit_network_retention_days)

    deleted_result = await db.execute(
        delete(AuditLog).where(
            AuditLog.action.like("auth.%"),
            AuditLog.created_at < auth_cutoff,
        )
    )
    nulled_result = await db.execute(
        update(AuditLog)
        .where(
            AuditLog.created_at < network_cutoff,
            (AuditLog.ip.is_not(None)) | (AuditLog.user_agent.is_not(None)),
        )
        .values(ip=None, user_agent=None)
    )
    return deleted_result.rowcount, nulled_result.rowcount


async def purge_snapshots(db: AsyncSession, now: datetime | None = None) -> int:
    """Null every moderation-log snapshot with `created_at < now - 90 days`;
    return how many rows were cleared. Does not commit."""
    cutoff = (now or datetime.now(UTC)) - SNAPSHOT_RETENTION
    result = await db.execute(
        update(CommentModerationLog)
        .where(
            CommentModerationLog.body_snapshot.is_not(None),
            CommentModerationLog.created_at < cutoff,
        )
        .values(body_snapshot=None)
    )
    return result.rowcount


async def run_retention_once(db: AsyncSession, now: datetime | None = None) -> RetentionResult:
    """Run every purge in one transaction, guarded by a Postgres advisory lock
    so only one instance does the work. If the lock is held elsewhere, change
    nothing and return `skipped=True`. Commits on success; on error rolls back
    and raises `RetentionError(step)` chained to the original."""
    step = "lock"
    try:
        got_lock = (
            await db.execute(select(func.pg_try_advisory_xact_lock(RETENTION_ADVISORY_LOCK_KEY)))
        ).scalar_one()
        if not got_lock:
            await db.rollback()
            return RetentionResult(skipped=True)
        step = "audit_purge"
        deleted, nulled = await purge_audit_log(db, now)
        step = "snapshot_purge"
        snapshots = await purge_snapshots(db, now)
        step = "commit"
        await db.commit()
    except Exception as exc:
        await db.rollback()
        raise RetentionError(step) from exc
    except BaseException:
        # Cancellation / shutdown: roll back (releases the xact lock) and let
        # it propagate untouched.
        await db.rollback()
        raise
    return RetentionResult(
        audit_deleted=deleted, audit_network_nulled=nulled, snapshots_nulled=snapshots
    )
