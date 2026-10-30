"""`retention_service`: the 30-day ip/user-agent rule on every audit row, the
365-day `auth.*` delete, the 90-day snapshot purge, idempotence and the
advisory lock. Real Postgres (Testcontainers) throughout — no mocked session.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.models import (
    AuditAction,
    AuditLog,
    AuditOutcome,
    CommentModerationLog,
    ModerationAction,
)
from app.services.retention_service import (
    RETENTION_ADVISORY_LOCK_KEY,
    RetentionResult,
    run_retention_once,
)

pytestmark = pytest.mark.asyncio

NOW = datetime(2026, 10, 30, 12, 0, 0, tzinfo=UTC)
D30 = timedelta(days=30)


@pytest.fixture
def sessions(pg_engine):
    return async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)


async def _audit(sessions, action, age: timedelta, ip="203.0.113.7", ua="UA/1.0") -> uuid.UUID:
    row = AuditLog(
        action=action, outcome=AuditOutcome.SUCCESS, created_at=NOW - age,
        ip=ip, user_agent=ua, actor_email="a@example.com", details={"k": "v"},
    )
    async with sessions() as s:
        s.add(row)
        await s.commit()
    return row.id


async def _snapshot(sessions, age: timedelta) -> uuid.UUID:
    row = CommentModerationLog(
        comment_id=uuid.uuid4(), action=ModerationAction.HARD_DELETE, reason="r",
        sermon_id=uuid.uuid4(), author_id=uuid.uuid4(), body_snapshot="removed text",
        created_at=NOW - age,
    )
    async with sessions() as s:
        s.add(row)
        await s.commit()
    return row.id


async def _audit_row(sessions, row_id) -> AuditLog | None:
    async with sessions() as s:
        return (await s.execute(select(AuditLog).where(AuditLog.id == row_id))).scalar_one_or_none()


async def _run(sessions, now=NOW) -> RetentionResult:
    async with sessions() as s:
        return await run_retention_once(s, now)


async def test_auth_row_past_30_days_is_nulled_and_kept(pg_client, sessions):
    rid = await _audit(sessions, AuditAction.LOGIN, D30 + timedelta(days=1))
    res = await _run(sessions)
    assert (res.audit_deleted, res.audit_network_nulled, res.skipped) == (0, 1, False)
    row = await _audit_row(sessions, rid)
    assert row is not None and row.ip is None and row.user_agent is None
    assert row.actor_email == "a@example.com" and row.details == {"k": "v"}


async def test_non_auth_row_past_30_days_is_nulled(pg_client, sessions):
    rid = await _audit(sessions, AuditAction.ROLE_CHANGED, D30 + timedelta(days=1))
    res = await _run(sessions)
    assert res.audit_network_nulled == 1
    row = await _audit_row(sessions, rid)
    assert row.ip is None and row.user_agent is None


async def test_29_day_row_untouched(pg_client, sessions):
    rid = await _audit(sessions, AuditAction.LOGIN, timedelta(days=29))
    res = await _run(sessions)
    assert res.audit_network_nulled == 0
    row = await _audit_row(sessions, rid)
    assert row.ip == "203.0.113.7" and row.user_agent == "UA/1.0"


async def test_exact_30_day_boundary_kept_until_next_run(pg_client, sessions):
    rid = await _audit(sessions, AuditAction.SETTINGS_UPDATED, D30)
    assert (await _run(sessions)).audit_network_nulled == 0
    assert (await _audit_row(sessions, rid)).ip == "203.0.113.7"
    assert (await _run(sessions, NOW + timedelta(seconds=1))).audit_network_nulled == 1
    assert (await _audit_row(sessions, rid)).ip is None


async def test_auth_row_past_365_days_is_deleted(pg_client, sessions):
    old = await _audit(sessions, AuditAction.LOGIN, timedelta(days=366))
    keep = await _audit(sessions, AuditAction.LOGIN, timedelta(days=364))
    res = await _run(sessions)
    assert res.audit_deleted == 1
    assert await _audit_row(sessions, old) is None
    assert await _audit_row(sessions, keep) is not None


async def test_snapshots_91_nulled_89_kept(pg_client, sessions):
    old = await _snapshot(sessions, timedelta(days=91))
    new = await _snapshot(sessions, timedelta(days=89))
    res = await _run(sessions)
    assert res.snapshots_nulled == 1
    async with sessions() as s:
        snaps = {
            r.id: r.body_snapshot
            for r in (await s.execute(select(CommentModerationLog))).scalars().all()
        }
    assert snaps[old] is None and snaps[new] == "removed text"


async def test_second_run_is_a_no_op(pg_client, sessions):
    await _audit(sessions, AuditAction.LOGIN, timedelta(days=40))
    await _audit(sessions, AuditAction.LOGIN, timedelta(days=400))
    await _snapshot(sessions, timedelta(days=100))
    first = await _run(sessions)
    assert (first.audit_deleted, first.audit_network_nulled, first.snapshots_nulled) == (1, 1, 1)
    second = await _run(sessions)
    assert second == RetentionResult()  # zero counts, not skipped


async def test_lock_held_elsewhere_skips_and_changes_nothing(pg_client, pg_engine, sessions):
    rid = await _audit(sessions, AuditAction.LOGIN, timedelta(days=40))
    snap = await _snapshot(sessions, timedelta(days=100))
    async with pg_engine.connect() as holder:
        await holder.execute(
            text("SELECT pg_advisory_lock(:k)"), {"k": RETENTION_ADVISORY_LOCK_KEY}
        )
        try:
            res = await _run(sessions)
        finally:
            await holder.execute(
                text("SELECT pg_advisory_unlock(:k)"), {"k": RETENTION_ADVISORY_LOCK_KEY}
            )
    assert res == RetentionResult(skipped=True)
    assert (await _audit_row(sessions, rid)).ip == "203.0.113.7"
    async with sessions() as s:
        row = (await s.execute(select(CommentModerationLog).where(CommentModerationLog.id == snap))).scalar_one()
    assert row.body_snapshot == "removed text"
    # Once the holder lets go, the next run proceeds.
    assert (await _run(sessions)).skipped is False


async def test_failure_rolls_back_and_releases_lock(pg_client, sessions, monkeypatch):
    import app.services.retention_service as svc

    rid = await _audit(sessions, AuditAction.LOGIN, timedelta(days=40))

    async def boom(db, now=None):
        raise RuntimeError("boom")

    monkeypatch.setattr(svc, "purge_snapshots", boom)
    with pytest.raises(RuntimeError):
        await _run(sessions)
    assert (await _audit_row(sessions, rid)).ip == "203.0.113.7"  # audit nulling rolled back
    monkeypatch.undo()
    assert (await _run(sessions)).audit_network_nulled == 1  # lock was released


async def test_network_retention_days_validated():
    from app.core.config import Settings

    env = {
        "secret_key": "test-suite-signing-key-2b9f3a7c1e4d8065af12cd93",
        "database_url": "postgresql+psycopg://u:p@db/app",
        "redis_url": "redis://r:6379/0",
        "environment": "development",
    }
    assert Settings(**env).audit_network_retention_days == 30
    with pytest.raises(ValidationError):
        Settings(**env, audit_network_retention_days=0)
