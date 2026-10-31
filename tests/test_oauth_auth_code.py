"""ADR 0015 addendum — Android "Sign in with Google" via one-time server auth
code, exchanged server-side at Google's token endpoint.

Real Postgres (Testcontainers, same fixtures as tests/test_oauth.py). Google's
token endpoint is never reached: `app.core.oauth.httpx` is swapped for a shim
whose `AsyncClient` is backed by `httpx.MockTransport` (same pattern as
tests/test_oauth_jwks.py). Exchanged ID tokens are signed with the suite's
local RSA key and verified through the real verification path.
"""
from __future__ import annotations

import time
import uuid
from urllib.parse import parse_qs

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import select

import app.core.oauth as oauth_module
from app.core.config import get_settings
from app.models.models import AuthProvider, User, UserIdentity
from tests.comments_pg import (  # noqa: F401
    capture_logs,
    db_rows,
    make_user,
    pg_client,
    pg_engine,
    pg_migrated_db,
    pg_server,
    sessions,
)
from tests.test_oauth import (  # noqa: F401  (autouse JWKS wiring + token helpers)
    _GOOGLE_AUD,
    _google_claims,
    _mint,
    _rsa_key,
    _wire_static_jwks,
)

pytestmark = pytest.mark.asyncio

settings = get_settings()
SIGN_IN = "/api/v1/auth/oauth/google"
SECRET = "GOCSPX-test-secret-do-not-log"
CODE = "4/0AtestServerAuthCode-do-not-log"
REFRESH = "1//refresh-token-do-not-log"
ACCESS = "ya29.access-token-do-not-log"


class _Exchange:
    """Programmable fake of Google's token endpoint."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.client_kwargs: list[dict] = []
        self.responder = lambda request: httpx.Response(500)

    def respond_with_token(self, id_token: str) -> None:
        self.responder = lambda request: httpx.Response(
            200,
            json={"id_token": id_token, "refresh_token": REFRESH, "access_token": ACCESS,
                  "token_type": "Bearer", "expires_in": 3599},
        )

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.responder(request)


@pytest.fixture
def exchange(monkeypatch):
    ex = _Exchange()

    class _HttpxShim:
        @staticmethod
        def AsyncClient(**kwargs):
            ex.client_kwargs.append({k: v for k, v in kwargs.items() if k != "transport"})
            kwargs["transport"] = httpx.MockTransport(ex)
            return httpx.AsyncClient(**kwargs)

        def __getattr__(self, name):
            return getattr(httpx, name)

    monkeypatch.setattr(oauth_module, "httpx", _HttpxShim())
    monkeypatch.setattr(settings, "oauth_google_auth_code_enabled", True)
    monkeypatch.setattr(settings, "google_oauth_web_client_id", _GOOGLE_AUD)
    monkeypatch.setattr(settings, "google_oauth_client_secret", SecretStr(SECRET))
    return ex


def _id_token(key, sub: str, **overrides) -> str:
    return _mint(key, _google_claims(sub, **overrides))


async def _sign_in_with_code(c, code: str = CODE):
    return await c.post(SIGN_IN, json={"server_auth_code": code})


async def test_exchange_request_shape(pg_client, exchange, _rsa_key):
    exchange.respond_with_token(_id_token(_rsa_key, f"g-{uuid.uuid4().hex[:8]}"))
    r = await _sign_in_with_code(pg_client)
    assert r.status_code == 200, r.text
    (req,) = exchange.requests
    assert req.method == "POST"
    assert str(req.url) == "https://oauth2.googleapis.com/token"
    assert req.headers["content-type"] == "application/x-www-form-urlencoded"
    form = parse_qs(req.content.decode(), keep_blank_values=True)
    assert form == {
        "code": [CODE],
        "client_id": [_GOOGLE_AUD],
        "client_secret": [SECRET],
        "redirect_uri": [""],
        "grant_type": ["authorization_code"],
    }
    (kwargs,) = exchange.client_kwargs
    assert kwargs["follow_redirects"] is False and kwargs["timeout"] == 10


async def test_code_sign_in_creates_then_reuses_user(pg_client, exchange, _rsa_key, sessions):
    sub = f"g-{uuid.uuid4().hex[:8]}"
    exchange.respond_with_token(_id_token(_rsa_key, sub))
    first = await _sign_in_with_code(pg_client, "code-1")
    assert first.status_code == 200, first.text
    assert first.json()["access_token"] and first.json()["refresh_token"]
    # Google issues a fresh id_token (new iat/exp) for the next code.
    exchange.respond_with_token(_id_token(_rsa_key, sub, iat=int(time.time()) + 1))
    second = await _sign_in_with_code(pg_client, "code-2")
    assert second.status_code == 200, second.text
    async with sessions() as s:
        rows = (await s.execute(
            select(UserIdentity).where(
                UserIdentity.provider == AuthProvider.GOOGLE,
                UserIdentity.provider_subject == sub,
            )
        )).scalars().all()
        assert len(rows) == 1
        assert (await s.get(User, rows[0].user_id)) is not None


async def test_replayed_exchanged_id_token_is_401(pg_client, exchange, _rsa_key):
    exchange.respond_with_token(_id_token(_rsa_key, f"g-{uuid.uuid4().hex[:8]}"))
    assert (await _sign_in_with_code(pg_client, "code-1")).status_code == 200
    again = await _sign_in_with_code(pg_client, "code-2")
    assert again.status_code == 401
    assert again.json()["detail"] == "Invalid or expired sign-in token"


async def test_id_token_only_still_works_without_exchange(pg_client, exchange, _rsa_key):
    token = _id_token(_rsa_key, f"g-{uuid.uuid4().hex[:8]}")
    r = await pg_client.post(SIGN_IN, json={"id_token": token})
    assert r.status_code == 200, r.text
    assert exchange.requests == []


async def test_invalid_grant_is_401(pg_client, exchange):
    exchange.responder = lambda req: httpx.Response(400, json={"error": "invalid_grant"})
    r = await _sign_in_with_code(pg_client)
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid or expired sign-in token"


@pytest.mark.parametrize("google_error", ["invalid_client", "unauthorized_client",
                                          "redirect_uri_mismatch", "something_else"])
async def test_misconfig_4xx_is_503_with_error_log(pg_client, exchange, capture_logs, google_error):
    exchange.responder = lambda req: httpx.Response(
        401 if google_error == "invalid_client" else 400, json={"error": google_error}
    )
    r = await _sign_in_with_code(pg_client)
    assert r.status_code == 503
    errors = [e for e in capture_logs.records if e["level"] == "error"]
    assert any(e["event"] == "google_code_exchange_failed"
               and e.get("google_error") == google_error for e in errors)


@pytest.mark.parametrize("responder", [
    lambda req: httpx.Response(500, text="boom"),
    lambda req: httpx.Response(503, json={"error": "backend_error"}),
    lambda req: httpx.Response(302, headers={"location": "https://evil.example/token"}),
    lambda req: httpx.Response(200, text="<html>not json</html>"),
    lambda req: httpx.Response(200, json={"access_token": ACCESS}),  # no id_token
    lambda req: httpx.Response(200, json=["id_token"]),
    lambda req: httpx.Response(400, text="not json"),
], ids=["500", "503", "redirect", "non-json", "no-id-token", "json-list", "400-non-json"])
async def test_unavailable_variants_are_503(pg_client, exchange, responder):
    exchange.responder = responder
    assert (await _sign_in_with_code(pg_client)).status_code == 503
    assert len(exchange.requests) == 1  # redirect was not followed


@pytest.mark.parametrize("exc", [httpx.ConnectError("down"), httpx.ReadTimeout("slow")])
async def test_network_failure_is_503(pg_client, exchange, exc):
    def boom(req):
        raise exc

    exchange.responder = boom
    assert (await _sign_in_with_code(pg_client)).status_code == 503


async def test_exchanged_token_failing_verification_is_rejected(pg_client, exchange, _rsa_key):
    exchange.respond_with_token(_id_token(_rsa_key, "g-x", aud="someone-elses-client"))
    r = await _sign_in_with_code(pg_client)
    assert r.status_code == 401


async def test_flag_off_is_503_and_makes_no_request(pg_client, exchange, monkeypatch):
    monkeypatch.setattr(settings, "oauth_google_auth_code_enabled", False)
    r = await _sign_in_with_code(pg_client)
    assert r.status_code == 503
    assert exchange.requests == []


@pytest.mark.parametrize("body", [
    {},
    {"id_token": "a.b.c", "server_auth_code": "code"},
    {"server_auth_code": ""},
    {"id_token": None, "server_auth_code": None},
    {"server_auth_code": "x" * 2049},
])
async def test_exactly_one_proof_is_required(pg_client, exchange, body):
    r = await pg_client.post(SIGN_IN, json=body)
    assert r.status_code == 422
    assert exchange.requests == []


async def test_validation_message_names_both_fields(pg_client):
    r = await pg_client.post(SIGN_IN, json={})
    assert "id_token" in r.text and "server_auth_code" in r.text


async def test_secret_code_and_tokens_never_logged(pg_client, exchange, capture_logs, _rsa_key, caplog):
    # success, invalid_grant and misconfig paths all in one capture
    exchange.respond_with_token(_id_token(_rsa_key, f"g-{uuid.uuid4().hex[:8]}"))
    await _sign_in_with_code(pg_client, CODE)
    exchange.responder = lambda req: httpx.Response(
        400, json={"error": "invalid_client", "error_description": f"{SECRET} {CODE}",
                   "refresh_token": REFRESH, "access_token": ACCESS})
    await _sign_in_with_code(pg_client, CODE)
    exchange.responder = lambda req: httpx.Response(400, json={"error": "invalid_grant"})
    await _sign_in_with_code(pg_client, CODE)
    text = capture_logs.text() + caplog.text
    for needle in (SECRET, CODE, REFRESH, ACCESS):
        assert needle not in text


def test_log_redaction_keys_cover_new_secrets():
    from app.core.logging import SENSITIVE_LOG_KEYS

    assert {"server_auth_code", "google_oauth_client_secret", "client_secret"} <= SENSITIVE_LOG_KEYS
