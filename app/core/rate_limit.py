"""Simple fixed-window rate limiter backed by Redis.

Used to slow brute-force login attempts. Fails OPEN: if Redis is unavailable,
requests are allowed rather than blocking all logins — availability beats
throttling here, and a Redis outage is not itself an attack signal.

This is the deliberate opposite of ``token_store.py``, where the credential
paths fail CLOSED (503) on the same outage: never issue or revoke a token we
cannot record. Keep the two postures in sync with that reasoning if either
changes.
"""
from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.redis import get_redis

settings = get_settings()
log = get_logger("rate_limit")


async def check_rate_limit(key: str, limit: int, window_seconds: int) -> bool:
    """Return True if the request is allowed, False if the limit is exceeded."""
    r = get_redis()
    redis_key = f"ratelimit:{key}"
    try:
        current = await r.incr(redis_key)
        if current == 1:
            await r.expire(redis_key, window_seconds)
        return current <= limit
    except Exception:
        log.warning("rate_limit_unavailable", key=key)
        return True  # fail open
