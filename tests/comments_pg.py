"""Real Postgres + real Redis fixtures for the sermon-comments test files.

Testcontainers-backed (plan-sermon-comments S1 fixture spec, Isaac's C1 decision
1). The legacy SQLite suite and its fixtures are untouched; only the comments
test files import from here.

When Docker or the container is unreachable the fixtures skip, unless
``COMMENTS_REQUIRE_PG=1`` is set, in which case they fail. CI and every
executor's acceptance run set it so a green run can never hide skipped tests.

Test modules import the fixtures they need::

    from tests.comments_pg import (  # noqa: F401
        alembic_runner, pg_engine, pg_server, real_redis, throwaway_db,
    )
"""
from __future__ import annotations

import os
import subprocess
import sys
import traceback
import uuid
from collections.abc import AsyncGenerator, Callable, Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import NamedTuple

import psycopg
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

REPO_ROOT = Path(__file__).resolve().parents[1]
PG_IMAGE = "postgres:17"
REDIS_IMAGE = "redis:8"

# Every table the comments suites write to; truncated between tests.
_TRUNCATE_TABLES = (
    "user_blocks, comment_moderation_log, sermon_comment_reports, "
    "sermon_comments, approval_log, sermons, users"
)


def _require() -> bool:
    return os.environ.get("COMMENTS_REQUIRE_PG") == "1"


def _unavailable(reason: str):
    if _require():
        pytest.fail(f"COMMENTS_REQUIRE_PG=1 and {reason}", pytrace=False)
    pytest.skip(reason)


@dataclass(frozen=True)
class PgServer:
    host: str
    port: int
    user: str
    password: str

    def dsn(self, db: str = "postgres") -> str:
        """libpq URL for psycopg."""
        return f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/{db}"

    def sa_url(self, db: str) -> str:
        """SQLAlchemy/Alembic async-driver URL (psycopg 3)."""
        return f"postgresql+psycopg://{self.user}:{self.password}@{self.host}:{self.port}/{db}"


@pytest.fixture(scope="session")
def pg_server() -> Iterator[PgServer]:
    """One Postgres 17 container for the whole session."""
    try:
        from testcontainers.community.postgres import PostgresContainer

        container = PostgresContainer(PG_IMAGE, username="test", password="test", dbname="postgres")
        container.start()
    except Exception as exc:  # docker missing / daemon down / image pull failure
        _unavailable(f"Postgres testcontainer unavailable ({type(exc).__name__}: {exc})")
        return
    try:
        yield PgServer(
            host=container.get_container_host_ip(),
            port=int(container.get_exposed_port(5432)),
            user="test",
            password="test",
        )
    finally:
        container.stop()


def _create_database(server: PgServer) -> str:
    name = f"comments_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(server.dsn(), autocommit=True, connect_timeout=5) as conn:
        conn.execute(f'CREATE DATABASE "{name}"')
    return name


def _drop_database(server: PgServer, name: str) -> None:
    with psycopg.connect(server.dsn(), autocommit=True, connect_timeout=5) as conn:
        conn.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = %s AND pid <> pg_backend_pid()",
            (name,),
        )
        conn.execute(f'DROP DATABASE IF EXISTS "{name}"')


@pytest.fixture
def alembic_runner() -> Callable[..., subprocess.CompletedProcess]:
    """Run ``python -m alembic`` against a given async DB URL. Returns the
    CompletedProcess; callers assert on ``returncode``."""

    def run(db_url: str, *args: str) -> subprocess.CompletedProcess:
        env = {
            **os.environ,
            "DATABASE_URL": db_url,
            "SECRET_KEY": os.environ.get(
                "SECRET_KEY", "test-suite-signing-key-2b9f3a7c1e4d8065af12cd93"
            ),
            "REDIS_URL": os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
            "ENVIRONMENT": "development",
        }
        return subprocess.run(
            [sys.executable, "-m", "alembic", *args],
            cwd=REPO_ROOT, env=env, capture_output=True, text=True,
        )

    return run


@dataclass(frozen=True)
class ThrowawayDb:
    sa_url: str  # postgresql+psycopg://... (alembic / SQLAlchemy)
    dsn: str     # postgresql://... (psycopg)


@pytest.fixture
def throwaway_db(pg_server: PgServer) -> Iterator[ThrowawayDb]:
    """An empty database (no schema) on the container, dropped at teardown."""
    name = _create_database(pg_server)
    try:
        yield ThrowawayDb(sa_url=pg_server.sa_url(name), dsn=pg_server.dsn(name))
    finally:
        _drop_database(pg_server, name)


@pytest.fixture(scope="session")
def pg_migrated_db(pg_server: PgServer) -> Iterator[ThrowawayDb]:
    """A database whose schema was built by ``alembic upgrade head`` (not
    ``create_all``), shared by the whole session."""
    name = _create_database(pg_server)
    db = ThrowawayDb(sa_url=pg_server.sa_url(name), dsn=pg_server.dsn(name))
    env = {
        **os.environ,
        "DATABASE_URL": db.sa_url,
        "SECRET_KEY": os.environ.get("SECRET_KEY", "test-suite-signing-key-2b9f3a7c1e4d8065af12cd93"),
        "REDIS_URL": os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
        "ENVIRONMENT": "development",
    }
    proc = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=REPO_ROOT, env=env, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        _drop_database(pg_server, name)
        pytest.fail(f"alembic upgrade head failed:\n{proc.stdout}\n{proc.stderr}", pytrace=False)
    try:
        yield db
    finally:
        _drop_database(pg_server, name)


@pytest_asyncio.fixture
async def pg_engine(pg_migrated_db: ThrowawayDb) -> AsyncGenerator[AsyncEngine, None]:
    """Async engine on the migrated real-Postgres DB, with the comment, sermon
    and user tables truncated before each test."""
    engine = create_async_engine(pg_migrated_db.sa_url)
    with psycopg.connect(pg_migrated_db.dsn, autocommit=True) as conn:
        conn.execute(f"TRUNCATE {_TRUNCATE_TABLES} RESTART IDENTITY CASCADE")
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest.fixture(scope="session")
def redis_server() -> Iterator[tuple[str, int]]:
    try:
        from testcontainers.community.redis import RedisContainer

        container = RedisContainer(REDIS_IMAGE)
        container.start()
    except Exception as exc:
        _unavailable(f"Redis testcontainer unavailable ({type(exc).__name__}: {exc})")
        return
    try:
        yield container.get_container_host_ip(), int(container.get_exposed_port(6379))
    finally:
        container.stop()


@pytest_asyncio.fixture
async def real_redis(redis_server: tuple[str, int], monkeypatch) -> AsyncGenerator:
    """A real Redis (FLUSHALL per test) patched into the rate limiter and the
    shared redis factory. Use only where behaviour depends on real Redis (RL-*,
    concurrent posts); everything else keeps the in-memory fake."""
    import redis.asyncio as aioredis

    import app.core.rate_limit as rate_limit
    import app.core.redis as redis_module

    host, port = redis_server
    client = aioredis.Redis(host=host, port=port, decode_responses=True)
    await client.flushall()
    monkeypatch.setattr(rate_limit, "get_redis", lambda: client)
    monkeypatch.setattr(redis_module, "get_redis", lambda: client)
    try:
        yield client
    finally:
        await client.flushall()
        await client.aclose()


# ── API-level fixtures (S6) ──────────────────────────────────────────────────
# Real Postgres behind the real app. Nothing here mocks the ORM or the session:
# `get_db` / `get_read_db` are overridden with sessions from `pg_engine`.
_pwd_hash_placeholder = "not-a-real-hash"  # users are minted a token directly


def _session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _build_client(engine: AsyncEngine, *, replica_raises: bool) -> AsyncGenerator[AsyncClient, None]:
    from app.db.database import get_db, get_read_db
    from main import app
    from tests.conftest import _fake

    _fake.store.clear()
    _fake.hashes.clear()
    _fake.buckets.clear()
    _fake.fail = False
    Session = _session_factory(engine)

    async def override_get_db():
        async with Session() as session:
            yield session

    async def replica_forbidden():
        raise AssertionError("the comments API must read from the primary, not the replica")
        yield  # pragma: no cover

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_read_db] = replica_forbidden if replica_raises else override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def pg_client(pg_engine: AsyncEngine) -> AsyncGenerator[AsyncClient, None]:
    """httpx client on the real app; both DB dependencies point at real PG."""
    async for c in _build_client(pg_engine, replica_raises=False):
        yield c


@pytest_asyncio.fixture
async def pg_client_primary_only(pg_engine: AsyncEngine) -> AsyncGenerator[AsyncClient, None]:
    """As `pg_client`, but `get_read_db` raises, proving a route never touches
    the replica (C-LIST-10)."""
    async for c in _build_client(pg_engine, replica_raises=True):
        yield c


@pytest.fixture
def sessions(pg_engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return _session_factory(pg_engine)


class TestUser(NamedTuple):
    __test__ = False  # not a pytest class

    headers: dict
    id: uuid.UUID
    email: str


@pytest_asyncio.fixture
async def make_user(sessions, pg_client):
    """``await make_user(role="viewer", full_name="Nii Okai", terms=True,
    active=True)`` -> ``TestUser(headers, id, email)``.

    The row is written through the ORM and a real access token is minted for
    it, so a test can build dozens of users without tripping the per-IP auth
    limiter. The token is verified by the real auth dependency."""
    from app.core import security
    from app.models.models import User, UserRole

    counter = {"n": 0}

    async def _make(
        role: str = "viewer",
        full_name: str | None = "Test User",
        terms: bool = True,
        active: bool = True,
        email: str | None = None,
    ) -> TestUser:
        counter["n"] += 1
        addr = email or f"{role}{counter['n']}-{uuid.uuid4().hex[:6]}@example.com"
        user = User(
            email=addr,
            full_name=full_name,
            password_hash=_pwd_hash_placeholder,
            role=UserRole(role.lower()),
            is_active=active,
            comments_terms_accepted_at=datetime.now().astimezone() if terms else None,
        )
        async with sessions() as s:
            s.add(user)
            await s.commit()
        token = security.create_access_token(str(user.id), user.role.value)
        return TestUser({"Authorization": f"Bearer {token}"}, user.id, addr)

    return _make


@pytest_asyncio.fixture
async def published_sermon(sessions, make_user):
    """``await published_sermon(paid=False, status=..., publish_at=None)`` ->
    sermon id (str). Rows are written through the ORM; the owner is a fresh
    editor (sermons.created_by is RESTRICT)."""
    from app.models.models import ContentTier, Sermon, SermonStatus

    async def _make(
        paid: bool = False,
        status: SermonStatus = SermonStatus.PUBLISHED,
        publish_at: datetime | None = None,
        owner: TestUser | None = None,
        title: str = "A Sermon",
    ) -> str:
        owner = owner or await make_user(role="editor", full_name="Pastor Owner")
        sermon = Sermon(
            title=title,
            status=status,
            created_by=owner.id,
            publish_at=publish_at,
            tier=ContentTier.PAID if paid else None,
        )
        async with sessions() as s:
            s.add(sermon)
            await s.commit()
        return str(sermon.id)

    return _make


@pytest.fixture
def db_rows(sessions):
    """``await db_rows(Model, **filters)`` -> list of rows read through a fresh
    session (reads only)."""

    async def _rows(model, *where, **filters):
        async with sessions() as s:
            q = select(model).where(*where)
            for k, v in filters.items():
                q = q.where(getattr(model, k) == v)
            return list((await s.execute(q)).scalars().all())

    return _rows


class LogCapture:
    """Every line the app logs while a test runs: structured events recorded
    in place of the module-level structlog loggers, plus stdlib records."""

    def __init__(self, caplog) -> None:
        self.records: list[dict] = []
        self._caplog = caplog

    def text(self) -> str:
        return repr(self.records) + "\n" + self._caplog.text


class _RecordingLogger:
    def __init__(self, sink: list[dict]) -> None:
        self._sink = sink

    def _rec(self, level: str, event, *args, **kw) -> None:
        entry = {"level": level, "event": str(event), "args": args, **kw}
        if level == "exception":  # only .exception() renders a traceback
            entry["traceback"] = traceback.format_exc()
        self._sink.append(entry)

    def debug(self, event, *a, **kw): self._rec("debug", event, *a, **kw)
    def info(self, event, *a, **kw): self._rec("info", event, *a, **kw)
    def warning(self, event, *a, **kw): self._rec("warning", event, *a, **kw)
    def error(self, event, *a, **kw): self._rec("error", event, *a, **kw)
    def exception(self, event, *a, **kw): self._rec("exception", event, *a, **kw)
    def critical(self, event, *a, **kw): self._rec("critical", event, *a, **kw)
    def bind(self, **kw): return self


@pytest.fixture
def capture_logs(monkeypatch, caplog) -> LogCapture:
    """Replace every module-level ``log`` in the app with a recorder (the
    codebase convention; structlog's own capture misses cached loggers) and
    turn stdlib logging up to DEBUG."""
    import logging

    caplog.set_level(logging.DEBUG)
    cap = LogCapture(caplog)
    recorder = _RecordingLogger(cap.records)
    for name, mod in list(sys.modules.items()):
        if mod is None or not (name == "main" or name.startswith("app.")):
            continue
        if hasattr(mod, "log"):
            monkeypatch.setattr(mod, "log", recorder)
    return cap


@pytest_asyncio.fixture
async def seed_comment(sessions):
    """``await seed_comment(sermon_id, user_id, body="hi", status=..., hidden_auto=False,
    created_at=None)`` -> comment id. Writes through the ORM, bypassing the API
    (and its rate limits) to build fixtures with explicit timestamps."""
    from app.models.models import CommentStatus, SermonComment

    async def _seed(
        sermon_id,
        user_id,
        body: str = "Amen.",
        status: CommentStatus = CommentStatus.VISIBLE,
        hidden_auto: bool = False,
        created_at: datetime | None = None,
    ) -> uuid.UUID:
        c = SermonComment(
            sermon_id=uuid.UUID(str(sermon_id)),
            user_id=user_id,
            body=body,
            status=status,
            hidden_auto=hidden_auto,
        )
        if created_at is not None:
            c.created_at = created_at
        if status == CommentStatus.HIDDEN:
            c.hidden_at = datetime.now().astimezone()
        async with sessions() as s:
            s.add(c)
            await s.commit()
        return c.id

    return _seed


@pytest_asyncio.fixture
async def break_moderation_log(pg_engine):
    """A real database fault: a trigger that makes every INSERT into
    ``comment_moderation_log`` fail. Used to prove the comment-row change and
    the log row commit or roll back together. Removed at teardown."""
    from sqlalchemy import text

    async with pg_engine.begin() as conn:
        await conn.execute(text(
            "CREATE OR REPLACE FUNCTION fail_log_insert() RETURNS trigger AS $$ "
            "BEGIN RAISE EXCEPTION 'log insert refused'; END; $$ LANGUAGE plpgsql"
        ))
        await conn.execute(text(
            "CREATE TRIGGER fail_log_insert BEFORE INSERT ON comment_moderation_log "
            "FOR EACH ROW EXECUTE FUNCTION fail_log_insert()"
        ))
    try:
        yield
    finally:
        async with pg_engine.begin() as conn:
            await conn.execute(text("DROP TRIGGER IF EXISTS fail_log_insert ON comment_moderation_log"))
            await conn.execute(text("DROP FUNCTION IF EXISTS fail_log_insert()"))
