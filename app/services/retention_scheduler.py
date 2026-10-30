"""In-process daily retention task (plan AD5 §A.3).

One asyncio loop started from the FastAPI lifespan when
`RETENTION_SCHEDULER_ENABLED` is true. It runs `run_retention_once`, which is
advisory-lock guarded, so several instances running this loop do the work once.
A failed run is logged (step + exception/DB error class + SQLSTATE, never the
message) and never takes the API down. A skipped run (lock held elsewhere) is
retried once after `SKIP_RETRY_SECONDS`. After `NOT_RUNNING_THRESHOLD`
consecutive skipped/failed runs the loop logs `retention_not_running`.
Deployed environments on a real scheduler leave the flag off and run the CLI.
"""
from __future__ import annotations

import asyncio
import enum
import random
import time
from collections.abc import Callable

from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.database import PrimarySession
from app.services.retention_service import RetentionError, run_retention_once

log = get_logger("retention_scheduler")

INITIAL_DELAY_SECONDS = 60.0
INITIAL_JITTER_SECONDS = 30.0
INTERVAL_SECONDS = 24 * 60 * 60.0
SKIP_RETRY_SECONDS = 5 * 60.0
NOT_RUNNING_THRESHOLD = 3

SessionFactory = Callable[[], AsyncSession]


class RunOutcome(enum.Enum):
    OK = "ok"
    SKIPPED = "skipped"
    FAILED = "failed"


def _failure_fields(exc: Exception) -> dict[str, str | None]:
    """Structured, message-free description of a failed run."""
    step = "unknown"
    cause: BaseException = exc
    if isinstance(exc, RetentionError):
        step = exc.step
        cause = exc.__cause__ or exc
    fields: dict[str, str | None] = {"step": step, "error_type": type(cause).__name__}
    if isinstance(cause, DBAPIError) and cause.orig is not None:
        orig = cause.orig
        fields["db_error_type"] = type(orig).__name__
        fields["sqlstate"] = getattr(orig, "sqlstate", None) or getattr(orig, "pgcode", None)
    return fields


async def _run_once_logged(session_factory: SessionFactory) -> RunOutcome:
    started = time.monotonic()
    try:
        async with session_factory() as db:
            result = await run_retention_once(db)
    except Exception as exc:  # noqa: BLE001 - the loop must survive any failure
        log.error("retention_run_failed", **_failure_fields(exc))
        return RunOutcome.FAILED
    if result.skipped:
        log.info("retention_run", skipped=True)
        return RunOutcome.SKIPPED
    log.info(
        "retention_run",
        audit_deleted=result.audit_deleted,
        audit_network_nulled=result.audit_network_nulled,
        snapshots_nulled=result.snapshots_nulled,
        duration_ms=int((time.monotonic() - started) * 1000),
    )
    return RunOutcome.OK


async def retention_loop(session_factory: SessionFactory = PrimarySession) -> None:
    await asyncio.sleep(INITIAL_DELAY_SECONDS + random.uniform(0, INITIAL_JITTER_SECONDS))
    consecutive_bad = 0
    while True:
        outcome = await _run_once_logged(session_factory)
        if outcome is RunOutcome.SKIPPED:
            # Another instance held the lock; try once more shortly rather
            # than waiting a full day.
            await asyncio.sleep(SKIP_RETRY_SECONDS)
            outcome = await _run_once_logged(session_factory)
        if outcome is RunOutcome.OK:
            consecutive_bad = 0
        else:
            consecutive_bad += 1
            if consecutive_bad >= NOT_RUNNING_THRESHOLD:
                log.warning("retention_not_running", consecutive_runs=consecutive_bad)
        await asyncio.sleep(INTERVAL_SECONDS)


def start_retention_scheduler(
    session_factory: SessionFactory = PrimarySession,
) -> asyncio.Task[None]:
    return asyncio.create_task(retention_loop(session_factory), name="retention-scheduler")


async def stop_retention_scheduler(task: asyncio.Task[None]) -> None:
    """Cancel the loop and wait for it to unwind. The loop's own
    `CancelledError` is absorbed; if the *caller* is cancelled while waiting,
    that cancellation propagates (`gather` re-raises it)."""
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
