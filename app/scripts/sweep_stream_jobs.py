"""Reconcile Cloudflare Stream ingests that a webhook never resolved, and
retry ingests whose initial kickoff never produced a uid.

A missed webhook (provider outage, network blip) must not leave a sermon's
video permanently un-ingested. Run on a schedule (hourly is plenty, matching
sweep_uploads.py):

    uv run python -m app.scripts.sweep_stream_jobs
"""
import asyncio

from app.db.database import PrimarySession
from app.services.media_service import sweep_stream_jobs


async def _run() -> None:
    async with PrimarySession() as db:
        count = await sweep_stream_jobs(db)
    print(f"[+] Reconciled {count} Stream ingest job(s).")


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
