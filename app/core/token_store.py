"""Redis-backed token stores: multi-session refresh rotation + a single-use
ledger.

Multi-session refresh rotation (status.md "W0.4 kickoff decisions", D1-D3):
each user's live refresh sessions live under one key, ``refresh:{user_id}``,
now a Redis HASH whose fields are ``session_id`` ("sid" — generated at login,
stable across rotations) and whose values are a packed JSON blob
``{jti, prev_jti, grace_until, expires_at}`` for that session. A second login
on a second device gets its own field; it no longer overwrites the first
(the bug this rework exists to fix — a single global `refresh:{user_id}`
STRING keyed only by user, one slot, clobbered on every login).

Why a hash and not per-session keys or a Postgres table — the decision record
in status.md has the full reasoning; the load-bearing part is that
**global revoke must stay one atomic command.** `reset_password`,
`change_password`, `change_role`, `set_active` all still kill *every* session
for a user (plan §A.3 #4) — with one hash that's still `DEL refresh:{user_id}`,
identical to the pre-rework semantics, one round trip, no partial-failure
window. Flat per-session keys would need SCAN-or-index + multi-key DELETE:
non-atomic, partially-failable, and a partial failure returns 200 while a
session survives — the exact silent failure this design avoids.

Cost of the hash shape: no per-field TTL (Redis <7.4 has no `HEXPIRE`), so a
session's own expiry (`expires_at`) is carried in its packed value and
enforced ON READ, not by Redis itself — `claim_and_rotate` prunes an expired
field opportunistically inside its own atomic claim. The hash's overall key
TTL is refreshed to cover the newest write on every mutation, so the whole
key is never deleted out from under a still-live session.

``claim_and_rotate`` is the atomic claim-first replacement for the old
check-then-write `is_current_refresh_jti` -> `store_refresh_jti` pair, which
had a real TOCTOU race (qa-strategist's W0.3 finding, reproduced against
`FakeRedis` via `asyncio.gather`): two concurrent refreshes presenting the
same still-valid jti could both pass the check before either wrote, and the
second write silently orphaned the first. The fix inverts the order —
pre-generate the new jti, claim it FIRST in one atomic Redis operation, only
mint the JWT with that exact jti after the claim succeeds — implemented as a
single Lua script (EVALSHA-cached) so the whole check-compare-write happens in
one round trip, the same "atomic claim in one round trip" idiom
`consume_single_use` already uses via `GETDEL`.

Failure posture — deliberate, and the exact opposite of ``rate_limit.py``:

    The credential paths fail CLOSED. If Redis is unreachable every operation
    here raises ``TokenStoreUnavailable``, which the router boundary maps to a
    clean 503. We never:
      - issue a refresh token whose jti we could not record (it would be
        impossible to revoke),
      - report a session as revoked when the DELETE/HDEL never reached Redis —
        logout / change-password / role-change returning 200 after a
        silently-failed revocation is a lie to the client,
      - accept a reset/invite token we cannot atomically consume.

    ``rate_limit.py`` fails OPEN on the same outage on purpose: blocking every
    login because Redis blinked is worse than briefly not throttling, and a
    Redis outage is not itself an attack signal.
"""
import json
import time
from enum import Enum

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
    issued, a session created or revoked, or a one-shot token consumed.
    """


class ClaimOutcome(str, Enum):
    """Result of ``claim_and_rotate``. Kept as a distinct enum, not a bool —
    auth_service maps each value to its own log line and HTTP response, so
    the reuse signal (`REUSE_REVOKED`) is never collapsed into a generic
    401 indistinguishable from an expired/unknown session."""

    ROTATED = "ROTATED"
    ROTATED_VIA_GRACE = "ROTATED_VIA_GRACE"
    REUSE_REVOKED = "REUSE_REVOKED"
    NO_SESSION = "NO_SESSION"


def _key(user_id: str) -> str:
    return f"refresh:{user_id}"


def _single_use_key(jti: str) -> str:
    return f"single_use:{jti}"


def _invite_jti_key(user_id: str) -> str:
    return f"invite_jti:{user_id}"


# Operates on one hash field (KEYS[1]=hash key, ARGV[1]=sid). See the module
# docstring and status.md "W0.4 kickoff decisions" D3 for the design; the two
# points worth calling out here because they are easy to get subtly wrong on
# a re-read:
#
#   - On ANY accept (direct match or grace), `prev_jti` becomes the OLD
#     `jti` — never the presented value. That's what makes grace single-use
#     per generation without a separate flag: once a jti has been consumed
#     (as either the live jti or as prev_jti), it can never match `prev_jti`
#     again, because prev_jti has already moved forward. This is what GR5
#     (a second presentation of the same grace-eligible jti must be reuse,
#     not grace again) requires.
#   - Grace accepts mint a genuinely NEW jti (ARGV[3]), same as a direct
#     match — a grace accept is not a no-op replay. This keeps the recovery
#     case (an app killed mid-refresh, relaunched later, presenting the old
#     jti) self-consistent: the caller always walks away with a fresh,
#     currently-valid session, never a stale echo.
_CLAIM_AND_ROTATE_LUA = """
local key = KEYS[1]
local sid = ARGV[1]
local presented = ARGV[2]
local new_jti = ARGV[3]
local now = tonumber(ARGV[4])
local ttl_seconds = tonumber(ARGV[5])
local grace_seconds = tonumber(ARGV[6])

local raw = redis.call('HGET', key, sid)
if not raw then
  return 'NO_SESSION'
end

local ok, data = pcall(cjson.decode, raw)
if not ok or type(data) ~= 'table' or not data.jti then
  redis.call('HDEL', key, sid)
  return 'NO_SESSION'
end

if not data.expires_at or now >= tonumber(data.expires_at) then
  -- Own TTL lapsed. Prune it now (there is no field-level HEXPIRE on Redis
  -- <7.4) rather than leaving it for the whole key's TTL to catch up.
  redis.call('HDEL', key, sid)
  return 'NO_SESSION'
end

local accepted = false
if data.jti == presented then
  accepted = true
elseif data.prev_jti and data.prev_jti == presented
    and data.grace_until and now < tonumber(data.grace_until) then
  accepted = true
end

if not accepted then
  -- No match at all, or a grace match that's since expired/been consumed:
  -- reuse of a token this session no longer recognizes. Revoke the whole
  -- session (family) — not the user's other sessions (D2, scoped revoke).
  redis.call('HDEL', key, sid)
  return 'REUSE_REVOKED'
end

local was_grace = (data.jti ~= presented)
local new_value = cjson.encode({
  jti = new_jti,
  prev_jti = data.jti,
  grace_until = now + grace_seconds,
  expires_at = now + ttl_seconds,
})
redis.call('HSET', key, sid, new_value)
redis.call('EXPIRE', key, ttl_seconds)

if was_grace then
  return 'ROTATED_VIA_GRACE'
end
return 'ROTATED'
"""

# Lazily registered against the first real `redis.asyncio.Redis` client seen
# (its `.sha` is a local hashlib digest, no I/O — safe to reuse across the
# short-lived client instances `get_redis()` hands back). Left unset until
# then rather than built at import time, because a test double
# (`tests/fake_redis.py`) has no `register_script` and must never need one —
# see `_run_claim_and_rotate`.
_claim_and_rotate_script = None


async def _run_claim_and_rotate(
    r,
    key: str,
    sid: str,
    presented_jti: str,
    new_jti: str,
    now: int,
    ttl_seconds: int,
    grace_seconds: int,
) -> str:
    # Escape hatch for test doubles (status.md D3 point 5): a client that
    # exposes its own `claim_and_rotate` coroutine implements the
    # operation's *semantics* directly rather than running Lua — that's
    # `FakeRedis`, used for the fail-closed/wiring cases. A real
    # `redis.asyncio.Redis` has no such method, so it falls through to the
    # Lua script, which is what proves the actual production code path.
    native = getattr(r, "claim_and_rotate", None)
    if native is not None:
        return await native(key, sid, presented_jti, new_jti, now, ttl_seconds, grace_seconds)

    global _claim_and_rotate_script
    if _claim_and_rotate_script is None:
        _claim_and_rotate_script = r.register_script(_CLAIM_AND_ROTATE_LUA)
    return await _claim_and_rotate_script(
        keys=[key],
        args=[sid, presented_jti, new_jti, now, ttl_seconds, grace_seconds],
        client=r,
    )


async def create_session(user_id: str, sid: str, jti: str) -> None:
    """Record a brand-new session (login). Adds a field to the user's hash
    rather than overwriting it — this is the actual fix for the multi-session
    bug: a second device's login no longer evicts the first's."""
    r = get_redis()
    ttl = settings.refresh_token_expire_days * 24 * 60 * 60
    now = int(time.time())
    packed = json.dumps({
        "jti": jti,
        "prev_jti": None,
        "grace_until": 0,
        "expires_at": now + ttl,
    })
    try:
        await r.hset(_key(user_id), sid, packed)
        await r.expire(_key(user_id), ttl)
    except RedisError as exc:
        log.warning("token_store_unavailable", op="create_session")
        raise TokenStoreUnavailable("redis unavailable") from exc


async def claim_and_rotate(
    user_id: str, sid: str, presented_jti: str, new_jti: str
) -> ClaimOutcome:
    """Atomically claim `presented_jti` for session `sid` and, on success,
    rotate it to `new_jti`. See the module docstring and the Lua script above
    for the full state machine. Never raises on a rejected claim — a
    mismatch, an already-expired session, or detected reuse are all
    ordinary outcomes the caller maps to a response; only a Redis outage
    raises."""
    r = get_redis()
    now = int(time.time())
    ttl_seconds = settings.refresh_token_expire_days * 24 * 60 * 60
    grace_seconds = settings.refresh_grace_seconds
    try:
        raw_outcome = await _run_claim_and_rotate(
            r, _key(user_id), sid, presented_jti, new_jti, now, ttl_seconds, grace_seconds
        )
    except RedisError as exc:
        log.warning("token_store_unavailable", op="claim_and_rotate")
        raise TokenStoreUnavailable("redis unavailable") from exc
    return ClaimOutcome(raw_outcome)


async def revoke_session(user_id: str, sid: str) -> None:
    """Revoke exactly one session (per-device logout, plan §A.3 #4). Leaves
    every other session for this user untouched — the scoped counterpart to
    `revoke_refresh` below."""
    r = get_redis()
    try:
        await r.hdel(_key(user_id), sid)
    except RedisError as exc:
        log.warning("token_store_unavailable", op="revoke_session")
        raise TokenStoreUnavailable("redis unavailable") from exc


async def revoke_refresh(user_id: str) -> None:
    """Revoke every session for this user — one atomic `DEL` of the whole
    hash, unchanged in mechanism from the pre-rework single-string key
    (D1: this atomicity is *why* the multi-session shape is a hash and not
    flat per-session keys). Reserved for `reset_password`, `change_password`,
    `change_role`, and `set_active` (plan §A.3 #4) — `logout` uses
    `revoke_session` instead, scoped to the caller's own device."""
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


async def remember_invite_jti(user_id: str, jti: str, ttl_seconds: int) -> None:
    """Record the single-use jti of the account's *current* invite link.

    Lets ``resend_invite`` retire the previously issued link (consume its
    single-use jti) so only the newest set-password link works. TTL matches the
    invite token's own expiry, so a link that is never resent falls out of Redis
    on its own — this is not a durable flag, just a pointer to the live jti.
    "Is this account still pending?" is answered by ``users.activated_at`` now,
    not Redis (ADR 0005 §4).
    """
    r = get_redis()
    try:
        await r.setex(_invite_jti_key(user_id), max(1, ttl_seconds), jti)
    except RedisError as exc:
        log.warning("token_store_unavailable", op="remember_invite_jti")
        raise TokenStoreUnavailable("redis unavailable") from exc


async def take_invite_jti(user_id: str) -> str | None:
    """Pop (GETDEL) the currently recorded invite jti for a user, or None."""
    r = get_redis()
    try:
        return await r.getdel(_invite_jti_key(user_id))
    except RedisError as exc:
        log.warning("token_store_unavailable", op="take_invite_jti")
        raise TokenStoreUnavailable("redis unavailable") from exc


async def claim_once(key: str, ttl_seconds: int) -> bool:
    """Atomically claim `key` for the first time, returning whether THIS call
    is the one that claimed it (`True` the first time, `False` on replay).

    Built for OAuth provider-token replay protection (ADR 0015): unlike
    `register_single_use`/`consume_single_use` (mint-then-consume — a jti this
    app generated, registered, and later redeems exactly once), a provider's
    ID token is already valid the moment it arrives; there is nothing to
    "register" ahead of time, only "has this exact already-verified token been
    presented before". A single `SET NX EX` does the whole check-and-claim in
    one round trip, so two concurrent presentations of the same token cannot
    both win.

    Callers pass `key=f"oauth:used:{sha256(raw_token).hexdigest()}"` and size
    `ttl_seconds` to the token's own remaining lifetime — the claim only needs
    to outlive the token itself; once the token is expired on its own terms it
    can never be presented again regardless of this ledger.
    """
    r = get_redis()
    try:
        claimed = await r.set(key, "1", nx=True, ex=max(1, ttl_seconds))
    except RedisError as exc:
        log.warning("token_store_unavailable", op="claim_once")
        raise TokenStoreUnavailable("redis unavailable") from exc
    return bool(claimed)


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
