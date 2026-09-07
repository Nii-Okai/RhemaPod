"""Redis-backed refresh-token store with rotation.

Each user's active refresh-token jti is stored under a key. On refresh we
verify the presented jti matches the stored one, then replace it (rotation).
A stolen refresh token can therefore be used at most once before detection.
"""
from app.core.config import get_settings
from app.core.redis import get_redis

settings = get_settings()


def _key(user_id: str) -> str:
    return f"refresh:{user_id}"


async def store_refresh_jti(user_id: str, jti: str) -> None:
    r = get_redis()
    ttl = settings.refresh_token_expire_days * 24 * 60 * 60
    await r.setex(_key(user_id), ttl, jti)


async def is_current_refresh_jti(user_id: str, jti: str) -> bool:
    r = get_redis()
    stored = await r.get(_key(user_id))
    return stored is not None and stored == jti


async def revoke_refresh(user_id: str) -> None:
    r = get_redis()
    await r.delete(_key(user_id))
