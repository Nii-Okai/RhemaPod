"""The last-admin invariant under genuine concurrency — PostgreSQL only.

`_assert_not_last_active_admin` locks every active-admin row `FOR UPDATE` before
counting (plan §A.5, GATE 6 mechanism A). SQLite ignores `FOR UPDATE` and is
single-writer, so the interleave that produces zero admins cannot be reproduced
in the default suite — only the *sequential* invariant can (see
`tests/test_user_lifecycle.py`). This one module proves the concurrent case on a
real PostgreSQL connection and is skipped, with a reason, when none is
reachable. Capped at one module by the plan (decision 10) — a second is an
amendment.

Point a run at a specific server with ``TEST_PG_DSN`` (a libpq DSN or URL to any
database on that server; a throwaway database is created and dropped per test).
"""
from __future__ import annotations

import asyncio
import os
import uuid

import pytest

pytestmark = pytest.mark.asyncio

psycopg = pytest.importorskip("psycopg", reason="psycopg not installed")
from psycopg.conninfo import conninfo_to_dict  # noqa: E402

_CANDIDATE_DSNS = [
    os.environ.get("TEST_PG_DSN"),
    os.environ.get("DATABASE_URL", "").replace("postgresql+psycopg://", "postgresql://"),
    "postgresql://postgres:postgres@localhost:5432/postgres",
    "postgresql://postgres@localhost:5432/postgres",
    "postgresql://localhost:5432/postgres",
]


def _reachable_admin_dsn() -> str | None:
    for dsn in _CANDIDATE_DSNS:
        if not dsn:
            continue
        try:
            with psycopg.connect(dsn, connect_timeout=2) as conn:
                conn.execute("SELECT 1")
            return dsn
        except Exception:
            continue
    return None


_ADMIN_DSN = _reachable_admin_dsn()
if _ADMIN_DSN is None:
    pytest.skip(
        "no PostgreSQL reachable (set TEST_PG_DSN) — the concurrent last-admin "
        "race is provable only on a real PostgreSQL connection (plan §A.5)",
        allow_module_level=True,
    )


@pytest.fixture
async def pg_sessionmaker():
    """A throwaway PostgreSQL database + async sessionmaker, dropped on teardown."""
    from sqlalchemy.ext.asyncio import (
        AsyncSession,
        async_sessionmaker,
        create_async_engine,
    )

    from app.db.database import Base

    admin_parts = conninfo_to_dict(_ADMIN_DSN)
    db_name = f"last_admin_race_{uuid.uuid4().hex[:12]}"

    with psycopg.connect(_ADMIN_DSN, autocommit=True, connect_timeout=5) as conn:
        conn.execute(f'CREATE DATABASE "{db_name}"')

    engine = create_async_engine(
        _sa_url(admin_parts, db_name), pool_size=5, max_overflow=5
    )
    try:
        async with engine.begin() as c:
            await c.run_sync(Base.metadata.create_all)
        yield async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    finally:
        await engine.dispose()
        with psycopg.connect(_ADMIN_DSN, autocommit=True, connect_timeout=5) as conn:
            conn.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = %s AND pid <> pg_backend_pid()",
                (db_name,),
            )
            conn.execute(f'DROP DATABASE IF EXISTS "{db_name}"')


def _sa_url(parts: dict, db_name: str) -> str:
    user = parts.get("user") or ""
    pw = parts.get("password")
    host = parts.get("host") or "localhost"
    port = parts.get("port") or "5432"
    auth = user + (f":{pw}" if pw else "")
    at = f"{auth}@" if auth else ""
    return f"postgresql+psycopg://{at}{host}:{port}/{db_name}"


async def _seed_admins(sessionmaker, emails: list[str]) -> dict[str, uuid.UUID]:
    from app.core.security import hash_password
    from app.models.models import User, UserRole

    ids: dict[str, uuid.UUID] = {}
    async with sessionmaker() as s:
        for email in emails:
            u = User(
                email=email,
                password_hash=hash_password("concurrent-test-passphrase"),
                role=UserRole.ADMIN,
                is_active=True,
            )
            s.add(u)
            await s.flush()
            ids[email] = u.id
        await s.commit()
    return ids


async def _active_admin_count(sessionmaker) -> int:
    from sqlalchemy import func, select

    from app.models.models import User, UserRole

    async with sessionmaker() as s:
        return (await s.execute(
            select(func.count())
            .select_from(User)
            .where(User.role == UserRole.ADMIN, User.is_active.is_(True))
        )).scalar_one()


async def _get_user(sessionmaker, user_id):
    from app.models.models import User

    async with sessionmaker() as s:
        return await s.get(User, user_id)


@pytest.fixture
def guard_barrier(monkeypatch):
    """Wrap `_assert_not_last_active_admin` so the first transaction into the
    guard holds its `FOR UPDATE` locks for a beat before returning, and the
    second transaction is not released until then.

    Without this a green run does not *prove* the lock blocked — if T1 ran to
    completion before T2 issued its guard `SELECT`, the invariant would hold
    anyway and the block path would never be exercised. The barrier forces T2's
    guard `SELECT` to land while T1 still holds the locks.
    """
    from app.services import auth_service

    real_guard = auth_service._assert_not_last_active_admin
    first_in_guard = asyncio.Event()
    state = {"seen": 0}

    async def barriered_guard(db, target):
        # The real SELECT ... FOR UPDATE (or its 409) happens in here.
        result = await real_guard(db, target)
        state["seen"] += 1
        if state["seen"] == 1:
            first_in_guard.set()
            await asyncio.sleep(0.25)  # T2 reaches its blocking guard SELECT here
        return result

    monkeypatch.setattr(
        auth_service, "_assert_not_last_active_admin", barriered_guard
    )
    return first_in_guard


async def test_concurrent_deactivate_deactivate_leaves_exactly_one_admin(
    pg_sessionmaker, guard_barrier
):
    from app.models.models import User
    from app.services import auth_service
    from app.services.auth_service import ContentError

    ids = await _seed_admins(pg_sessionmaker, ["a@x.com", "b@x.com"])

    async def deactivate(target_id, actor_id, *, gated):
        if gated:
            await guard_barrier.wait()
        async with pg_sessionmaker() as s:
            actor = await s.get(User, actor_id)
            return await auth_service.set_active(s, target_id, False, actor)

    results = await asyncio.gather(
        deactivate(ids["a@x.com"], ids["b@x.com"], gated=False),
        deactivate(ids["b@x.com"], ids["a@x.com"], gated=True),
        return_exceptions=True,
    )

    refused = [r for r in results if isinstance(r, ContentError)]
    succeeded = [r for r in results if isinstance(r, tuple)]
    other = [r for r in results if not isinstance(r, (ContentError, tuple))]

    assert other == [], f"unexpected error(s): {other!r}"
    assert len(refused) == 1 and refused[0].status_code == 409
    assert len(succeeded) == 1
    assert await _active_admin_count(pg_sessionmaker) == 1


async def test_concurrent_demote_and_deactivate_leaves_exactly_one_admin(
    pg_sessionmaker, guard_barrier
):
    from app.models.models import User, UserRole
    from app.services import auth_service
    from app.services.auth_service import ContentError

    ids = await _seed_admins(pg_sessionmaker, ["c@x.com", "d@x.com"])

    async def demote(target_id, actor_id):
        async with pg_sessionmaker() as s:
            actor = await s.get(User, actor_id)
            return await auth_service.change_role(s, target_id, UserRole.EDITOR, actor)

    async def deactivate(target_id, actor_id):
        await guard_barrier.wait()
        async with pg_sessionmaker() as s:
            actor = await s.get(User, actor_id)
            return await auth_service.set_active(s, target_id, False, actor)

    results = await asyncio.gather(
        demote(ids["c@x.com"], ids["d@x.com"]),
        deactivate(ids["d@x.com"], ids["c@x.com"]),
        return_exceptions=True,
    )

    refused = [r for r in results if isinstance(r, ContentError)]
    succeeded = [r for r in results if not isinstance(r, BaseException)]
    other = [
        r for r in results
        if isinstance(r, BaseException) and not isinstance(r, ContentError)
    ]

    assert other == [], f"unexpected error(s): {other!r}"
    # One transaction wins; the other is refused — either 409 (it saw the
    # winner's commit and would have zeroed the count) or 403 (the winner
    # demoted the loser's actor out of admin first). Both orders leave the
    # invariant intact.
    assert len(refused) == 1
    assert refused[0].status_code in (403, 409)
    assert len(succeeded) == 1
    assert await _active_admin_count(pg_sessionmaker) == 1
