"""Two Redis-backed rate limiters, both failing OPEN by default: if Redis is
unavailable, requests are allowed rather than blocking traffic —
availability beats throttling here, and a Redis outage is not itself an
attack signal. ``check_rate_limit`` alone offers a per-call ``fail_open=False``
opt-out (raises ``RateLimitUnavailable``) for a route where the limiter is the
only cap on a destructive, credential-guessable action (account deletion, see
ADR 0020); no other call site uses it.

This is the deliberate opposite of ``token_store.py``, where the credential
paths fail CLOSED (503) on the same outage: never issue or revoke a token we
cannot record. Keep the two postures in sync with that reasoning if either
changes.

``check_rate_limit`` — a fixed window (INCR + EXPIRE). Used by the
per-endpoint login limiter (``app/api/auth.py``) and the upload-ticket
limiter (``app/services/media_service.py``). Left alone by the W2.1 re-key;
do not repurpose it for a bucket that wants smooth refill behaviour.

``check_token_bucket`` — a token bucket (capacity + steady refill rate),
used by ``GlobalRateLimitMiddleware`` (``app/core/middleware.py``) to cap
request rate per identity (per authenticated user, or per IP for
unauthenticated callers). A fixed window allows a full burst at the edge of
every window (2x limit in a short span, at the boundary); a token bucket
does not, and its capacity/refill split maps directly onto "how big a burst"
vs "what sustained rate" — the shape the mobile congestion problem this
limiter exists for actually has (a congregation coming off silence, then
settling into steady use).
"""
import time

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.redis import get_redis

settings = get_settings()
log = get_logger("rate_limit")


class RateLimitUnavailable(Exception):
    """Redis failed during a ``check_rate_limit(..., fail_open=False)`` call.

    The caller maps this to 503; it is never raised on the default
    (fail-open) path.
    """


async def check_rate_limit(
    key: str, limit: int, window_seconds: int, *, fail_open: bool = True
) -> bool:
    """Return True if the request is allowed, False if the limit is exceeded.

    On a Redis error: ``fail_open=True`` (default) allows the request;
    ``fail_open=False`` raises ``RateLimitUnavailable``.
    """
    r = get_redis()
    redis_key = f"ratelimit:{key}"
    try:
        current = await r.incr(redis_key)
        if current == 1:
            await r.expire(redis_key, window_seconds)
        return current <= limit
    except Exception:
        log.warning("rate_limit_unavailable", key=key)
        if not fail_open:
            raise RateLimitUnavailable(key) from None
        return True  # fail open


# KEYS[1] = bucket key, ARGV = [capacity, refill_rate (tokens/sec), now
# (seconds, float)]. State is a two-field hash: `tokens` (current balance,
# clamped to capacity) and `ts` (when that balance was last computed).
# Refill is lazy — computed from elapsed time on each call, rather than a
# background job ticking every bucket — so an idle bucket costs nothing and
# there is nothing to run on a schedule. A missing/absent key is treated as
# a full bucket (a caller who has never been seen starts with a full
# allowance, not an empty one). The TTL is sized to a full refill from empty
# plus slack, so an abandoned bucket expires instead of accumulating keys
# forever.
#
# Same atomicity idiom as `token_store.py`'s `_CLAIM_AND_ROTATE_LUA`: a
# single Lua script, registered once via `register_script` and EVALSHA-cached
# on the client, so the read-compare-write happens in one round trip and two
# concurrent requests against the same bucket cannot both read a stale
# balance and both be allowed past capacity.
_TOKEN_BUCKET_LUA = """
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = 1

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end

local elapsed = now - ts
if elapsed < 0 then
  elapsed = 0
end
tokens = math.min(capacity, tokens + elapsed * refill_rate)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HSET', key, 'tokens', tostring(tokens), 'ts', tostring(now))
local ttl = math.ceil(capacity / refill_rate) + 60
if ttl < 1 then
  ttl = 1
end
redis.call('EXPIRE', key, ttl)

return allowed
"""

# Lazily registered against the first real `redis.asyncio.Redis` client seen,
# same reasoning as `token_store.py`'s `_claim_and_rotate_script`: its `.sha`
# is a local hashlib digest (no I/O), safe to reuse across the short-lived
# client instances `get_redis()` hands back, and left unset until then so a
# test double with no `register_script` never needs one.
_token_bucket_script = None


async def _run_token_bucket(
    r, key: str, capacity: int, refill_rate: float, now: float
) -> int:
    # Escape hatch for test doubles, same shape as token_store's
    # `_run_claim_and_rotate`: a client exposing its own `token_bucket_take`
    # coroutine implements the operation's *semantics* directly rather than
    # running Lua (`FakeRedis`). A real `redis.asyncio.Redis` has no such
    # method and falls through to the Lua script, which is what proves the
    # actual production code path.
    native = getattr(r, "token_bucket_take", None)
    if native is not None:
        return await native(key, capacity, refill_rate, now)

    global _token_bucket_script
    if _token_bucket_script is None:
        _token_bucket_script = r.register_script(_TOKEN_BUCKET_LUA)
    return await _token_bucket_script(
        keys=[key], args=[capacity, refill_rate, now], client=r
    )


async def check_token_bucket(key: str, capacity: int, refill_per_minute: int) -> bool:
    """Return True if a request against `key`'s bucket is allowed, taking one
    token if so. `capacity` is the burst size; `refill_per_minute` is the
    sustained rate the bucket refills at. Fails open on any Redis error —
    see the module docstring.

    `capacity` and `refill_per_minute` must both be positive: the Lua
    script's TTL calculation divides by the refill rate, and a zero rate
    turns that into a division by zero. Checked here, outside the `try`
    below, so a bad call raises immediately instead of being caught by the
    fail-open path and misreported as `rate_limit_unavailable` (a genuine
    Redis outage, not a programming error). `GlobalRateLimitMiddleware`,
    the only caller, already skips calling in when either value is
    non-positive.
    """
    if capacity <= 0 or refill_per_minute <= 0:
        raise ValueError(
            "check_token_bucket requires capacity > 0 and refill_per_minute > 0, "
            f"got capacity={capacity!r}, refill_per_minute={refill_per_minute!r}"
        )
    r = get_redis()
    redis_key = f"ratelimit:{key}"
    refill_rate = refill_per_minute / 60.0
    now = time.time()
    try:
        raw = await _run_token_bucket(r, redis_key, capacity, refill_rate, now)
        return bool(int(raw))
    except Exception:
        log.warning("rate_limit_unavailable", key=key)
        return True  # fail open
