"""Minimal in-memory async Redis stand-in for tests.

Implements only the methods the app uses: get, setex, incr, expire, delete, ping.
"""


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def setex(self, key: str, ttl: int, value: str):
        self.store[key] = value
        return True

    async def set(self, key: str, value: str):
        self.store[key] = value
        return True

    async def incr(self, key: str) -> int:
        current = int(self.store.get(key, "0")) + 1
        self.store[key] = str(current)
        return current

    async def expire(self, key: str, ttl: int):
        return True

    async def delete(self, *keys: str):
        for k in keys:
            self.store.pop(k, None)
        return True

    async def ping(self):
        return True
