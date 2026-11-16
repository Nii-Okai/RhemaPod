import json
from collections.abc import Callable, Awaitable
from typing import Any

# Import from redis.asyncio for full async support
import redis.asyncio as redis_lib

from app.core.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
log = get_logger("redis")

# Connection pools handle async connections natively in redis.asyncio
_pool = redis_lib.ConnectionPool.from_url(
    settings.redis_url,
    decode_responses=True,
    socket_connect_timeout=settings.redis_connect_timeout_seconds,
    socket_timeout=settings.redis_socket_timeout_seconds,
)


def get_redis() -> redis_lib.Redis:
    """Return an async Redis client instance."""
    return redis_lib.Redis(connection_pool=_pool)


async def check_redis() -> bool:
    """Asynchronously check if Redis is accessible."""
    try:
        r = get_redis()
        # ping() is now an awaitable coroutine
        return await r.ping()
    except Exception:
        return False


async def cache_aside(key: str, ttl: int, source: Callable[[], Awaitable[Any]]) -> Any:
    """Return a cached value asynchronously, or compute and cache it.

    If Redis is unavailable, fall through to the async source function 
    so the request still succeeds (degraded, not broken).
    """
    r = get_redis()
    try:
        # Await the async read operation
        cached = await r.get(key)
        if cached is not None:
            return json.loads(cached)
    except Exception:
        log.warning("cache_read_failed", key=key)
        return await source()

    # Await the fallback source function
    value = await source()
    try:
        # Await the async write operation
        await r.setex(key, ttl, json.dumps(value, default=str))
    except Exception:
        log.warning("cache_write_failed", key=key)
    return value
