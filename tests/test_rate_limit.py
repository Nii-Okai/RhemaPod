"""Tests for the W2.1 rate-limiter re-key (status.md "MOBILE — W2.1 kickoff
decision" / "MOBILE — W2.1 rate limiter re-key").

`GlobalRateLimitMiddleware` now keys per-identity instead of per-IP: a
request carrying a bearer token that decodes as a valid, signature-verified
access token (`security.decode_token(token, security.ACCESS)` — the exact
function `get_current_user` calls) draws from that user's token bucket
(`user:{sub}`); everything else draws from the calling IP's bucket
(`ip:{client}`). The bucket itself (`app/core/rate_limit.py`'s
`check_token_bucket`) is a new Lua token bucket, atomic via
`register_script`/EVALSHA — the same idiom `token_store.py`'s
`claim_and_rotate` already established — and is independent of the existing
fixed-window `check_rate_limit` (still used by the login and upload-ticket
limiters, untouched here).

Minimum cases from the work item brief:
  (a) two authenticated users behind one IP don't consume each other's budget
  (b) unauthenticated login/register attempts stay IP-limited
  (c) Redis down => allowed (fail-open)
  (d) a request cannot forge a `sub` to claim another user's bucket — an
      unsigned/tampered/wrong-typed token falls through to IP-keying, never
      a trusted user bucket

Plus (per the architect's kickoff decision and the plan's own bar):
  - /health stays exempt
  - a 429 still carries the correlation ID
  - CORS preflight (OPTIONS) genuinely doesn't consume budget — a
    registration-order regression guard, not just a read of main.py
  - burst-then-refill arithmetic that actually distinguishes a token bucket
    from a fixed window, against both FakeRedis and a real Redis Lua script
  - a real-Redis concurrency proof that reads-compare-write stays atomic

Sync tests (key-selection logic has no I/O) are deliberately left unmarked,
same reasoning as tests/test_client_ip.py: this file mixes sync and async
tests, so no module-level `pytestmark`.
"""
import os
import time

import jwt
import pytest
import pytest_asyncio

from app.core.config import get_settings
from tests.conftest import _fake

settings = get_settings()
PW = "correct-horse-battery"


# ── helpers ───────────────────────────────────────────────────────────────────
def _fake_request(headers: dict[str, str] | None = None, peer: str = "9.9.9.9"):
    from starlette.requests import Request

    raw_headers = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "path": "/",
        "headers": raw_headers,
        "client": (peer, 12345),
    }
    return Request(scope)


def _signed_token(
    sub: str, token_type: str, exp_delta_seconds: int, secret: str | None = None
) -> str:
    """A hand-built JWT for exercising `decode_token`'s edges directly —
    expired, wrong type, or wrong signature — without needing a live user."""
    now = int(time.time())
    payload = {
        "sub": sub,
        "type": token_type,
        "iat": now,
        "nbf": now,
        "exp": now + exp_delta_seconds,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    return jwt.encode(payload, secret or settings.secret_key, algorithm=settings.jwt_algorithm)


async def _register_and_login(client, email: str) -> dict:
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def tight_user_bucket(monkeypatch):
    """Small, deterministic per-user bucket so a test needs single-digit
    request counts, not sixty, to observe exhaustion. Left un-fixed-up by
    default (not autouse) because several tests' setup (register + login) is
    itself unauthenticated traffic sharing the *IP* bucket — tightening both
    buckets unconditionally would make that setup trip the wrong limiter."""
    monkeypatch.setattr(settings, "user_rate_limit_burst", 3)
    # 1/minute: real requests (Argon2 hashing, a DB round trip) take tens of
    # milliseconds each, so anything higher measurably refills mid-test and
    # the exhaustion assertions below become flaky.
    monkeypatch.setattr(settings, "user_rate_limit_per_minute", 1)


@pytest.fixture
def tight_ip_bucket(monkeypatch):
    """Small, deterministic per-IP bucket — see `tight_user_bucket`."""
    monkeypatch.setattr(settings, "ip_rate_limit_burst", 3)
    monkeypatch.setattr(settings, "ip_rate_limit_per_minute", 1)  # see tight_user_bucket


# ── (a) two authenticated users behind one IP get independent buckets ───────
async def test_two_authenticated_users_behind_one_ip_have_independent_buckets(
    client, tight_user_bucket
):
    a = await _register_and_login(client, "user-a@example.com")
    b = await _register_and_login(client, "user-b@example.com")
    headers_a = {"Authorization": f"Bearer {a['access_token']}"}
    headers_b = {"Authorization": f"Bearer {b['access_token']}"}

    # Both httpx calls share the same ASGI-transport peer IP — if the
    # middleware still keyed on IP, exhausting A's requests would also
    # throttle B.
    for _ in range(3):
        r = await client.get("/api/v1/auth/me", headers=headers_a)
        assert r.status_code == 200
    exhausted = await client.get("/api/v1/auth/me", headers=headers_a)
    assert exhausted.status_code == 429

    # B is untouched.
    r = await client.get("/api/v1/auth/me", headers=headers_b)
    assert r.status_code == 200


# ── (b) unauthenticated traffic stays IP-limited, independently per IP ──────
async def test_unauthenticated_register_attempts_share_one_ip_bucket(
    client, tight_ip_bucket
):
    for i in range(3):
        r = await client.post(
            "/api/v1/auth/register",
            json={"email": f"anon-{i}@example.com", "password": PW},
        )
        assert r.status_code == 201
    exhausted = await client.post(
        "/api/v1/auth/register",
        json={"email": "anon-overflow@example.com", "password": PW},
    )
    assert exhausted.status_code == 429
    assert exhausted.headers.get("X-Correlation-ID")
    assert exhausted.headers.get("Retry-After")


async def test_unauthenticated_traffic_from_a_different_ip_is_not_throttled(
    client, monkeypatch, tight_ip_bucket
):
    monkeypatch.setattr(get_settings(), "trusted_proxies", ["127.0.0.1"])

    # Exhaust the default (untrusted-header) peer's bucket.
    for i in range(3):
        r = await client.post(
            "/api/v1/auth/register",
            json={"email": f"same-ip-{i}@example.com", "password": PW},
        )
        assert r.status_code == 201
    exhausted = await client.post(
        "/api/v1/auth/register",
        json={"email": "same-ip-overflow@example.com", "password": PW},
    )
    assert exhausted.status_code == 429

    # A caller forwarded from a distinct, trusted-proxy-reported IP has its
    # own untouched bucket.
    r = await client.post(
        "/api/v1/auth/register",
        json={"email": "other-ip@example.com", "password": PW},
        headers={"X-Forwarded-For": "203.0.113.7"},
    )
    assert r.status_code == 201


# ── (c) Redis down => allowed (fail-open) ────────────────────────────────────
async def test_redis_down_fails_open_on_an_authenticated_route(client):
    tokens = await _register_and_login(client, "failopen@example.com")
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    with _fake.failing():
        # /me touches no Redis path of its own (get_current_user is DB-only),
        # so a non-429 here isolates the limiter's fail-open behaviour.
        r = await client.get("/api/v1/auth/me", headers=headers)
    assert r.status_code == 200


async def test_check_token_bucket_fails_open_when_redis_down():
    from app.core.rate_limit import check_token_bucket

    with _fake.failing():
        allowed = await check_token_bucket("user:whoever", capacity=1, refill_per_minute=1)
    assert allowed is True


@pytest.mark.parametrize(
    "capacity,refill_per_minute",
    [(0, 10), (-1, 10), (10, 0), (10, -1)],
)
async def test_check_token_bucket_rejects_non_positive_rate_instead_of_dividing_by_zero(
    capacity, refill_per_minute
):
    from app.core.rate_limit import check_token_bucket

    # A non-positive refill rate would divide by zero in the Lua TTL
    # calculation; that must raise loudly here, not get caught by the
    # fail-open `except Exception` below and mislogged as Redis being down.
    with pytest.raises(ValueError):
        await check_token_bucket(
            "user:whoever", capacity=capacity, refill_per_minute=refill_per_minute
        )


# ── (d) a request cannot forge `sub` to claim another user's bucket ─────────
async def test_forged_subs_on_invalid_tokens_all_collapse_into_the_ip_bucket(
    client, tight_ip_bucket
):
    """Three requests, each claiming a *different* sub via a signature that
    doesn't verify, must not each buy their own bucket — if they did, this
    loop would never 429. They must all land in the same ip: bucket."""
    for i in range(3):
        forged = _signed_token(f"attacker-{i}", "access", 3600, secret="not-the-real-secret-key-0123456789ab")
        r = await client.get(
            "/api/v1/auth/me", headers={"Authorization": f"Bearer {forged}"}
        )
        assert r.status_code == 401  # decode fails -> get_current_user also rejects it

    forged = _signed_token("attacker-overflow", "access", 3600, secret="not-the-real-secret-key-0123456789ab")
    exhausted = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {forged}"}
    )
    assert exhausted.status_code == 429


def test_bucket_for_valid_access_token_keys_on_sub():
    from app.core.middleware import GlobalRateLimitMiddleware
    from app.core import security

    token = security.create_access_token("user-123", "member")
    req = _fake_request({"Authorization": f"Bearer {token}"})
    key, capacity, refill = GlobalRateLimitMiddleware._bucket_for(req)
    assert key == "user:user-123"
    assert capacity == settings.user_rate_limit_burst
    assert refill == settings.user_rate_limit_per_minute


@pytest.mark.parametrize(
    "make_token",
    [
        lambda: None,  # no Authorization header at all
        lambda: ("Basic", "dXNlcjpwYXNz"),  # wrong scheme
        lambda: ("Bearer", _signed_token("user-123", "access", -60)),  # expired
        lambda: ("Bearer", _signed_token("user-123", "refresh", 3600)),  # wrong type
        lambda: (
            "Bearer",
            _signed_token("user-123", "access", 3600, secret="wrong-secret-wrong-secret-0123456789"),
        ),  # tampered signature
        lambda: (
            "Bearer",
            jwt.encode(
                {
                    "sub": "user-123",
                    "type": "access",
                    "iat": int(time.time()),
                    "nbf": int(time.time()),
                    "exp": int(time.time()) + 3600,
                    "iss": settings.jwt_issuer,
                    "aud": settings.jwt_audience,
                },
                None,
                algorithm="none",
            ),
        ),  # alg=none
    ],
    ids=["absent", "wrong-scheme", "expired", "refresh-typed", "tampered-signature", "alg-none"],
)
def test_bucket_for_anything_but_a_valid_access_token_keys_on_ip(make_token):
    from app.core.middleware import GlobalRateLimitMiddleware

    made = make_token()
    headers = {"Authorization": f"{made[0]} {made[1]}"} if made else None
    req = _fake_request(headers, peer="9.9.9.9")
    key, capacity, refill = GlobalRateLimitMiddleware._bucket_for(req)
    assert key == "ip:9.9.9.9"
    assert capacity == settings.ip_rate_limit_burst
    assert refill == settings.ip_rate_limit_per_minute


# ── /health stays exempt ─────────────────────────────────────────────────────
async def test_health_exempt_even_past_the_ip_bucket(client, tight_ip_bucket):
    for _ in range(10):  # well past the tight 3-token bucket
        r = await client.get("/health/live")
        assert r.status_code == 200


# ── CORS preflight doesn't consume budget (registration-order guard) ────────
async def test_options_preflight_does_not_consume_budget(client, tight_ip_bucket):
    preflight_headers = {
        "Origin": "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
    }
    # Five preflights against a bucket sized for three real requests — if the
    # limiter were ever registered outside CORS (see main.py's registration
    # order and app/core/middleware.py's docstring), this would 429 well
    # before the loop ends.
    for _ in range(5):
        r = await client.options("/api/v1/auth/login", headers=preflight_headers)
        assert r.status_code == 200

    # The bucket the loop above should have left completely untouched.
    for i in range(3):
        r = await client.post(
            "/api/v1/auth/register",
            json={"email": f"preflight-{i}@example.com", "password": PW},
        )
        assert r.status_code == 201


# ── token-bucket arithmetic (not a fixed window) — FakeRedis ────────────────
async def test_burst_then_gradual_refill_fake_redis(monkeypatch):
    from app.core import rate_limit

    clock = {"t": 1_000_000.0}
    monkeypatch.setattr(rate_limit.time, "time", lambda: clock["t"])

    key = "unit:burst"
    capacity = 3
    refill_per_minute = 60  # 1 token/sec

    for _ in range(capacity):
        assert await rate_limit.check_token_bucket(key, capacity, refill_per_minute) is True
    assert await rate_limit.check_token_bucket(key, capacity, refill_per_minute) is False

    clock["t"] += 2.0  # ~2 tokens refill — a fixed window would instead
    # either still be fully blocked (mid-window) or fully reset (post-window);
    # neither matches "exactly two more allowed".
    assert await rate_limit.check_token_bucket(key, capacity, refill_per_minute) is True
    assert await rate_limit.check_token_bucket(key, capacity, refill_per_minute) is True
    assert await rate_limit.check_token_bucket(key, capacity, refill_per_minute) is False


# ── Real Redis — the actual Lua script, not the FakeRedis mirror ────────────
_TEST_REDIS_DB = os.environ.get("TEST_REDIS_DB", "15")
_CANDIDATE_REDIS_URLS = [
    os.environ.get("TEST_REDIS_URL"),
    f"redis://localhost:6379/{_TEST_REDIS_DB}",
]


def _reachable_redis_url() -> str | None:
    import redis as redis_sync

    for url in _CANDIDATE_REDIS_URLS:
        if not url:
            continue
        try:
            c = redis_sync.Redis.from_url(url, socket_connect_timeout=2)
            c.ping()
            c.close()
        except Exception:
            continue
        else:
            return url
    return None


_REAL_REDIS_URL = _reachable_redis_url()


@pytest_asyncio.fixture
async def real_redis():
    if _REAL_REDIS_URL is None:
        pytest.skip(
            "no Redis reachable (set TEST_REDIS_URL) — the real Lua token-bucket "
            "script is provable only against a real Redis server, same as "
            f"test_multi_session.py's claim_and_rotate; a dedicated DB index "
            f"({_TEST_REDIS_DB}) is used so this never touches dev data"
        )
    import redis.asyncio as redis_lib

    real_client = redis_lib.Redis.from_url(_REAL_REDIS_URL, decode_responses=True)
    await real_client.flushdb()
    try:
        yield real_client
    finally:
        await real_client.flushdb()
        await real_client.aclose()


async def test_real_redis_burst_then_refill(real_redis, monkeypatch):
    """Proves the actual Lua script — not the FakeRedis mirror — implements
    burst capacity plus gradual refill."""
    import asyncio

    import app.core.rate_limit as rl

    monkeypatch.setattr(rl, "get_redis", lambda: real_redis)

    key = "real:burst"
    capacity = 3
    refill_per_minute = 60  # 1 token/sec

    for _ in range(capacity):
        assert await rl.check_token_bucket(key, capacity, refill_per_minute) is True
    assert await rl.check_token_bucket(key, capacity, refill_per_minute) is False

    await asyncio.sleep(1.1)  # real wall-clock refill of ~1 token
    assert await rl.check_token_bucket(key, capacity, refill_per_minute) is True
    assert await rl.check_token_bucket(key, capacity, refill_per_minute) is False


async def test_real_redis_concurrent_takes_never_exceed_capacity(real_redis, monkeypatch):
    """Atomicity proof: N concurrent requests against a bucket of capacity N
    must not let more than N through — the same TOCTOU concern
    `claim_and_rotate` exists to close, here for the bucket's own
    read-compare-write."""
    import asyncio

    import app.core.rate_limit as rl

    monkeypatch.setattr(rl, "get_redis", lambda: real_redis)

    key = "real:concurrent"
    capacity = 5
    results = await asyncio.gather(
        *[rl.check_token_bucket(key, capacity, 60) for _ in range(15)]
    )
    assert sum(1 for r in results if r) == capacity
