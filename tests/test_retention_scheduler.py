"""In-process retention scheduler: lifespan wiring, a real run on Postgres,
failure survival and the count-only log shape. Real Postgres (Testcontainers);
the scheduler stays off everywhere else."""
from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from structlog.testing import capture_logs

import main
from app.models.models import AuditAction, AuditLog, AuditOutcome
from app.services import retention_scheduler
from app.services.retention_service import RETENTION_ADVISORY_LOCK_KEY

pytestmark = pytest.mark.asyncio


def _scheduler_tasks() -> list[asyncio.Task]:
    return [t for t in asyncio.all_tasks() if t.get_name() == "retention-scheduler"]


@pytest.fixture
def sessions(pg_client, pg_engine, monkeypatch):
    factory = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(retention_scheduler, "INITIAL_DELAY_SECONDS", 0.0)
    monkeypatch.setattr(retention_scheduler, "INITIAL_JITTER_SECONDS", 0.0)
    return factory


async def _old_audit_row(sessions) -> uuid.UUID:
    async with sessions() as s:
        row = AuditLog(
            action=AuditAction.LOGIN, outcome=AuditOutcome.SUCCESS,
            ip="203.0.113.7", user_agent="UA/1.0",
            created_at=datetime.now(UTC) - timedelta(days=40),
        )
        s.add(row)
        await s.commit()
        return row.id


async def test_flag_off_creates_no_task(monkeypatch):
    monkeypatch.setattr(main.settings, "retention_scheduler_enabled", False)
    async with main.lifespan(main.app):
        assert _scheduler_tasks() == []


async def test_flag_on_runs_once_and_shutdown_cancels(pg_engine, sessions, monkeypatch):
    row_id = await _old_audit_row(sessions)
    monkeypatch.setattr(main.settings, "retention_scheduler_enabled", True)
    monkeypatch.setattr(retention_scheduler, "INTERVAL_SECONDS", 3600.0)
    real_start = main.start_retention_scheduler
    monkeypatch.setattr(
        main,
        "start_retention_scheduler",
        lambda session_factory: real_start(session_factory=sessions),
    )
    async with main.lifespan(main.app):
        tasks = _scheduler_tasks()
        assert len(tasks) == 1
        for _ in range(100):
            async with sessions() as s:
                row = (await s.execute(select(AuditLog).where(AuditLog.id == row_id))).scalar_one()
            if row.ip is None:
                break
            await asyncio.sleep(0.05)
        assert row.ip is None and row.user_agent is None
    assert tasks[0].cancelled()
    assert _scheduler_tasks() == []


async def test_failed_run_is_logged_and_loop_survives(sessions, monkeypatch):
    calls = 0

    async def boom(db, now=None):
        nonlocal calls
        calls += 1
        raise RuntimeError("secret 203.0.113.7")

    monkeypatch.setattr(retention_scheduler, "run_retention_once", boom)
    monkeypatch.setattr(retention_scheduler, "INTERVAL_SECONDS", 0.01)
    with capture_logs() as logs:
        task = retention_scheduler.start_retention_scheduler(session_factory=sessions)
        for _ in range(100):
            if calls >= 2:
                break
            await asyncio.sleep(0.02)
        await retention_scheduler.stop_retention_scheduler(task)
    assert calls >= 2
    failed = [e for e in logs if e["event"] == "retention_run_failed"]
    assert failed and all(set(e) == {"event", "log_level", "step", "error_type"} for e in failed)
    assert failed[0]["error_type"] == "RuntimeError"
    assert failed[0]["step"] == "unknown"
    assert "203.0.113.7" not in repr(logs)


async def test_retention_run_log_holds_only_counts(sessions, monkeypatch):
    await _old_audit_row(sessions)
    monkeypatch.setattr(retention_scheduler, "INTERVAL_SECONDS", 3600.0)
    with capture_logs() as logs:
        task = retention_scheduler.start_retention_scheduler(session_factory=sessions)
        for _ in range(100):
            if any(e["event"] == "retention_run" for e in logs):
                break
            await asyncio.sleep(0.05)
        await retention_scheduler.stop_retention_scheduler(task)
    runs = [e for e in logs if e["event"] == "retention_run"]
    assert runs
    assert set(runs[0]) == {
        "event", "log_level", "audit_deleted", "audit_network_nulled",
        "snapshots_nulled", "duration_ms",
    }
    assert runs[0]["audit_network_nulled"] >= 1


async def test_db_failure_logs_step_and_sqlstate_without_message(sessions, monkeypatch):
    """A real Postgres error inside a purge step: the log carries the step,
    the driver class and SQLSTATE, and nothing from the message/params."""
    import app.services.retention_service as svc

    async def divide_by_zero(db, now=None):
        await db.execute(text("SELECT 1/0 AS secret_203_0_113_7"))

    monkeypatch.setattr(svc, "purge_snapshots", divide_by_zero)
    with capture_logs() as logs:
        outcome = await retention_scheduler._run_once_logged(sessions)
    assert outcome is retention_scheduler.RunOutcome.FAILED
    failed = [e for e in logs if e["event"] == "retention_run_failed"]
    assert len(failed) == 1
    assert failed[0]["step"] == "snapshot_purge"
    assert failed[0]["error_type"] == "DataError"
    assert failed[0]["db_error_type"] == "DivisionByZero"
    assert failed[0]["sqlstate"] == "22012"
    assert "secret_203" not in repr(logs)


async def test_not_running_warning_after_three_consecutive_failures(sessions, monkeypatch):
    calls = 0

    async def boom(db, now=None):
        nonlocal calls
        calls += 1
        raise RuntimeError("x")

    monkeypatch.setattr(retention_scheduler, "run_retention_once", boom)
    monkeypatch.setattr(retention_scheduler, "INTERVAL_SECONDS", 0.01)
    with capture_logs() as logs:
        task = retention_scheduler.start_retention_scheduler(session_factory=sessions)
        for _ in range(200):
            if any(e["event"] == "retention_not_running" for e in logs):
                break
            await asyncio.sleep(0.02)
        await retention_scheduler.stop_retention_scheduler(task)
    warned = [e for e in logs if e["event"] == "retention_not_running"]
    assert warned and warned[0]["consecutive_runs"] == 3
    assert warned[0]["log_level"] == "warning"
    assert calls >= 3


async def test_skipped_run_retried_once_then_recovers(pg_engine, sessions, monkeypatch):
    """Lock held elsewhere -> skipped; one retry after SKIP_RETRY_SECONDS runs
    once the holder lets go, and the counter resets (no warning)."""
    monkeypatch.setattr(retention_scheduler, "SKIP_RETRY_SECONDS", 0.2)
    monkeypatch.setattr(retention_scheduler, "INTERVAL_SECONDS", 3600.0)
    row_id = await _old_audit_row(sessions)
    async with pg_engine.connect() as holder:
        await holder.execute(
            text("SELECT pg_advisory_lock(:k)"), {"k": RETENTION_ADVISORY_LOCK_KEY}
        )
        with capture_logs() as logs:
            task = retention_scheduler.start_retention_scheduler(session_factory=sessions)
            for _ in range(100):
                if any(e["event"] == "retention_run" and e.get("skipped") for e in logs):
                    break
                await asyncio.sleep(0.02)
            await holder.execute(
                text("SELECT pg_advisory_unlock(:k)"), {"k": RETENTION_ADVISORY_LOCK_KEY}
            )
            for _ in range(100):
                if any(e["event"] == "retention_run" and not e.get("skipped") for e in logs):
                    break
                await asyncio.sleep(0.05)
            await retention_scheduler.stop_retention_scheduler(task)
    runs = [e for e in logs if e["event"] == "retention_run"]
    assert runs[0].get("skipped") is True
    assert runs[-1].get("skipped") is None and runs[-1]["audit_network_nulled"] >= 1
    assert not any(e["event"] == "retention_not_running" for e in logs)
    async with sessions() as s:
        row = (await s.execute(select(AuditLog).where(AuditLog.id == row_id))).scalar_one()
    assert row.ip is None


async def test_cancel_mid_run_rolls_back_and_releases_lock(pg_engine, sessions, monkeypatch):
    """Cancel the loop while a purge is in flight (blocked inside the
    transaction, lock held): the purge rolls back and the lock is released."""
    import app.services.retention_service as svc

    row_id = await _old_audit_row(sessions)
    entered = asyncio.Event()
    real_purge = svc.purge_audit_log

    async def blocking_purge(db, now=None):
        result = await real_purge(db, now)  # executes the UPDATE, uncommitted
        entered.set()
        await asyncio.sleep(3600)
        return result

    monkeypatch.setattr(svc, "purge_audit_log", blocking_purge)
    monkeypatch.setattr(retention_scheduler, "INTERVAL_SECONDS", 3600.0)
    task = retention_scheduler.start_retention_scheduler(session_factory=sessions)
    await asyncio.wait_for(entered.wait(), timeout=10)
    await retention_scheduler.stop_retention_scheduler(task)
    assert task.cancelled()
    async with sessions() as s:
        row = (await s.execute(select(AuditLog).where(AuditLog.id == row_id))).scalar_one()
        assert row.ip == "203.0.113.7"  # rolled back
        free = (
            await s.execute(select(func.pg_try_advisory_lock(RETENTION_ADVISORY_LOCK_KEY)))
        ).scalar_one()
        assert free is True  # lock was released
        await s.execute(select(func.pg_advisory_unlock(RETENTION_ADVISORY_LOCK_KEY)))


async def test_stop_does_not_swallow_caller_cancellation():
    async def stubborn():
        # Slow to unwind after its own cancellation, so stop() is still
        # waiting when the caller is cancelled.
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            await asyncio.sleep(0.3)
            raise

    task = asyncio.create_task(stubborn())
    await asyncio.sleep(0)
    caller = asyncio.create_task(retention_scheduler.stop_retention_scheduler(task))
    await asyncio.sleep(0.05)
    caller.cancel()
    with pytest.raises(asyncio.CancelledError):
        await caller
    assert caller.cancelled()


async def test_disabled_warning_logged_at_startup(monkeypatch, capsys):
    # main's module logger is cached before `capture_logs` can patch it, so
    # assert on the emitted JSON line instead.
    monkeypatch.setattr(main.settings, "retention_scheduler_enabled", False)
    monkeypatch.setattr(main.settings, "environment", "production")
    async with main.lifespan(main.app):
        pass
    assert "retention_scheduler_disabled" in capsys.readouterr().out
    monkeypatch.setattr(main.settings, "environment", "test")
    async with main.lifespan(main.app):
        pass
    assert "retention_scheduler_disabled" not in capsys.readouterr().out
