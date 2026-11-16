"""ADR 0015 — "Sign in with Google" / "Sign in with Apple".

Real Postgres via Testcontainers (this repo's convention — `tests/comments_pg.py`'s
`pg_migrated_db` runs the real `alembic upgrade head`, so this suite also proves
the new migration applies cleanly against a real database, not just that
`alembic heads` resolves). Redis stays the in-memory `FakeRedis` double
(conftest.py's default): `claim_once` is a single `SET NX EX`, not a Lua
script, so — same reasoning this codebase already applies to every other
non-Lua Redis op (see `tests/fake_redis.py`'s module docstring) — FakeRedis's
dict-based mirror proves its semantics exactly; real Redis is reserved for the
two primitives (`claim_and_rotate`, `token_bucket_take`) whose correctness
depends on the actual Lua script, which this feature doesn't touch.

Google/Apple's real JWKS endpoints are never reached: `StaticJwksProvider`
wraps one RSA key pair generated fresh for this test run, monkeypatched onto
`app.core.oauth.GOOGLE`/`APPLE` in place of the real `HttpJwksProvider`.
"""
from __future__ import annotations

import asyncio
import hashlib
import time
import uuid

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt import PyJWK
from jwt.algorithms import RSAAlgorithm

import app.core.oauth as oauth_module
import app.core.storage as storage_module
import app.services.oauth_service as oauth_service_module
from app.core.config import get_settings
from app.models.models import AuthProvider, User, UserIdentity, UserRole
from tests.comments_pg import (  # noqa: F401
    db_rows,
    make_user,
    pg_client,
    pg_engine,
    pg_migrated_db,
    pg_server,
    sessions,
)

pytestmark = pytest.mark.asyncio

settings = get_settings()

_KID = "test-key-1"
_GOOGLE_AUD = "test-google-client-id"
_APPLE_AUD = "com.niitech.rhemapod"
PW = "correct-horse-battery"


# ── RSA test key + StaticJwksProvider wiring ─────────────────────────────────
@pytest.fixture(scope="session")
def _rsa_key():
    """One RSA key pair generated fresh for this test run — never Google's or
    Apple's real signing keys."""
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def _wire_static_jwks(monkeypatch, _rsa_key):
    """Every test in this module verifies tokens against the one local test
    key, never a real network call. Also pins the audience allow-lists and
    enables both providers by default (individual tests override as needed)."""
    import json

    jwk_dict = json.loads(RSAAlgorithm.to_jwk(_rsa_key.public_key()))
    jwk_dict["kid"] = _KID
    jwk_dict["alg"] = "RS256"
    static = oauth_module.StaticJwksProvider({_KID: PyJWK.from_dict(jwk_dict)})

    monkeypatch.setattr(oauth_module.GOOGLE, "jwks_provider", static)
    monkeypatch.setattr(oauth_module.APPLE, "jwks_provider", static)
    monkeypatch.setattr(settings, "google_oauth_client_ids", [_GOOGLE_AUD])
    monkeypatch.setattr(settings, "apple_oauth_audiences", [_APPLE_AUD])
    monkeypatch.setattr(settings, "oauth_google_enabled", True)
    monkeypatch.setattr(settings, "oauth_apple_enabled", True)


def _mint(private_key, claims: dict) -> str:
    return jwt.encode(claims, private_key, algorithm="RS256", headers={"kid": _KID})


def _google_claims(sub: str, **overrides) -> dict:
    now = int(time.time())
    claims = {
        "iss": "https://accounts.google.com",
        "aud": _GOOGLE_AUD,
        "sub": sub,
        "email": f"{sub}@example.com",
        "email_verified": True,
        "iat": now,
        "exp": now + 3600,
        "given_name": "Grace",
        "family_name": "Hopper",
    }
    claims.update(overrides)
    return claims


def _apple_claims(sub: str, raw_nonce: str, **overrides) -> dict:
    now = int(time.time())
    claims = {
        "iss": "https://appleid.apple.com",
        "aud": _APPLE_AUD,
        "sub": sub,
        "email": f"{sub}@example.com",
        "email_verified": True,
        "is_private_email": False,
        "nonce": hashlib.sha256(raw_nonce.encode("utf-8")).hexdigest(),
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    return claims


async def _google_sign_in(pg_client, private_key, sub: str, **overrides):
    token = _mint(private_key, _google_claims(sub, **overrides))
    return await pg_client.post("/api/v1/auth/oauth/google", json={"id_token": token})


async def _apple_sign_in(pg_client, private_key, sub: str, raw_nonce: str = "a-raw-nonce", **overrides):
    token = _mint(private_key, _apple_claims(sub, raw_nonce, **overrides))
    return await pg_client.post(
        "/api/v1/auth/oauth/apple",
        json={"identity_token": token, "raw_nonce": raw_nonce},
    )


# ── Google: fresh sign-in / repeat sign-in ───────────────────────────────────
async def test_fresh_google_sign_in_creates_viewer_with_no_password(pg_client, _rsa_key, db_rows):
    sub = f"google-sub-{uuid.uuid4().hex[:8]}"
    resp = await _google_sign_in(pg_client, _rsa_key, sub)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["access_token"] and body["refresh_token"]

    rows = await db_rows(User, email=f"{sub}@example.com")
    assert len(rows) == 1
    user = rows[0]
    assert user.password_hash is None
    assert user.role == UserRole.VIEWER
    assert user.activated_at is not None

    identities = await db_rows(UserIdentity, user_id=user.id)
    assert len(identities) == 1
    assert identities[0].provider == AuthProvider.GOOGLE
    assert identities[0].provider_subject == sub


async def test_repeat_google_sign_in_same_subject_returns_same_user(pg_client, _rsa_key, db_rows):
    sub = f"google-sub-{uuid.uuid4().hex[:8]}"
    first = await _google_sign_in(pg_client, _rsa_key, sub)
    assert first.status_code == 200, first.text

    # A second, freshly-signed token (different `iat`) for the same `sub` —
    # simulates the app getting a new ID token from Google on a later launch,
    # not a byte-for-byte replay of the first one.
    second = await _google_sign_in(pg_client, _rsa_key, sub, iat=int(time.time()) + 1)
    assert second.status_code == 200, second.text

    rows = await db_rows(User, email=f"{sub}@example.com")
    assert len(rows) == 1
    identities = await db_rows(UserIdentity, provider_subject=sub)
    assert len(identities) == 1


# ── Auto-link: password cleared, sessions revoked ────────────────────────────
async def test_auto_link_clears_password_and_revokes_sessions(pg_client, _rsa_key, db_rows):
    email = f"preexisting-{uuid.uuid4().hex[:8]}@example.com"
    reg = await pg_client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    assert reg.status_code == 201, reg.text

    login = await pg_client.post("/api/v1/auth/login", json={"email": email, "password": PW})
    assert login.status_code == 200, login.text
    old_refresh = login.json()["refresh_token"]

    sub = f"google-sub-{uuid.uuid4().hex[:8]}"
    link_resp = await _google_sign_in(pg_client, _rsa_key, sub, email=email, aud=_GOOGLE_AUD)
    assert link_resp.status_code == 200, link_resp.text

    rows = await db_rows(User, email=email)
    assert len(rows) == 1
    assert rows[0].password_hash is None

    # Old password no longer works.
    relogin = await pg_client.post("/api/v1/auth/login", json={"email": email, "password": PW})
    assert relogin.status_code == 401

    # The refresh token minted before linking was revoked (global revoke).
    refresh_attempt = await pg_client.post(
        "/api/v1/auth/refresh", json={"refresh_token": old_refresh}
    )
    assert refresh_attempt.status_code == 401

    identities = await db_rows(UserIdentity, user_id=rows[0].id)
    assert len(identities) == 1
    assert identities[0].provider == AuthProvider.GOOGLE


def _capture_linked_notices(monkeypatch) -> list[dict]:
    from app.core import email as email_module

    sent: list[dict] = []

    async def sender(to, provider, *, password_removed):
        sent.append({"to": to, "provider": provider, "password_removed": password_removed})

    monkeypatch.setattr(email_module, "send_sign_in_method_linked", sender)
    return sent


async def test_auto_link_notice_says_password_removed_when_one_existed(
    pg_client, _rsa_key, monkeypatch
):
    sent = _capture_linked_notices(monkeypatch)
    email = f"pw-holder-{uuid.uuid4().hex[:8]}@example.com"
    reg = await pg_client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    assert reg.status_code == 201, reg.text

    sub = f"google-sub-{uuid.uuid4().hex[:8]}"
    resp = await _google_sign_in(pg_client, _rsa_key, sub, email=email, aud=_GOOGLE_AUD)
    assert resp.status_code == 200, resp.text

    assert sent == [{"to": email, "provider": "Google", "password_removed": True}]


async def test_auto_link_notice_omits_password_claim_for_passwordless_account(
    pg_client, _rsa_key, monkeypatch, db_rows
):
    # Google-first account (never had a password) then linking Apple on the
    # same verified email — the case that sent a false "password removed".
    sent = _capture_linked_notices(monkeypatch)
    email = f"google-first-{uuid.uuid4().hex[:8]}@example.com"
    first = await _google_sign_in(
        pg_client, _rsa_key, f"google-sub-{uuid.uuid4().hex[:8]}", email=email, aud=_GOOGLE_AUD
    )
    assert first.status_code == 200, first.text
    assert sent == []

    resp = await _apple_sign_in(pg_client, _rsa_key, f"apple-sub-{uuid.uuid4().hex[:8]}", email=email)
    assert resp.status_code == 200, resp.text

    assert sent == [{"to": email, "provider": "Apple", "password_removed": False}]
    rows = await db_rows(User, email=email)
    identities = await db_rows(UserIdentity, user_id=rows[0].id)
    assert {i.provider for i in identities} == {AuthProvider.GOOGLE, AuthProvider.APPLE}


@pytest.mark.parametrize("password_removed", [True, False])
async def test_linked_notice_copy_matches_password_state(monkeypatch, password_removed):
    from app.core import email as email_module

    captured: list[tuple] = []

    async def fake_send(to, subject, text, html):
        captured.append((subject, text, html))

    monkeypatch.setattr(email_module, "_send", fake_send)
    await email_module.send_sign_in_method_linked(
        "a@example.com", "Apple", password_removed=password_removed
    )

    (_, text, html), = captured
    for body in (text, html):
        assert ("password was removed" in body) is password_removed
        assert "contact support" in body


async def test_deactivated_account_rejected_at_auto_link(pg_client, _rsa_key, make_user, db_rows):
    """Security-reviewer finding: the auto-link branch must check `is_active`
    before any of its side effects (password wipe, session revoke, identity
    insert) — symmetric with the "already linked" branch, which already did.
    Nothing about the account may change on a rejected attempt."""
    victim = await make_user(role="viewer", active=False)

    resp = await _google_sign_in(pg_client, _rsa_key, f"google-sub-{uuid.uuid4().hex[:8]}", email=victim.email)
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid email or password"

    rows = await db_rows(User, email=victim.email)
    assert len(rows) == 1
    # Unchanged — the placeholder hash `make_user` seeds is still there, not
    # cleared, proving the auto-link write never ran.
    assert rows[0].password_hash is not None
    assert rows[0].is_active is False

    identities = await db_rows(UserIdentity, user_id=victim.id)
    assert identities == []


# ── Create/link race (reviewer-gilfoyle finding) ─────────────────────────────
async def test_concurrent_sign_in_same_subject_resolves_without_500(pg_client, _rsa_key, db_rows):
    """Two concurrent sign-ins for the same (provider, subject) — e.g. a
    client retrying a timed-out request mints a second, byte-distinct ID
    token for the same underlying identity. `claim_once` doesn't catch this
    (different token bytes), so both requests can race past the
    "no existing identity" check and collide on insert. Both must resolve to
    the SAME user, neither may 500."""
    sub = f"google-sub-{uuid.uuid4().hex[:8]}"
    token_a = _mint(_rsa_key, _google_claims(sub))
    token_b = _mint(_rsa_key, _google_claims(sub, iat=int(time.time()) + 1))

    resp_a, resp_b = await asyncio.gather(
        pg_client.post("/api/v1/auth/oauth/google", json={"id_token": token_a}),
        pg_client.post("/api/v1/auth/oauth/google", json={"id_token": token_b}),
    )

    assert resp_a.status_code == 200, resp_a.text
    assert resp_b.status_code == 200, resp_b.text

    rows = await db_rows(User, email=f"{sub}@example.com")
    assert len(rows) == 1
    identities = await db_rows(UserIdentity, provider_subject=sub)
    assert len(identities) == 1


async def test_concurrent_auto_link_same_subject_resolves_without_500(pg_client, _rsa_key, db_rows):
    """Same race, on the auto-link path: two concurrent sign-ins matching an
    existing password-based account by email, same provider subject."""
    email = f"race-link-{uuid.uuid4().hex[:8]}@example.com"
    reg = await pg_client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    assert reg.status_code == 201, reg.text

    sub = f"google-sub-{uuid.uuid4().hex[:8]}"
    token_a = _mint(_rsa_key, _google_claims(sub, email=email))
    token_b = _mint(_rsa_key, _google_claims(sub, email=email, iat=int(time.time()) + 1))

    resp_a, resp_b = await asyncio.gather(
        pg_client.post("/api/v1/auth/oauth/google", json={"id_token": token_a}),
        pg_client.post("/api/v1/auth/oauth/google", json={"id_token": token_b}),
    )

    assert resp_a.status_code == 200, resp_a.text
    assert resp_b.status_code == 200, resp_b.text

    rows = await db_rows(User, email=email)
    assert len(rows) == 1
    assert rows[0].password_hash is None
    identities = await db_rows(UserIdentity, user_id=rows[0].id)
    assert len(identities) == 1


# ── Staff exclusion ───────────────────────────────────────────────────────────
async def test_staff_account_rejected_at_link_time(pg_client, _rsa_key, make_user, db_rows):
    staff = await make_user(role="editor")
    sub = f"google-sub-{uuid.uuid4().hex[:8]}"
    resp = await _google_sign_in(pg_client, _rsa_key, sub, email=staff.email)
    assert resp.status_code == 403
    assert "email and password" in resp.json()["detail"]

    identities = await db_rows(UserIdentity, user_id=staff.id)
    assert identities == []


async def test_staff_account_rejected_on_subsequent_sign_in_even_if_prelinked(
    pg_client, _rsa_key, make_user, sessions
):
    """A viewer somehow pre-linked, then promoted to staff — the promotion
    alone must be enough to lock OAuth sign-in back out, with no change
    needed to the identity row itself."""
    staff = await make_user(role="manager")
    sub = f"google-sub-{uuid.uuid4().hex[:8]}"
    async with sessions() as s:
        s.add(UserIdentity(user_id=staff.id, provider=AuthProvider.GOOGLE, provider_subject=sub))
        await s.commit()

    resp = await _google_sign_in(pg_client, _rsa_key, sub, email=staff.email)
    assert resp.status_code == 403
    assert "email and password" in resp.json()["detail"]


# ── Unverified email ──────────────────────────────────────────────────────────
async def test_unverified_email_rejected(pg_client, _rsa_key):
    sub = f"google-sub-{uuid.uuid4().hex[:8]}"
    resp = await _google_sign_in(pg_client, _rsa_key, sub, email_verified=False)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Email not verified by provider"


# ── Replay protection ─────────────────────────────────────────────────────────
async def test_replayed_token_rejected_on_second_attempt(pg_client, _rsa_key):
    sub = f"google-sub-{uuid.uuid4().hex[:8]}"
    token = _mint(_rsa_key, _google_claims(sub))

    first = await pg_client.post("/api/v1/auth/oauth/google", json={"id_token": token})
    assert first.status_code == 200, first.text

    second = await pg_client.post("/api/v1/auth/oauth/google", json={"id_token": token})
    assert second.status_code == 401
    assert second.json()["detail"] == "Invalid or expired sign-in token"


# ── Algorithm pinning (security-reviewer should-fix: lock this in) ──────────
async def test_google_hs256_alg_confusion_token_rejected(pg_client, _rsa_key):
    """The single most security-critical property here: only RS256 is ever
    accepted, so a token signed `alg=HS256` (e.g. using the RSA public key's
    bytes as an HMAC secret — the classic RS256->HS256 confusion attack) must
    be rejected outright, never silently accepted as if signature-valid."""
    sub = f"google-sub-{uuid.uuid4().hex[:8]}"
    claims = _google_claims(sub)
    token = jwt.encode(claims, "attacker-controlled-secret-long-enough-for-hmac", algorithm="HS256", headers={"kid": _KID})
    resp = await pg_client.post("/api/v1/auth/oauth/google", json={"id_token": token})
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or expired sign-in token"


async def test_apple_hs256_alg_confusion_token_rejected(pg_client, _rsa_key, monkeypatch):
    monkeypatch.setattr(settings, "oauth_apple_enabled", True)
    sub = f"apple-sub-{uuid.uuid4().hex[:8]}"
    raw_nonce = "a-raw-nonce"
    claims = _apple_claims(sub, raw_nonce)
    token = jwt.encode(claims, "attacker-controlled-secret-long-enough-for-hmac", algorithm="HS256", headers={"kid": _KID})
    resp = await pg_client.post(
        "/api/v1/auth/oauth/apple",
        json={"identity_token": token, "raw_nonce": raw_nonce},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or expired sign-in token"


# ── Audience mismatch ─────────────────────────────────────────────────────────
async def test_audience_mismatch_rejected_with_distinct_401(pg_client, _rsa_key):
    sub = f"google-sub-{uuid.uuid4().hex[:8]}"
    resp = await _google_sign_in(pg_client, _rsa_key, sub, aud="someone-elses-client-id")
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Sign-in token was issued for a different app"


# ── Rate limit ────────────────────────────────────────────────────────────────
async def test_rate_limit_matches_login_budget(pg_client, _rsa_key, monkeypatch):
    monkeypatch.setattr(settings, "login_rate_limit", 3)
    monkeypatch.setattr(settings, "login_rate_window_seconds", 60)

    for _ in range(3):
        sub = f"google-sub-{uuid.uuid4().hex[:8]}"
        resp = await _google_sign_in(pg_client, _rsa_key, sub)
        assert resp.status_code == 200, resp.text

    sub = f"google-sub-{uuid.uuid4().hex[:8]}"
    throttled = await _google_sign_in(pg_client, _rsa_key, sub)
    assert throttled.status_code == 429


# ── Apple: gated by default, full path works once enabled ───────────────────
async def test_apple_sign_in_404s_when_disabled(pg_client, _rsa_key, monkeypatch):
    monkeypatch.setattr(settings, "oauth_apple_enabled", False)
    sub = f"apple-sub-{uuid.uuid4().hex[:8]}"
    resp = await _apple_sign_in(pg_client, _rsa_key, sub)
    assert resp.status_code == 404


async def test_apple_fresh_sign_in_creates_viewer(pg_client, _rsa_key, db_rows):
    sub = f"apple-sub-{uuid.uuid4().hex[:8]}"
    resp = await _apple_sign_in(pg_client, _rsa_key, sub)
    assert resp.status_code == 200, resp.text

    rows = await db_rows(User, email=f"{sub}@example.com")
    assert len(rows) == 1
    assert rows[0].password_hash is None

    identities = await db_rows(UserIdentity, user_id=rows[0].id)
    assert identities[0].provider == AuthProvider.APPLE


async def test_apple_nonce_mismatch_rejected(pg_client, _rsa_key):
    sub = f"apple-sub-{uuid.uuid4().hex[:8]}"
    token = _mint(_rsa_key, _apple_claims(sub, "the-real-nonce"))
    resp = await pg_client.post(
        "/api/v1/auth/oauth/apple",
        json={"identity_token": token, "raw_nonce": "a-different-nonce"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or expired sign-in token"


async def test_apple_given_family_name_prefill_on_first_authorization(pg_client, _rsa_key, db_rows):
    sub = f"apple-sub-{uuid.uuid4().hex[:8]}"
    token = _mint(_rsa_key, _apple_claims(sub, "a-raw-nonce"))
    resp = await pg_client.post(
        "/api/v1/auth/oauth/apple",
        json={
            "identity_token": token,
            "raw_nonce": "a-raw-nonce",
            "given_name": "Ada",
            "family_name": "Lovelace",
        },
    )
    assert resp.status_code == 200, resp.text
    rows = await db_rows(User, email=f"{sub}@example.com")
    assert rows[0].full_name == "Ada Lovelace"


# ── Avatar sync from Google's `picture` claim (Isaac's explicit decision:
# first account creation ONLY — never auto-link, never a repeat sign-in) ────
_PICTURE_URL = "https://photos.example.invalid/pic.jpg"


class _RecordingPictureHandler:
    """Canned handler for the outbound picture fetch — same shape as
    `test_oauth_jwks.py`'s `_RecordingHandler`, just wired onto
    `oauth_service`'s `httpx` instead of `oauth`'s. `calls` lets a test prove
    the fetch was never even attempted (auto-link, Apple)."""

    def __init__(self):
        self.calls = 0
        self._next = lambda request: httpx.Response(
            200, content=b"\xff\xd8\xff-fake-jpeg-bytes", headers={"content-type": "image/jpeg"}
        )

    def respond_with(self, fn) -> None:
        self._next = fn

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        return self._next(request)


@pytest.fixture
def picture_handler(monkeypatch) -> _RecordingPictureHandler:
    rec = _RecordingPictureHandler()

    class _FakeHttpxModule:
        @staticmethod
        def AsyncClient(**kwargs):
            kwargs["transport"] = httpx.MockTransport(rec)
            return httpx.AsyncClient(**kwargs)

    monkeypatch.setattr(oauth_service_module, "httpx", _FakeHttpxModule())
    return rec


def _image_response(
    content_type: str = "image/jpeg", body: bytes = b"\xff\xd8\xff-fake-jpeg-bytes"
):
    def fn(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body, headers={"content-type": content_type})

    return fn


def _network_failure_response():
    def fn(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("simulated network failure", request=request)

    return fn


class _SpyStorage:
    """Wraps whatever `Storage` backend `pg_client` already installed (a
    fresh `LocalStorage` per test, per conftest.py) and records every
    `put_object` call — lets a test assert bucket/key/content-type without
    `Storage` needing a new introspection method just for this suite."""

    def __init__(self, inner):
        self._inner = inner
        self.put_calls: list[tuple[str, str, bytes, str]] = []

    def put_object(self, bucket, key, data, content_type):
        self.put_calls.append((bucket, key, data, content_type))
        self._inner.put_object(bucket, key, data, content_type)

    def __getattr__(self, name):
        return getattr(self._inner, name)


@pytest.fixture
def storage_spy(pg_client) -> _SpyStorage:
    """Depends on `pg_client` explicitly so it installs its spy AFTER
    `pg_client`'s own fixture body has reset the storage singleton to a
    fresh `LocalStorage` — otherwise fixture ordering would be left to
    chance."""
    spy = _SpyStorage(storage_module.get_storage())
    storage_module.set_storage(spy)
    return spy


async def test_fresh_google_sign_up_syncs_avatar_from_picture(
    pg_client, _rsa_key, db_rows, picture_handler, storage_spy
):
    picture_handler.respond_with(_image_response())
    sub = f"google-sub-{uuid.uuid4().hex[:8]}"

    resp = await _google_sign_in(pg_client, _rsa_key, sub, picture=_PICTURE_URL)
    assert resp.status_code == 200, resp.text

    rows = await db_rows(User, email=f"{sub}@example.com")
    user = rows[0]
    assert user.avatar_key is not None
    assert user.avatar_key.startswith(f"avatars/{user.id}/")
    assert user.avatar_key.endswith(".jpg")

    assert len(storage_spy.put_calls) == 1
    bucket, key, data, content_type = storage_spy.put_calls[0]
    assert bucket == settings.object_store_media_bucket
    assert key == user.avatar_key
    assert content_type == "image/jpeg"
    assert data == b"\xff\xd8\xff-fake-jpeg-bytes"


async def test_fresh_google_sign_up_avatar_fetch_failure_does_not_block_signup(
    pg_client, _rsa_key, db_rows, picture_handler, storage_spy
):
    picture_handler.respond_with(_network_failure_response())
    sub = f"google-sub-{uuid.uuid4().hex[:8]}"

    resp = await _google_sign_in(pg_client, _rsa_key, sub, picture=_PICTURE_URL)
    assert resp.status_code == 200, resp.text

    rows = await db_rows(User, email=f"{sub}@example.com")
    assert rows[0].avatar_key is None
    assert storage_spy.put_calls == []


async def test_auto_link_does_not_sync_avatar_even_with_picture_claim(
    pg_client, _rsa_key, db_rows, picture_handler, storage_spy
):
    """Isaac's explicit, binding call: auto-link must NEVER touch an existing
    account's avatar, even if the linking Google identity carries a
    `picture` claim. The fetch must not even be attempted."""
    email = f"preexisting-avatar-{uuid.uuid4().hex[:8]}@example.com"
    reg = await pg_client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    assert reg.status_code == 201, reg.text

    picture_handler.respond_with(_image_response())
    sub = f"google-sub-{uuid.uuid4().hex[:8]}"
    link_resp = await _google_sign_in(pg_client, _rsa_key, sub, email=email, picture=_PICTURE_URL)
    assert link_resp.status_code == 200, link_resp.text

    rows = await db_rows(User, email=email)
    assert rows[0].avatar_key is None
    assert picture_handler.calls == 0
    assert storage_spy.put_calls == []


async def test_apple_sign_in_never_attempts_avatar_fetch(
    pg_client, _rsa_key, db_rows, picture_handler, storage_spy
):
    """Apple's identity token carries no `picture` claim, so
    `VerifiedIdentity.picture` is always None for Apple — confirms this
    naturally no-ops rather than attempting a fetch of anything."""
    sub = f"apple-sub-{uuid.uuid4().hex[:8]}"
    resp = await _apple_sign_in(pg_client, _rsa_key, sub)
    assert resp.status_code == 200, resp.text

    assert picture_handler.calls == 0
    assert storage_spy.put_calls == []
