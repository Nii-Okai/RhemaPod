"""Sweep upload jobs that were never completed.

A browser tab closed mid-upload leaves a job stuck in `awaiting_upload`
forever. Run on a schedule (daily is plenty):

    uv run python -m app.scripts.sweep_uploads
"""
import asyncio

from app.db.database import PrimarySession
from app.services.media_service import sweep_stale_jobs


async def _run() -> None:
    async with PrimarySession() as db:
        count = await sweep_stale_jobs(db)
    print(f"[+] Swept {count} stale upload job(s).")


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
