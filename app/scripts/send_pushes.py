"""Announce newly visible sermons by push notification, once.

The API runs this automatically when PUSH_SCHEDULER_ENABLED is true.
Otherwise run it on a schedule (every minute or two):

    uv run python -m app.scripts.send_pushes
"""
import asyncio

from app.db.database import PrimarySession
from app.services.push_service import announce_new_sermons


async def _run() -> None:
    async with PrimarySession() as db:
        result = await announce_new_sermons(db)
    if result is None:
        print("[=] Another instance is already sending pushes.")
    else:
        print(f"[+] Announced {result.sermons} sermon(s); {result.sent} push(es) accepted.")


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
