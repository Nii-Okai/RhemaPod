"""One-shot: queue English + French captions for every Stream video that was
ingested before captions existed. Dry run by default.

    uv run python -m app.scripts.backfill_captions              # dry run
    uv run python -m app.scripts.backfill_captions --execute    # queue them

Queuing only creates the caption rows; the captions scheduler (or
sweep_captions) then asks Stream to transcribe each one and translates the
results, a few minutes per video.
"""
import argparse
import asyncio

from app.db.database import PrimarySession
from app.services.captions_service import backfill_captions


async def _run(execute: bool) -> None:
    async with PrimarySession() as db:
        count = await backfill_captions(db, execute=execute)
    verb = "Queued" if execute else "Would queue"
    print(f"[+] {verb} captions for {count} video(s).")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    asyncio.run(_run(args.execute))


if __name__ == "__main__":
    main()
