"""CLI wrapper: enforce `audit_log` retention once (logic lives in
`app/services/retention_service.py`; see ADR 0018 and its 2026-10-30
addendum).

* `auth.*` rows are hard-**deleted** once older than
  `settings.audit_auth_retention_days` (365 by default).
* Every `audit_log` row keeps its row (who/what/when of a role change, a
  settings edit, a report export stays; that's the point of an audit trail)
  but has `ip`/`user_agent` **nulled** once older than
  `settings.audit_network_retention_days` (30 by default), `auth.*` included.

`listener_day` is out of scope: it is kept indefinitely.

Runs in-process daily when `RETENTION_SCHEDULER_ENABLED=true`; this script is
for manual runs and for deployments that schedule it externally:

    uv run python -m app.scripts.purge_audit_log

The cutoff is strict: a row exactly at the boundary age is kept until the next
run. Only counts are logged, never audit row contents (emails, IPs, details).
"""

import asyncio

from app.core.logging import get_logger
from app.db.database import PrimarySession
from app.services.retention_service import run_retention_once

log = get_logger("audit_purge")


async def _run() -> None:
    # Same advisory-locked, single-transaction path as the in-process
    # scheduler, so a cron run and the loop never double-run. It also covers
    # the comment-snapshot purge; both are idempotent.
    async with PrimarySession() as db:
        result = await run_retention_once(db)
    if result.skipped:
        log.info("audit_log_purge_skipped")
        print("[-] Skipped: another retention run holds the lock.")
        return
    log.info(
        "audit_log_purged",
        deleted=result.audit_deleted,
        nulled=result.audit_network_nulled,
    )
    print(
        f"[+] Deleted {result.audit_deleted} auth audit row(s); "
        f"nulled ip/user_agent on {result.audit_network_nulled} row(s)."
    )


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
