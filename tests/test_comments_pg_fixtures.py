"""Smoke tests proving the real-Postgres / real-Redis fixtures work, so S6/S7
failures can't be blamed on the harness."""
from sqlalchemy import text

from tests.comments_pg import pg_engine, pg_migrated_db, pg_server, real_redis, redis_server  # noqa: F401


async def test_pg_engine_runs_on_alembic_built_schema(pg_engine):
    async with pg_engine.connect() as conn:
        tables = {r[0] for r in await conn.execute(text(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"))}
        assert {"sermon_comments", "user_blocks", "alembic_version"} <= tables
        assert (await conn.execute(text("SELECT count(*) FROM users"))).scalar_one() == 0


async def test_real_redis_is_patched_into_the_app(real_redis):
    import app.core.rate_limit as rate_limit
    import app.core.redis as redis_module

    assert rate_limit.get_redis() is real_redis
    assert redis_module.get_redis() is real_redis
    await real_redis.set("k", "v")
    assert await real_redis.get("k") == "v"
