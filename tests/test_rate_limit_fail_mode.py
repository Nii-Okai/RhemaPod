"""D7 (plans/plan-account-deletion-backend.md): per-call fail mode on
``check_rate_limit``.

The default (``fail_open=True``) is the pre-existing behaviour and is proven
unchanged by tests/test_rate_limit.py; this file covers the new opt-out
(``fail_open=False`` -> ``RateLimitUnavailable``), the fixed-window boundary,
and the guard that login/OAuth keep failing open when Redis is down.
"""
import re
from pathlib import Path

import pytest

from app.core import rate_limit as rl
from app.core.config import get_settings
from app.core.rate_limit import RateLimitUnavailable, check_rate_limit
from tests.conftest import _fake

settings = get_settings()
PW = "correct-horse-battery"
REPO = Path(__file__).resolve().parent.parent


async def test_default_fails_open_when_redis_down():
    with _fake.failing():
        assert await check_rate_limit("k:default", 1, 60) is True


async def test_explicit_fail_open_true_fails_open_when_redis_down():
    with _fake.failing():
        assert await check_rate_limit("k:explicit", 1, 60, fail_open=True) is True


async def test_fail_closed_raises_typed_error_when_redis_down():
    with _fake.failing():
        with pytest.raises(RateLimitUnavailable):
            await check_rate_limit("k:closed", 5, 3600, fail_open=False)
    assert rl.RateLimitUnavailable is RateLimitUnavailable


async def test_fail_closed_healthy_allows_exactly_limit_then_denies():
    results = [
        await check_rate_limit("k:boundary", 3, 60, fail_open=False) for _ in range(4)
    ]
    assert results == [True, True, True, False]


async def test_fail_closed_counts_are_per_key():
    assert await check_rate_limit("k:a", 1, 60, fail_open=False) is True
    assert await check_rate_limit("k:a", 1, 60, fail_open=False) is False
    assert await check_rate_limit("k:b", 1, 60, fail_open=False) is True


async def test_window_expiry_resets_the_count():
    # FakeRedis has no TTL clock; simulate the key expiring by removing it,
    # which is exactly what Redis does when the EXPIRE set on the first hit fires.
    assert await check_rate_limit("k:win", 1, 60, fail_open=False) is True
    assert await check_rate_limit("k:win", 1, 60, fail_open=False) is False
    _fake.store.pop("ratelimit:k:win")
    assert await check_rate_limit("k:win", 1, 60, fail_open=False) is True


async def test_window_is_set_on_first_hit(monkeypatch):
    seen: list[tuple[str, int]] = []
    real_expire = _fake.expire

    async def spy(key, ttl):
        seen.append((key, ttl))
        return await real_expire(key, ttl)

    monkeypatch.setattr(_fake, "expire", spy)
    await check_rate_limit("k:ttl", 5, 3600, fail_open=False)
    await check_rate_limit("k:ttl", 5, 3600, fail_open=False)
    assert seen == [("ratelimit:k:ttl", 3600)]


def test_only_the_delete_route_passes_fail_open_false():
    """Intentionally structural: the plan allows exactly one fail-closed call
    site (the account-delete route, added in D9). Until then there are none."""
    offenders = []
    for path in (REPO / "app").rglob("*.py"):
        if path == REPO / "app/core/rate_limit.py":
            continue
        if re.search(r"fail_open\s*=\s*False", path.read_text()):
            offenders.append(str(path.relative_to(REPO)))
    assert set(offenders) <= {"app/api/auth.py"}, offenders


# ── login / OAuth keep failing open with Redis down ──────────────────────────
async def test_login_limiter_still_allows_with_redis_down(client):
    """With Redis down the limiter allows and /auth/login reaches credential
    verification: a wrong password is a 401 from authenticate(), never a
    429 (limiter) or a 503 from the limiter."""
    await client.post(
        "/api/v1/auth/register", json={"email": "fm-login@example.com", "password": PW}
    )
    with _fake.failing():
        r = await client.post(
            "/api/v1/auth/login",
            json={"email": "fm-login@example.com", "password": "wrong-password-xyz"},
        )
    assert r.status_code == 401, r.text


async def test_login_valid_credentials_behaviour_unchanged_with_redis_down(client):
    """Valid credentials: the limiter allows and authentication succeeds, then
    token issuance fails closed (503, token_store.py) exactly as before D7.
    That 503 is the token store's, not the limiter's."""
    await client.post(
        "/api/v1/auth/register", json={"email": "fm-ok@example.com", "password": PW}
    )
    with _fake.failing():
        r = await client.post(
            "/api/v1/auth/login", json={"email": "fm-ok@example.com", "password": PW}
        )
    assert r.status_code == 503, r.text
    assert "Authentication service temporarily unavailable" in r.json()["detail"]


@pytest.mark.parametrize(
    ("path", "body", "verifier"),
    [
        ("/api/v1/auth/oauth/google", {"id_token": "x.y.z"}, "verify_google_id_token"),
        (
            "/api/v1/auth/oauth/apple",
            {"identity_token": "x.y.z", "raw_nonce": "n"},
            "verify_apple_identity_token",
        ),
    ],
)
async def test_oauth_limiter_still_allows_with_redis_down(
    client, monkeypatch, path, body, verifier
):
    """The limiter allows and the route reaches token verification (the
    monkeypatched verifier is called), rather than 429/503 from the limiter."""
    from app.api import auth as auth_api
    from app.core.oauth import OAuthTokenError

    monkeypatch.setattr(settings, "oauth_google_enabled", True)
    monkeypatch.setattr(settings, "oauth_apple_enabled", True)
    calls: list[str] = []

    async def fake_verify(*args, **kwargs):
        calls.append("called")
        raise OAuthTokenError("invalid", "forced for test")

    monkeypatch.setattr(auth_api, verifier, fake_verify)
    with _fake.failing():
        r = await client.post(path, json=body)
    assert calls == ["called"], (r.status_code, r.text)
    assert r.status_code not in (429, 503), r.text
