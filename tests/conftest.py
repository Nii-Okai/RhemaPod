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

# Force the local stub storage backend. Without this, a developer with real S3
# credentials in .env would have the suite hit live AWS — slow, costly, and
# dependent on IAM state.
import app.core.storage as storage_module  # noqa: E402

storage_module.set_storage(storage_module.LocalStorage())

# Force the in-process mock payment provider for the suite.
import app.core.payments as payments_module  # noqa: E402

payments_module.set_provider(payments_module.MockProvider())

from app.db.database import Base, get_db, get_read_db  # noqa: E402
from main import app  # noqa: E402

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


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


@pytest_asyncio.fixture
async def client(engine) -> AsyncGenerator[AsyncClient, None]:
    _fake.store.clear()
    _fake.fail = False  # a leaked failure-injection flag would cascade-fail the suite
    storage_module.set_storage(storage_module.LocalStorage())
    # Fresh mock payment provider per test — no seeded period-ends or counter
    # state bleeds between tests.
    payments_module.set_provider(payments_module.MockProvider())
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
