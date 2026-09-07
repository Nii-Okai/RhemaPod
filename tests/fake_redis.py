"""Minimal in-memory async Redis stand-in for tests.

Implements only the methods the app uses: get, setex, set, incr, expire,
delete, getdel, ping.

Failure injection: wrap a block in ``with fake.failing():`` (or set
``fake.fail = True``) and every operation raises ``redis.exceptions.
ConnectionError``, exactly as a real Redis outage would. This is how the
Redis-down paths (token_store fail-closed / rate_limit fail-open) are tested.
"""
from contextlib import contextmanager

from redis.exceptions import ConnectionError as RedisConnectionError


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}
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
        return True

    async def getdel(self, key: str):
        self._guard()
        return self.store.pop(key, None)

    async def ping(self):
        self._guard()
        return True
