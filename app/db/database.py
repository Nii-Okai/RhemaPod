from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text

from app.core.config import get_settings

settings = get_settings()

# Primary engine: all writes and read-after-write queries
primary_engine = create_async_engine(
    settings.database_url,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_timeout=30,
    #echo=settings.environment == "development",
)

# Replica engine: catalog reads. Falls back to primary when no replica is set.
replica_engine = (
    create_async_engine(
    settings.database_replica_url,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_timeout=30,
    #echo=settings.environment == "development",
)
    if settings.database_replica_url
    else primary_engine
)

PrimarySession = async_sessionmaker(primary_engine, class_=AsyncSession, expire_on_commit=False)
ReplicaSession = async_sessionmaker(replica_engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass

async def get_db():
    """Primary DB session — use for writes and read-after-write."""
    async with PrimarySession() as primarysession:
        try:
            yield primarysession
        except Exception:
            await primarysession.rollback()
            raise

async def get_read_db():
    """Replica DB session — use for read-only catalog queries."""
    async with ReplicaSession() as replicasession:
        try:
            yield replicasession
        except Exception:
            await replicasession.rollback()
            raise


async def check_db() -> bool:
    try:
        async with primary_engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
