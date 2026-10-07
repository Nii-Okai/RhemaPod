"""Null `body_snapshot` on moderation-log rows older than 90 days.

A hard delete keeps the removed text in `comment_moderation_log.body_snapshot`
so a moderator's decision can be reviewed. The text is not kept forever: this
job clears it, leaving the log row itself (action, reason, ids, timestamp) in
place. Run on a schedule (daily is plenty):

    uv run python -m app.scripts.purge_comment_snapshots

The cutoff is strict: a snapshot exactly 90 days old is kept until the next
run. Only counts are logged, never snapshot text.
"""

import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.database import PrimarySession
from app.models.models import CommentModerationLog

log = get_logger("comment_snapshot_purge")

SNAPSHOT_RETENTION = timedelta(days=90)


async def purge_snapshots(db: AsyncSession, now: datetime | None = None) -> int:
    """Null every snapshot with `created_at < now - 90 days`; return how many
    rows were cleared. `now` is injectable for tests."""
    cutoff = (now or datetime.now(UTC)) - SNAPSHOT_RETENTION
    result = await db.execute(
        update(CommentModerationLog)
        .where(
            CommentModerationLog.body_snapshot.is_not(None),
            CommentModerationLog.created_at < cutoff,
        )
        .values(body_snapshot=None)
    )
    await db.commit()
    return result.rowcount


async def _run() -> None:
    async with PrimarySession() as db:
        purged = await purge_snapshots(db)
    log.info("comment_snapshots_purged", purged=purged)
    print(f"[+] Purged {purged} comment snapshot(s).")


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
