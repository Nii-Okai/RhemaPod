"""CLI wrapper: null `body_snapshot` on moderation-log rows older than 90 days
(logic lives in `app/services/retention_service.py`; it runs the full
advisory-locked retention pass, so it is safe next to the in-process loop).

A hard delete keeps the removed text in `comment_moderation_log.body_snapshot`
so a moderator's decision can be reviewed. The text is not kept forever: this
job clears it, leaving the log row itself (action, reason, ids, timestamp) in
place. It also runs in-process daily when `RETENTION_SCHEDULER_ENABLED=true`;
run it by hand or from an external schedule otherwise:

    uv run python -m app.scripts.purge_comment_snapshots

The cutoff is strict: a snapshot exactly 90 days old is kept until the next
run. Only counts are logged, never snapshot text.
"""

import asyncio

from app.core.logging import get_logger
from app.db.database import PrimarySession
from app.services.retention_service import run_retention_once

log = get_logger("comment_snapshot_purge")


async def _run() -> None:
    # Same advisory-locked, single-transaction path as the in-process
    # scheduler, so a cron run and the loop never double-run. It also covers
    # the audit purge; both are idempotent.
    async with PrimarySession() as db:
        result = await run_retention_once(db)
    if result.skipped:
        log.info("comment_snapshots_purge_skipped")
        print("[-] Skipped: another retention run holds the lock.")
        return
    log.info("comment_snapshots_purged", purged=result.snapshots_nulled)
    print(f"[+] Purged {result.snapshots_nulled} comment snapshot(s).")


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
