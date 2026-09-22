"""Minimal in-memory async Redis stand-in for tests.

Implements only the methods the app uses: get, setex, set, incr, expire,
delete, getdel, ping, plus hash ops (hget/hset/hdel/hgetall) for the
multi-session refresh store (app/core/token_store.py).

``claim_and_rotate`` is a deliberate exception to "this fake doesn't know
what a Lua script does": per status.md "W0.4 kickoff decisions" D3 point 5,
this double implements ``token_store.claim_and_rotate``'s *semantics*
directly in Python rather than faking a Lua interpreter — token_store detects
this via duck typing (any client exposing a `claim_and_rotate` coroutine is
used directly, no `register_script`/`eval` involved) and uses it only for the
fail-closed/wiring cases. Anything timing-dependent (the grace window,
reuse-vs-grace edge cases) is proven against the real Lua script via a real
Redis instance instead — see tests/test_multi_session.py.

Failure injection: wrap a block in ``with fake.failing():`` (or set
``fake.fail = True``) and every operation raises ``redis.exceptions.
ConnectionError``, exactly as a real Redis outage would. This is how the
Redis-down paths (token_store fail-closed / rate_limit fail-open) are tested.
"""
import json
from contextlib import contextmanager

from redis.exceptions import ConnectionError as RedisConnectionError


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        # Hash values live in a separate dict, keyed the same as `store` —
        # keeps `store`'s type as `dict[str, str]` (untouched by every
        # existing get/setex/set caller) rather than a mixed str-or-dict
        # value type that every caller would need to guard against.
        self.hashes: dict[str, dict[str, str]] = {}
        self.fail = False

    def _guard(self) -> None:
        if self.fail:
            raise RedisConnectionError("FakeRedis: injected connection failure")

    @contextmanager
    def failing(self):
        """Make every operation raise for the duration of the block."""
        previous = self.fail
        self.fail = True
        try:
            yield
        finally:
            self.fail = previous

    async def get(self, key: str):
        self._guard()
        return self.store.get(key)

    async def setex(self, key: str, ttl: int, value: str):
        self._guard()
        self.store[key] = value
        return True

    async def set(self, key: str, value: str):
        self._guard()
        self.store[key] = value
        return True

    async def incr(self, key: str) -> int:
        self._guard()
        current = int(self.store.get(key, "0")) + 1
        self.store[key] = str(current)
        return current

    async def expire(self, key: str, ttl: int):
        self._guard()
        return True

    async def delete(self, *keys: str):
        self._guard()
        for k in keys:
            self.store.pop(k, None)
            self.hashes.pop(k, None)
        return True

    async def getdel(self, key: str):
        self._guard()
        return self.store.pop(key, None)

    async def ping(self):
        self._guard()
        return True

    # --- Hash ops (multi-session refresh store) ---
    async def hget(self, key: str, field: str):
        self._guard()
        return self.hashes.get(key, {}).get(field)

    async def hset(self, key: str, field: str, value: str):
        self._guard()
        self.hashes.setdefault(key, {})[field] = value
        return 1

    async def hdel(self, key: str, *fields: str):
        self._guard()
        h = self.hashes.get(key)
        if h is None:
            return 0
        n = 0
        for f in fields:
            if h.pop(f, None) is not None:
                n += 1
        if not h:
            self.hashes.pop(key, None)
        return n

    async def hgetall(self, key: str):
        self._guard()
        return dict(self.hashes.get(key, {}))

    # --- claim_and_rotate: the Python-mirror of token_store's Lua script.
    # See the module docstring for why this is a dedicated method rather
    # than a fake Lua interpreter. Semantics must stay in lockstep with
    # app/core/token_store.py's `_CLAIM_AND_ROTATE_LUA` — the real script is
    # the authority (see tests/test_multi_session.py's real-Redis cases);
    # this is only for the fail-closed/wiring tests.
    async def claim_and_rotate(
        self,
        key: str,
        sid: str,
        presented_jti: str,
        new_jti: str,
        now: int,
        ttl_seconds: int,
        grace_seconds: int,
    ) -> str:
        self._guard()
        h = self.hashes.get(key)
        raw = h.get(sid) if h is not None else None
        if raw is None:
            return "NO_SESSION"

        # Mirror the real Lua script's `pcall(cjson.decode, raw)` guard: a
        # decode failure or a missing `jti` is corrupted hash state, not a
        # crash — fail safe with the same defensive HDEL + NO_SESSION the
        # real script produces, rather than propagating JSONDecodeError.
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            data = {}
        if data.get("jti") is None or data.get("expires_at") is None or now >= data["expires_at"]:
            h.pop(sid, None)
            if not h:
                self.hashes.pop(key, None)
            return "NO_SESSION"

        accepted = False
        if data.get("jti") == presented_jti:
            accepted = True
        elif (
            data.get("prev_jti") is not None
            and data.get("prev_jti") == presented_jti
            and data.get("grace_until") is not None
            and now < data["grace_until"]
        ):
            accepted = True

        if not accepted:
            h.pop(sid, None)
            if not h:
                self.hashes.pop(key, None)
            return "REUSE_REVOKED"

        was_grace = data.get("jti") != presented_jti
        h[sid] = json.dumps({
            "jti": new_jti,
            "prev_jti": data["jti"],
            "grace_until": now + grace_seconds,
            "expires_at": now + ttl_seconds,
        })
        return "ROTATED_VIA_GRACE" if was_grace else "ROTATED"
