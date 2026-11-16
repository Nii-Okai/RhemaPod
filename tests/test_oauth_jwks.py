"""Direct coverage of `HttpJwksProvider` (ADR 0015) — the real fetch/cache/
fail-closed/single-flight/cooldown logic `tests/test_oauth.py` never exercises
(every test there swaps it for `StaticJwksProvider`, by design, so none of
them touch a network path).

No real Google/Apple endpoint is ever reached: `httpx.AsyncClient` is swapped,
inside `app.core.oauth` only, for one backed by `httpx.MockTransport` — a
canned, in-process handler, no new test dependency (ships with `httpx`
itself, already a project dependency).
"""
from __future__ import annotations

import json
import time
from collections.abc import Callable

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

import app.core.oauth as oauth_module

pytestmark = pytest.mark.asyncio


def _jwk(kid: str, key) -> dict:
    data = json.loads(RSAAlgorithm.to_jwk(key.public_key()))
    data["kid"] = kid
    data["alg"] = "RS256"
    return data


class _RecordingHandler:
    """A canned JWKS response handler — `respond_with` swaps what the NEXT
    (and all subsequent, until swapped again) requests get back. `calls`
    counts every request actually sent, so a test can assert a cache hit
    made zero network calls, or a cooldown-gated re-fetch made none either.
    """

    def __init__(self):
        self.calls = 0
        self._next = lambda request: httpx.Response(500)

    def respond_with(self, fn) -> None:
        self._next = fn

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        return self._next(request)


def _ok_response(
    keys: list[dict], max_age: int | None = 3600
) -> Callable[[httpx.Request], httpx.Response]:
    body = json.dumps({"keys": keys}).encode()
    headers = {"cache-control": f"max-age={max_age}"} if max_age is not None else {}

    def fn(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body, headers=headers)

    return fn


def _raising_response() -> Callable[[httpx.Request], httpx.Response]:
    def fn(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("simulated network failure", request=request)

    return fn


@pytest.fixture
def handler(monkeypatch) -> _RecordingHandler:
    rec = _RecordingHandler()

    class _FakeHttpxModule:
        @staticmethod
        def AsyncClient(**kwargs):
            kwargs["transport"] = httpx.MockTransport(rec)
            return httpx.AsyncClient(**kwargs)

    monkeypatch.setattr(oauth_module, "httpx", _FakeHttpxModule())
    return rec


@pytest.fixture(scope="session")
def _rsa_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


async def test_cache_miss_fetches_once(handler, _rsa_key):
    kid = "kid-a"
    handler.respond_with(_ok_response([_jwk(kid, _rsa_key)]))
    provider = oauth_module.HttpJwksProvider("https://example.invalid/keys")

    key = await provider.get_key(kid)

    assert key.key_id == kid
    assert handler.calls == 1


async def test_fresh_cache_hit_makes_no_network_call(handler, _rsa_key):
    kid = "kid-a"
    handler.respond_with(_ok_response([_jwk(kid, _rsa_key)]))
    provider = oauth_module.HttpJwksProvider("https://example.invalid/keys")

    await provider.get_key(kid)
    assert handler.calls == 1

    await provider.get_key(kid)
    assert handler.calls == 1  # second call served straight from cache


async def test_unknown_kid_is_cooldown_gated(handler, _rsa_key):
    kid = "kid-a"
    handler.respond_with(_ok_response([_jwk(kid, _rsa_key)]))
    provider = oauth_module.HttpJwksProvider("https://example.invalid/keys")
    await provider.get_key(kid)
    assert handler.calls == 1

    # Asking for a kid that isn't in the (still-fresh) cache forces exactly
    # one re-fetch attempt...
    with pytest.raises(oauth_module.OAuthTokenError) as exc_info:
        await provider.get_key("never-seen-kid")
    assert exc_info.value.reason == "invalid"
    assert handler.calls == 2

    # ...and a SECOND unknown-kid lookup within the cooldown window must not
    # trigger another network call at all.
    with pytest.raises(oauth_module.OAuthTokenError):
        await provider.get_key("never-seen-kid")
    assert handler.calls == 2


async def test_fetch_failure_falls_back_to_stale_cache(handler, _rsa_key):
    kid = "kid-a"
    handler.respond_with(_ok_response([_jwk(kid, _rsa_key)]))
    provider = oauth_module.HttpJwksProvider("https://example.invalid/keys")
    await provider.get_key(kid)
    assert handler.calls == 1

    # Force the cache to look expired (routine TTL expiry, not the
    # unknown-kid cooldown path) so the next call attempts a real re-fetch.
    cached = provider._cache
    provider._cache = oauth_module._CachedKeys(keys=cached.keys, expires_at=time.monotonic() - 1)

    handler.respond_with(_raising_response())

    # The provider's own already-cached key is still served even though the
    # re-fetch attempt failed — a transient provider blip must not hard-fail
    # a request for a kid this process already has.
    key = await provider.get_key(kid)
    assert key.key_id == kid
    assert handler.calls == 2


async def test_fetch_failure_with_nothing_cached_is_unavailable(handler):
    handler.respond_with(_raising_response())
    provider = oauth_module.HttpJwksProvider("https://example.invalid/keys")

    with pytest.raises(oauth_module.OAuthTokenError) as exc_info:
        await provider.get_key("any-kid")

    assert exc_info.value.reason == "unavailable"
    assert handler.calls == 1
