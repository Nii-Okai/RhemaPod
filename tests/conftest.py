import asyncio
import os
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# The runtime reads .env (not .env.example) and refuses to boot without a real
# SECRET_KEY / DATABASE_URL, so the suite must supply them in os.environ BEFORE
# any app module builds its settings singleton. No dotenv file, no new dependency.
os.environ.setdefault("SECRET_KEY", "test-suite-signing-key-2b9f3a7c1e4d8065af12cd93")
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://test:test@localhost/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("DEBUG", "true")

# In-memory fake Redis shared across the app for tests.
from tests.fake_redis import FakeRedis  # noqa: E402

_fake = FakeRedis()

# Patch the redis client factory before app modules build their singletons.
import app.core.redis as redis_module  # noqa: E402

redis_module.get_redis = lambda: _fake  # type: ignore[assignment]

# Force both storage stubs (live R2 store + AWS archive store). Without this,
# a developer with real credentials in .env would have the suite hit live
# storage — slow, costly, and dependent on account state.
import app.core.storage as storage_module  # noqa: E402

storage_module.set_storage(storage_module.LocalStorage())
storage_module.set_archive_store(storage_module.LocalArchiveStore())

# Force the in-process mock payment provider for the suite.
import app.core.payments as payments_module  # noqa: E402

payments_module.set_provider(payments_module.MockProvider())

# Force the local stub Stream provider. Without this, a developer with real
# Cloudflare credentials in docker-compose.override.yml (never root .env —
# see status.md "W0.1 Cloudflare credentials received") would have the suite
# hit live Cloudflare.
import app.core.stream as stream_module  # noqa: E402

stream_module.set_provider(stream_module.LocalStream())

from app.db.database import Base, get_db, get_read_db  # noqa: E402
from main import app  # noqa: E402

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session", autouse=True)
def _no_real_object_storage_credentials():
    """Belt-and-braces alongside the LocalStorage/LocalArchiveStore overrides
    above: even though the suite forces both storage stubs, a real R2 or AWS
    credential sitting in .env / the shell environment means local dev is
    misconfigured, and any future code path that resets the storage
    singletons and calls get_storage()/get_archive_store() without going
    through the `client` fixture's per-test override could silently reach
    live storage. Fail loudly instead of hoping the override is always in
    place.

    Archive credentials (ARCHIVE_STORE_ACCESS_KEY_ID/SECRET_ACCESS_KEY) are
    now Settings fields (R1.3), so both live-store and archive-store
    credentials are checked the same way, via `settings` — not via
    `os.environ` directly.
    """
    assert not storage_module.settings.object_store_access_key_id, (
        "OBJECT_STORE_ACCESS_KEY_ID is set in the test environment — unset it "
        "before running the suite so tests can never reach live R2."
    )
    assert not storage_module.settings.object_store_secret_access_key, (
        "OBJECT_STORE_SECRET_ACCESS_KEY is set in the test environment — "
        "unset it before running the suite so tests can never reach live R2."
    )
    assert not storage_module.settings.archive_store_access_key_id, (
        "ARCHIVE_STORE_ACCESS_KEY_ID is set in the test environment — unset "
        "it before running the suite so tests can never reach live AWS Deep "
        "Archive."
    )
    assert not storage_module.settings.archive_store_secret_access_key, (
        "ARCHIVE_STORE_SECRET_ACCESS_KEY is set in the test environment — "
        "unset it before running the suite so tests can never reach live AWS "
        "Deep Archive."
    )


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(TEST_DB_URL, connect_args={"check_same_thread": False})

    # SQLite ignores foreign-key actions (ON DELETE SET NULL / CASCADE) unless
    # this pragma is on per-connection. Enabling it makes the in-memory test DB
    # honour the same referential actions Postgres enforces in production.
    from sqlalchemy import event

    @event.listens_for(eng.sync_engine, "connect")
    def _fk_pragma(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture(scope="session")
async def pg_engine():
    """Real Postgres, via Testcontainers — for tests exercising dialect-specific SQL
    (full-text search's `tsvector`/`setweight`) that the SQLite `engine` fixture above
    can't actually prove correct: SQLite takes a completely different LIKE-based code
    path (`search_service._is_postgres`), so a bug in the real Postgres branch (as
    happened — `setweight`'s weight argument bound as `varchar` 500s against real
    Postgres, session 2026-09-30) is invisible to the SQLite suite no matter how much of
    it passes. Session-scoped: one container for the whole run, not one per test — a
    real Postgres container takes real seconds to start, and `_truncate_all` below gives
    each test a clean slate far more cheaply than a fresh container would.
    """
    from testcontainers.postgres import PostgresContainer

    with PostgresContainer("postgres:17", driver="psycopg") as pg:
        eng = create_async_engine(pg.get_connection_url())
        async with eng.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        yield eng
        await eng.dispose()


async def _truncate_all(engine) -> None:
    from sqlalchemy import text

    async with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(text(f'TRUNCATE TABLE "{table.name}" RESTART IDENTITY CASCADE'))


@pytest_asyncio.fixture
async def pg_client(pg_engine) -> AsyncGenerator[AsyncClient, None]:
    """`client`'s exact setup/teardown, against `pg_engine` instead of the SQLite
    `engine` — same dependency-override + fake-service-reset pattern, just a real
    Postgres session underneath. Use this (not `client`) for any test whose whole point
    is proving something true against the real database dialect, not just against
    *a* database."""
    await _truncate_all(pg_engine)
    _fake.store.clear()
    _fake.hashes.clear()
    _fake.buckets.clear()
    _fake.fail = False
    storage_module.set_storage(storage_module.LocalStorage())
    storage_module.set_archive_store(storage_module.LocalArchiveStore())
    payments_module.set_provider(payments_module.MockProvider())
    stream_module.set_provider(stream_module.LocalStream())
    TestSession = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with TestSession() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_read_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client(engine) -> AsyncGenerator[AsyncClient, None]:
    _fake.store.clear()
    _fake.hashes.clear()
    _fake.buckets.clear()  # GlobalRateLimitMiddleware runs on every request;
    # an un-cleared bucket would leak rate-limit state across tests.
    _fake.fail = False  # a leaked failure-injection flag would cascade-fail the suite
    storage_module.set_storage(storage_module.LocalStorage())
    storage_module.set_archive_store(storage_module.LocalArchiveStore())
    # Fresh mock payment provider per test — no seeded period-ends or counter
    # state bleeds between tests.
    payments_module.set_provider(payments_module.MockProvider())
    # Fresh stub Stream provider per test — no seeded uid/status state bleeds
    # between tests.
    stream_module.set_provider(stream_module.LocalStream())
    TestSession = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with TestSession() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    # Catalog reads use the replica session; in tests point it at the same
    # in-memory DB so there's no separate (unavailable) replica to reach.
    app.dependency_overrides[get_read_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
