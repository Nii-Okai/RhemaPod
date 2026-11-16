"""Advance video captions once: poll Stream for English tracks still being
generated, and translate finished English tracks into French.

The API runs this automatically when CAPTIONS_SCHEDULER_ENABLED is true.
Otherwise run it on a schedule (every few minutes):

    uv run python -m app.scripts.sweep_captions
"""
import asyncio

from app.db.database import PrimarySession
from app.services.captions_service import advance_captions


async def _run() -> None:
    async with PrimarySession() as db:
        count = await advance_captions(db)
    if count is None:
        print("[=] Another instance is already advancing captions.")
    else:
        print(f"[+] Advanced captions on {count} video(s).")


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
