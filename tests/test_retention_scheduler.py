"""In-process retention scheduler: lifespan wiring, a real run on Postgres,
failure survival and the count-only log shape. Real Postgres (Testcontainers);
the scheduler stays off everywhere else."""
from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from structlog.testing import capture_logs

import main
from app.models.models import AuditAction, AuditLog, AuditOutcome
from app.services import retention_scheduler

pytestmark = pytest.mark.asyncio


def _scheduler_tasks() -> list[asyncio.Task]:
    return [t for t in asyncio.all_tasks() if t.get_name() == "retention-scheduler"]


@pytest.fixture
def sessions(pg_client, pg_engine, monkeypatch):
    factory = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(retention_scheduler, "PrimarySession", factory)
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
        task = retention_scheduler.start_retention_scheduler()
        for _ in range(100):
            if calls >= 2:
                break
            await asyncio.sleep(0.02)
        await retention_scheduler.stop_retention_scheduler(task)
    assert calls >= 2
    failed = [e for e in logs if e["event"] == "retention_run_failed"]
    assert failed and all(set(e) == {"event", "log_level", "error_type"} for e in failed)
    assert failed[0]["error_type"] == "RuntimeError"


async def test_retention_run_log_holds_only_counts(sessions, monkeypatch):
    await _old_audit_row(sessions)
    monkeypatch.setattr(retention_scheduler, "INTERVAL_SECONDS", 3600.0)
    with capture_logs() as logs:
        task = retention_scheduler.start_retention_scheduler()
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
