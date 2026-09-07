"""Sweep lapsed subscriptions.

Webhooks can be missed — provider incident, our downtime, a bad deploy. This is
the safety net that stops a lapsed subscription granting access forever. Run it
on a schedule (cron / systemd timer / scheduled task), e.g. hourly:

    uv run python -m app.scripts.expire_subscriptions
"""
import asyncio

from app.db.database import PrimarySession
from app.services.subscription_service import expire_lapsed


async def _run() -> None:
    async with PrimarySession() as db:
        count = await expire_lapsed(db)
    print(f"[+] Expired {count} lapsed subscription(s).")


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
