"""CLI wrapper: null `body_snapshot` on moderation-log rows older than 90 days
(logic lives in `app/services/retention_service.py`).

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
from app.services.retention_service import purge_snapshots

log = get_logger("comment_snapshot_purge")


async def _run() -> None:
    async with PrimarySession() as db:
        purged = await purge_snapshots(db)
        await db.commit()
    log.info("comment_snapshots_purged", purged=purged)
    print(f"[+] Purged {purged} comment snapshot(s).")


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
