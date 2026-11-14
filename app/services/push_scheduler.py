"""In-process loop that announces newly visible sermons (push_service).

Started from the FastAPI lifespan when `PUSH_SCHEDULER_ENABLED` is true; same
shape as captions_scheduler. `announce_new_sermons` takes a Postgres advisory
lock, so several instances never double-send. A failed pass is logged and never
takes the API down. Deployments with a real scheduler leave the flag off and
run `python -m app.scripts.send_pushes` every minute or two instead.
"""
from __future__ import annotations

import asyncio
import random
from collections.abc import Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.database import PrimarySession
from app.services.push_service import PushPassResult, announce_new_sermons

log = get_logger("push_scheduler")

INITIAL_DELAY_SECONDS = 30.0
INITIAL_JITTER_SECONDS = 15.0
# A sermon scheduled for 09:00 should reach phones within a minute or so.
INTERVAL_SECONDS = 60.0

SessionFactory = Callable[[], AsyncSession]


async def run_push_once(session_factory: SessionFactory = PrimarySession) -> PushPassResult | None:
    try:
        async with session_factory() as db:
            return await announce_new_sermons(db)
    except Exception as exc:  # noqa: BLE001 - the loop must survive any failure
        log.error("push_run_failed", error_type=type(exc).__name__)
        return None


async def push_loop(session_factory: SessionFactory = PrimarySession) -> None:
    await asyncio.sleep(INITIAL_DELAY_SECONDS + random.uniform(0, INITIAL_JITTER_SECONDS))
    while True:
        await run_push_once(session_factory)
        await asyncio.sleep(INTERVAL_SECONDS)


def start_push_scheduler(session_factory: SessionFactory = PrimarySession) -> asyncio.Task[None]:
    return asyncio.create_task(push_loop(session_factory), name="push-scheduler")


async def stop_push_scheduler(task: asyncio.Task[None]) -> None:
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
