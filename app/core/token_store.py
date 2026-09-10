"""Redis-backed token stores: refresh-token rotation + a single-use ledger.

Each user's active refresh-token jti is stored under a key. On refresh we
verify the presented jti matches the stored one, then replace it (rotation).
A stolen refresh token can therefore be used at most once before detection.
The single-use ledger (``register_single_use`` / ``consume_single_use``) backs
one-shot reset and invite tokens the same way.

Failure posture — deliberate, and the exact opposite of ``rate_limit.py``:

    The credential paths fail CLOSED. If Redis is unreachable every operation
    here raises ``TokenStoreUnavailable``, which the router boundary maps to a
    clean 503. We never:
      - issue a refresh token whose jti we could not record (it would be
        impossible to revoke),
      - report a session as revoked when the DELETE never reached Redis —
        logout / change-password / role-change returning 200 after a
        silently-failed revocation is a lie to the client,
      - accept a reset/invite token we cannot atomically consume.

    ``rate_limit.py`` fails OPEN on the same outage on purpose: blocking every
    login because Redis blinked is worse than briefly not throttling, and a
    Redis outage is not itself an attack signal.
"""
from redis.exceptions import RedisError

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.redis import get_redis

settings = get_settings()
log = get_logger("token_store")


class TokenStoreUnavailable(Exception):
    """Redis backing the token store is unreachable.

    Translated to HTTP 503 at the router boundary (see ``main.py``). A
    credential path must fail closed on this — never pretend a token was
    issued, a session revoked, or a one-shot token consumed.
    """


def _key(user_id: str) -> str:
    return f"refresh:{user_id}"


def _single_use_key(jti: str) -> str:
    return f"single_use:{jti}"


def _invite_pending_key(user_id: str) -> str:
    return f"invite_pending:{user_id}"


async def store_refresh_jti(user_id: str, jti: str) -> None:
    r = get_redis()
    ttl = settings.refresh_token_expire_days * 24 * 60 * 60
    try:
        await r.setex(_key(user_id), ttl, jti)
    except RedisError as exc:
        log.warning("token_store_unavailable", op="store_refresh_jti")
        raise TokenStoreUnavailable("redis unavailable") from exc


async def is_current_refresh_jti(user_id: str, jti: str) -> bool:
    r = get_redis()
    try:
        stored = await r.get(_key(user_id))
    except RedisError as exc:
        log.warning("token_store_unavailable", op="is_current_refresh_jti")
        raise TokenStoreUnavailable("redis unavailable") from exc
    return stored is not None and stored == jti


async def revoke_refresh(user_id: str) -> None:
    r = get_redis()
    try:
        await r.delete(_key(user_id))
    except RedisError as exc:
        log.warning("token_store_unavailable", op="revoke_refresh")
        raise TokenStoreUnavailable("redis unavailable") from exc


async def register_single_use(jti: str, ttl_seconds: int) -> None:
    """Record a one-shot token jti so it can be consumed exactly once.

    The TTL matches the token's own expiry, so an entry that is never consumed
    (or that a rollback orphans) falls out of Redis on its own.
    """
    r = get_redis()
    try:
        await r.setex(_single_use_key(jti), max(1, ttl_seconds), "1")
    except RedisError as exc:
        log.warning("token_store_unavailable", op="register_single_use")
        raise TokenStoreUnavailable("redis unavailable") from exc


async def mark_invite_pending(user_id: str) -> None:
    """Flag that this account has an outstanding staff invite and has never set
    its own password.

    Deliberately has **no TTL**: "this account was invited and never activated"
    is a durable fact, not a 48h one — the invite *link* expires on its own jti
    TTL, but a still-pending account must stay re-invitable well past that.
    Cleared by ``clear_invite_pending`` when the invite is completed. Phase 2
    keeps invite state in Redis only (no ``invited_at`` column — resolved
    decision 8); a full Redis data loss would make ``resend-invite`` report a
    still-pending account as already activated, which is the safe direction to
    fail (a spurious 409, not a spurious password-reset link).
    """
    r = get_redis()
    try:
        await r.set(_invite_pending_key(user_id), "1")
    except RedisError as exc:
        log.warning("token_store_unavailable", op="mark_invite_pending")
        raise TokenStoreUnavailable("redis unavailable") from exc


async def clear_invite_pending(user_id: str) -> None:
    """Drop the pending-invite flag once the account has set its own password."""
    r = get_redis()
    try:
        await r.delete(_invite_pending_key(user_id))
    except RedisError as exc:
        log.warning("token_store_unavailable", op="clear_invite_pending")
        raise TokenStoreUnavailable("redis unavailable") from exc


async def is_invite_pending(user_id: str) -> bool:
    """True while the account still has an unfinished staff invite."""
    r = get_redis()
    try:
        found = await r.get(_invite_pending_key(user_id))
    except RedisError as exc:
        log.warning("token_store_unavailable", op="is_invite_pending")
        raise TokenStoreUnavailable("redis unavailable") from exc
    return found is not None


async def consume_single_use(jti: str) -> bool:
    """Atomically claim a one-shot token jti.

    Returns True if the jti was present (and is now consumed), False if it was
    absent — already used, expired, or never registered. GETDEL makes the
    check-and-delete a single round trip, so two concurrent consumes cannot
    both win.
    """
    r = get_redis()
    try:
        claimed = await r.getdel(_single_use_key(jti))
    except RedisError as exc:
        log.warning("token_store_unavailable", op="consume_single_use")
        raise TokenStoreUnavailable("redis unavailable") from exc
    return claimed is not None
