"""Snapshot purge (plan S7, PG-01..PG-11, NL-05), real Postgres."""
from __future__ import annotations

import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.models.models import CommentModerationLog, ModerationAction
from app.scripts import purge_comment_snapshots as script  # imported up front so `capture_logs` patches its logger
from app.services.retention_service import purge_snapshots
from tests.comments_pg import (  # noqa: F401
    capture_logs,
    db_rows,
    make_user,
    pg_client,
    pg_engine,
    pg_migrated_db,
    pg_server,
    redis_server,
    sessions,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
NOW = datetime(2026, 10, 2, 12, 0, 0, tzinfo=timezone.utc)
NINETY = timedelta(days=90)


@pytest.fixture
async def seed_log(sessions, make_user):
    author = await make_user()

    async def _seed(
        created_at: datetime,
        snapshot: str | None = "removed text",
        action: ModerationAction = ModerationAction.HARD_DELETE,
        reason: str | None = "Abuse",
    ) -> uuid.UUID:
        entry = CommentModerationLog(
            comment_id=uuid.uuid4(),
            actor_id=None,
            action=action,
            reason=reason,
            sermon_id=uuid.uuid4(),
            author_id=author.id,
            body_snapshot=snapshot,
            created_at=created_at,
        )
        async with sessions() as s:
            s.add(entry)
            await s.commit()
        return entry.id

    return _seed


async def snapshots(db_rows) -> dict[uuid.UUID, str | None]:
    return {e.id: e.body_snapshot for e in await db_rows(CommentModerationLog)}


async def purge(sessions, now=NOW) -> int:
    async with sessions() as s:
        count = await purge_snapshots(s, now)
        await s.commit()
        return count


async def test_pg_01_boundary_is_strict(seed_log, sessions, db_rows):
    older = await seed_log(NOW - NINETY - timedelta(seconds=1))
    exact = await seed_log(NOW - NINETY)
    newer = await seed_log(NOW - NINETY + timedelta(seconds=1))
    assert await purge(sessions) == 1
    snaps = await snapshots(db_rows)
    assert snaps[older] is None
    assert snaps[exact] == "removed text"  # exactly 90 days: kept until the next run
    assert snaps[newer] == "removed text"
    assert await purge(sessions, NOW + timedelta(seconds=1)) == 1  # the next run takes it
    assert (await snapshots(db_rows))[exact] is None


async def test_pg_02_only_body_snapshot_changes(seed_log, sessions, db_rows):
    old = NOW - timedelta(days=200)
    entry_id = await seed_log(old, reason="Because")
    before = (await db_rows(CommentModerationLog, id=entry_id))[0]
    await purge(sessions)
    (after,) = await db_rows(CommentModerationLog, id=entry_id)
    assert after.body_snapshot is None
    for col in ("id", "comment_id", "actor_id", "action", "reason", "sermon_id", "author_id", "created_at"):
        assert getattr(after, col) == getattr(before, col), col


async def test_pg_03_rows_without_a_snapshot_are_untouched(seed_log, sessions, db_rows):
    old = NOW - timedelta(days=400)
    await seed_log(old, snapshot=None, action=ModerationAction.SELF_DELETE, reason=None)
    await seed_log(old, snapshot=None, action=ModerationAction.AUTO_HIDE, reason=None)
    await seed_log(old, snapshot=None, action=ModerationAction.HIDE)
    await seed_log(old, snapshot=None, action=ModerationAction.HARD_DELETE)  # already purged
    await seed_log(old, snapshot="x")
    assert await purge(sessions) == 1
    assert len(await db_rows(CommentModerationLog)) == 5


async def test_pg_04_idempotent(seed_log, sessions):
    await seed_log(NOW - timedelta(days=120))
    assert await purge(sessions) == 1
    assert await purge(sessions) == 0


async def test_pg_05_large_batch(seed_log, sessions, db_rows):
    async with sessions() as s:
        author = (await seed_log(NOW - timedelta(days=1)),)
        a = (await db_rows(CommentModerationLog, id=author[0]))[0].author_id
        s.add_all(
            CommentModerationLog(
                comment_id=uuid.uuid4(), action=ModerationAction.HARD_DELETE, reason="r",
                sermon_id=uuid.uuid4(), author_id=a, body_snapshot=f"b{i}",
                created_at=NOW - timedelta(days=91, seconds=i),
            )
            for i in range(2500)
        )
        await s.commit()
    assert await purge(sessions) == 2500
    left = [v for v in (await snapshots(db_rows)).values() if v is not None]
    assert left == ["removed text"]  # the one-day-old row


async def test_pg_06_empty_table(sessions):
    assert await purge(sessions) == 0


async def test_pg_07_logs_only_counts(seed_log, sessions, capture_logs, monkeypatch, capsys):
    await seed_log(NOW - timedelta(days=200), snapshot="SENTINEL-SNAPSHOT-5c1e")

    class _Session:
        async def __aenter__(self):
            self.s = sessions()
            return await self.s.__aenter__()

        async def __aexit__(self, *a):
            return await self.s.__aexit__(*a)

    monkeypatch.setattr(script, "PrimarySession", _Session)
    await script._run()
    out = capsys.readouterr().out
    assert "1" in out and "SENTINEL" not in out
    assert "SENTINEL" not in capture_logs.text()
    assert any(r["event"] == "comment_snapshots_purged" and r["purged"] == 1 for r in capture_logs.records)


async def test_pg_08_script_entrypoint(seed_log, pg_migrated_db, pg_engine, db_rows):
    await seed_log(datetime.now(timezone.utc) - timedelta(days=100), snapshot="SENTINEL-ENTRYPOINT")
    env = {
        **os.environ,
        "DATABASE_URL": pg_migrated_db.sa_url,
        "SECRET_KEY": os.environ.get("SECRET_KEY", "test-suite-signing-key-2b9f3a7c1e4d8065af12cd93"),
        "REDIS_URL": os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
        "ENVIRONMENT": "development",
    }
    env.pop("DATABASE_REPLICA_URL", None)
    proc = subprocess.run(
        [sys.executable, "-m", "app.scripts.purge_comment_snapshots"],
        cwd=REPO_ROOT, env=env, capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stderr
    assert "Purged 1 comment snapshot" in proc.stdout
    assert "SENTINEL" not in proc.stdout + proc.stderr
    assert all(v is None for v in (await snapshots(db_rows)).values())


async def test_pg_09_never_violates_the_snapshot_check(seed_log, sessions, pg_engine):
    await seed_log(NOW - timedelta(days=500))
    await purge(sessions)  # a CHECK violation would raise
    async with pg_engine.connect() as conn:
        remaining = (await conn.execute(
            select(func.count()).select_from(CommentModerationLog).where(CommentModerationLog.body_snapshot.is_not(None))
        )).scalar_one()
    assert remaining == 0


# ── Compose (PG-10, PG-11): service blocks read as text, no YAML dependency ──
def _service_block(name: str) -> str:
    """Lines of one top-level service in docker-compose.yml (two-space-indented
    key under `services:`), up to the next sibling service."""
    block: list[str] = []
    inside = False
    for line in (REPO_ROOT / "docker-compose.yml").read_text().splitlines():
        if re.match(r"^  [A-Za-z0-9_-]+:\s*$", line):
            inside = line.strip() == f"{name}:"
            continue
        if re.match(r"^\S", line):  # left the services mapping
            inside = False
        if inside:
            block.append(line)
    assert block, f"service {name} not found in docker-compose.yml"
    return "\n".join(block)


def test_pg_10_compose_stub_shape():
    svc = _service_block("comment-snapshot-purge")
    assert 'profiles: ["ops"]' in svc
    assert 'restart: "no"' in svc
    assert 'command: ["python", "-m", "app.scripts.purge_comment_snapshots"]' in svc
    assert "context: ." in svc and "dockerfile: Dockerfile" in svc
    assert re.search(r"postgres:\s*\n\s*condition: service_healthy", svc)


def test_pg_11_not_started_by_default_or_by_sweeps_profile():
    svc = _service_block("comment-snapshot-purge")
    assert "profiles:" in svc
    assert "sweeps" not in svc
    assert "app.scripts.purge_comment_snapshots" not in _service_block("sweeps")
