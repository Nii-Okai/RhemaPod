"""Enforce `audit_log` retention (`plans/plan-admin-settings.md` §A.7, the
values Isaac approved at AS0).

Two independent, age-based rules, both keyed off `created_at`:

* `auth.*` rows are hard-**deleted** once older than
  `settings.audit_auth_retention_days` (365 by default) — these carry the
  most directly-identifying personal data (`ip`/`user_agent` on every
  login), and nobody needs a login record from over a year ago.
* Every other `audit_log` row **keeps its row** (the who/what/when of a
  role change, a settings edit, a report export stays forever — that's
  the point of an audit trail) but has `ip`/`user_agent` **nulled** once
  older than `settings.audit_network_retention_days` (365 by default): the
  network identifier goes, the decision trail doesn't.

`listener_day` is explicitly out of this script's scope — §A.7 keeps it
indefinitely, no purge in this step.

Run on a schedule (daily is plenty):

    uv run python -m app.scripts.purge_audit_log

The cutoff is strict, matching `purge_comment_snapshots.py`: a row exactly
at the boundary age is kept until the next run. Only counts are logged,
never audit row contents (emails, IPs, details).
"""

import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.db.database import PrimarySession
from app.models.models import AuditLog

log = get_logger("audit_purge")


async def purge_audit_log(db: AsyncSession, now: datetime | None = None) -> tuple[int, int]:
    """Delete expired `auth.*` rows and null `ip`/`user_agent` on expired
    non-`auth.*` rows. Returns `(deleted, nulled)`. `now` is injectable for
    tests."""
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
            ~AuditLog.action.like("auth.%"),
            AuditLog.created_at < network_cutoff,
            (AuditLog.ip.is_not(None)) | (AuditLog.user_agent.is_not(None)),
        )
        .values(ip=None, user_agent=None)
    )
    await db.commit()
    return deleted_result.rowcount, nulled_result.rowcount


async def _run() -> None:
    async with PrimarySession() as db:
        deleted, nulled = await purge_audit_log(db)
    log.info("audit_log_purged", deleted=deleted, nulled=nulled)
    print(
        f"[+] Deleted {deleted} auth audit row(s); "
        f"nulled ip/user_agent on {nulled} row(s)."
    )


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
