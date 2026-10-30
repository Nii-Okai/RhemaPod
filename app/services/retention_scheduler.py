"""In-process daily retention task (plan AD5 §A.3).

One asyncio loop started from the FastAPI lifespan when
`RETENTION_SCHEDULER_ENABLED` is true. It runs `run_retention_once`, which is
advisory-lock guarded, so several instances running this loop do the work once.
A failed run is logged (exception type only) and never takes the API down.
Deployed environments on a real scheduler leave the flag off and run the CLI.
"""
from __future__ import annotations

import asyncio
import random
import time

from app.core.logging import get_logger
from app.db.database import PrimarySession
from app.services.retention_service import run_retention_once

log = get_logger("retention_scheduler")

INITIAL_DELAY_SECONDS = 60.0
INITIAL_JITTER_SECONDS = 30.0
INTERVAL_SECONDS = 24 * 60 * 60.0


async def _run_once_logged() -> None:
    started = time.monotonic()
    try:
        async with PrimarySession() as db:
            result = await run_retention_once(db)
    except Exception as exc:  # noqa: BLE001 - the loop must survive any failure
        log.error("retention_run_failed", error_type=type(exc).__name__)
        return
    if result.skipped:
        log.info("retention_run", skipped=True)
        return
    log.info(
        "retention_run",
        audit_deleted=result.audit_deleted,
        audit_network_nulled=result.audit_network_nulled,
        snapshots_nulled=result.snapshots_nulled,
        duration_ms=int((time.monotonic() - started) * 1000),
    )


async def retention_loop() -> None:
    await asyncio.sleep(INITIAL_DELAY_SECONDS + random.uniform(0, INITIAL_JITTER_SECONDS))
    while True:
        await _run_once_logged()
        await asyncio.sleep(INTERVAL_SECONDS)


def start_retention_scheduler() -> asyncio.Task[None]:
    return asyncio.create_task(retention_loop(), name="retention-scheduler")


async def stop_retention_scheduler(task: asyncio.Task[None]) -> None:
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
