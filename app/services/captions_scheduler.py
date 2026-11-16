"""In-process loop that advances video captions (captions_service).

Cloudflare Stream sends no webhook when generated captions finish, so
something has to poll. Started from the FastAPI lifespan when
`CAPTIONS_SCHEDULER_ENABLED` is true; same shape as retention_scheduler.
`advance_captions` takes a Postgres advisory lock, so several instances
running this loop don't duplicate work. A failed pass is logged and never
takes the API down. Deployed environments on a real scheduler leave the flag
off and run `python -m app.scripts.sweep_captions` instead.
"""
from __future__ import annotations

import asyncio
import random
from collections.abc import Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.database import PrimarySession
from app.services.captions_service import advance_captions

log = get_logger("captions_scheduler")

INITIAL_DELAY_SECONDS = 45.0
INITIAL_JITTER_SECONDS = 15.0
# Stream transcribes a 45-minute sermon in a few minutes; a 2-minute poll
# keeps "ready" close to real time at a negligible request cost (one list
# call per in-flight video).
INTERVAL_SECONDS = 120.0

SessionFactory = Callable[[], AsyncSession]


async def run_captions_once(session_factory: SessionFactory = PrimarySession) -> int | None:
    try:
        async with session_factory() as db:
            return await advance_captions(db)
    except Exception as exc:  # noqa: BLE001 - the loop must survive any failure
        log.error("captions_run_failed", error_type=type(exc).__name__)
        return None


async def captions_loop(session_factory: SessionFactory = PrimarySession) -> None:
    await asyncio.sleep(INITIAL_DELAY_SECONDS + random.uniform(0, INITIAL_JITTER_SECONDS))
    while True:
        await run_captions_once(session_factory)
        await asyncio.sleep(INTERVAL_SECONDS)


def start_captions_scheduler(
    session_factory: SessionFactory = PrimarySession,
) -> asyncio.Task[None]:
    return asyncio.create_task(captions_loop(session_factory), name="captions-scheduler")


async def stop_captions_scheduler(task: asyncio.Task[None]) -> None:
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
