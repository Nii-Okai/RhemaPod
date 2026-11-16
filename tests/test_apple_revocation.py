"""Apple revocation seam: wire behaviour via httpx.MockTransport, client_secret JWT, stub."""

from __future__ import annotations

import io
import json
import time
from collections.abc import Callable

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from jwt import PyJWK
from jwt.algorithms import RSAAlgorithm
from pydantic import SecretStr
from structlog.testing import capture_logs

from app.core import oauth as oauth_module
from app.core.apple_revocation import (
    AppleRevocationError,
    HttpAppleRevocationClient,
    StubAppleRevocationClient,
)

_RSA = rsa.generate_private_key(public_exponent=65537, key_size=2048)
TEAM_ID = "TEAM123456"
KEY_ID = "KEY1234567"
CLIENT_ID = "com.example.app"
NOW = 1_800_000_000
SUB = "apple-sub-001"
_KID = "test-kid"


@pytest.fixture(scope="module")
def keypair() -> tuple[str, str]:
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public = (
        key.public_key()
        .public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        .decode()
    )
    return private, public


class Wire:
    """Scripted Apple: per-path queue of responses/exceptions; records every request."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.queues: dict[str, list[httpx.Response | Exception]] = {
            "/auth/token": [],
            "/auth/revoke": [],
        }

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        item = self.queues[request.url.path].pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def count(self, path: str) -> int:
        return sum(1 for r in self.requests if r.url.path == path)

    def form(self, path: str, index: int = 0) -> dict[str, str]:
        reqs = [r for r in self.requests if r.url.path == path]
        return dict(httpx.QueryParams(reqs[index].content.decode()))


def _id_token(sub: str = SUB, **overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": "https://appleid.apple.com",
        "aud": CLIENT_ID,
        "sub": sub,
        "iat": now,
        "exp": now + 600,
        **overrides,
    }
    return jwt.encode(claims, _RSA, algorithm="RS256", headers={"kid": _KID})


def _ok_exchange(id_token: str | None = ...) -> httpx.Response:
    body = {"refresh_token": "rt-secret", "access_token": "at"}
    token = _id_token() if id_token is ... else id_token
    if token is not None:
        body["id_token"] = token
    return httpx.Response(200, json=body)


@pytest.fixture(autouse=True)
def _apple_jwks(monkeypatch):
    jwk = json.loads(RSAAlgorithm.to_jwk(_RSA.public_key()))
    jwk.update(kid=_KID, alg="RS256")
    static = oauth_module.StaticJwksProvider({_KID: PyJWK.from_dict(jwk)})
    monkeypatch.setattr(oauth_module.APPLE, "jwks_provider", static)


def _err(status: int, error: str) -> httpx.Response:
    return httpx.Response(status, json={"error": error})


@pytest.fixture
def make(keypair: tuple[str, str]) -> Callable[..., tuple[HttpAppleRevocationClient, Wire]]:
    def _make(clock: Callable[[], float] = lambda: NOW) -> tuple[HttpAppleRevocationClient, Wire]:
        wire = Wire()
        client = HttpAppleRevocationClient(
            team_id=TEAM_ID,
            key_id=KEY_ID,
            private_key=keypair[0],
            client_id=CLIENT_ID,
            transport=httpx.MockTransport(wire.handler),
            clock=clock,
        )
        return client, wire

    return _make


async def test_success_exchanges_then_revokes(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [httpx.Response(200)]

    assert await client.revoke_authorization("the-code", expected_sub=SUB) is None

    assert [r.url.path for r in wire.requests] == ["/auth/token", "/auth/revoke"]
    token_form = wire.form("/auth/token")
    assert token_form["grant_type"] == "authorization_code"
    assert token_form["code"] == "the-code"
    assert token_form["client_id"] == CLIENT_ID
    assert token_form["client_secret"]
    revoke_form = wire.form("/auth/revoke")
    assert revoke_form["token"] == "rt-secret"
    assert revoke_form["token_type_hint"] == "refresh_token"
    assert revoke_form["client_id"] == CLIENT_ID
    assert revoke_form["client_secret"]


async def test_requests_only_go_to_apple(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [httpx.Response(200)]
    await client.revoke_authorization("c", expected_sub=SUB)
    assert {(r.url.scheme, r.url.host) for r in wire.requests} == {("https", "appleid.apple.com")}


def test_timeout_is_five_seconds(make) -> None:
    client, _ = make()
    assert client._timeout == httpx.Timeout(5.0)


async def test_exchange_invalid_grant(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_err(400, "invalid_grant")]
    with pytest.raises(AppleRevocationError) as exc:
        await client.revoke_authorization("spent", expected_sub=SUB)
    assert exc.value.reason == "invalid_grant"
    assert wire.count("/auth/revoke") == 0


async def test_exchange_invalid_client_is_misconfigured(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_err(400, "invalid_client")]
    with pytest.raises(AppleRevocationError) as exc:
        await client.revoke_authorization("c", expected_sub=SUB)
    assert exc.value.reason == "misconfigured"
    assert wire.count("/auth/revoke") == 0


@pytest.mark.parametrize(
    "failure",
    [
        httpx.Response(503),
        httpx.ConnectError("boom"),
        httpx.ReadTimeout("slow"),
        httpx.Response(200, json={"access_token": "x"}),  # no refresh_token
        httpx.Response(200, content=b"not json"),
        httpx.Response(400, content=b"not json"),  # unrecognised 4xx
    ],
    ids=["5xx", "network", "timeout", "no-refresh-token", "bad-json", "unknown-4xx"],
)
async def test_exchange_failures_are_unavailable_and_never_retried(make, failure) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [failure]
    with pytest.raises(AppleRevocationError) as exc:
        await client.revoke_authorization("c", expected_sub=SUB)
    assert exc.value.reason == "unavailable"
    assert wire.count("/auth/token") == 1
    assert wire.count("/auth/revoke") == 0


async def test_revoke_5xx_twice_is_unavailable_with_exactly_two_calls(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [httpx.Response(500), httpx.Response(502)]
    with pytest.raises(AppleRevocationError) as exc:
        await client.revoke_authorization("c", expected_sub=SUB)
    assert exc.value.reason == "unavailable"
    assert wire.count("/auth/revoke") == 2
    assert wire.count("/auth/token") == 1


async def test_revoke_5xx_then_200_succeeds(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [httpx.Response(500), httpx.Response(200)]
    await client.revoke_authorization("c", expected_sub=SUB)
    assert wire.count("/auth/revoke") == 2
    assert wire.count("/auth/token") == 1


async def test_revoke_timeout_then_200_succeeds(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [httpx.ReadTimeout("slow"), httpx.Response(200)]
    await client.revoke_authorization("c", expected_sub=SUB)
    assert wire.count("/auth/revoke") == 2


async def test_revoke_network_error_twice_is_unavailable(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [httpx.ConnectError("a"), httpx.ConnectError("b")]
    with pytest.raises(AppleRevocationError) as exc:
        await client.revoke_authorization("c", expected_sub=SUB)
    assert exc.value.reason == "unavailable"
    assert wire.count("/auth/revoke") == 2
    assert wire.count("/auth/token") == 1


async def test_already_revoked_200_is_success(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [httpx.Response(200, content=b"")]
    assert await client.revoke_authorization("c", expected_sub=SUB) is None


async def test_revoke_invalid_client_is_misconfigured_and_not_retried(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [_err(400, "invalid_client")]
    with pytest.raises(AppleRevocationError) as exc:
        await client.revoke_authorization("c", expected_sub=SUB)
    assert exc.value.reason == "misconfigured"
    assert wire.count("/auth/revoke") == 1


# ── check_credentials (app.scripts.check_apple_key) ─────────────────────────
async def test_check_credentials_passes_on_invalid_grant(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_err(400, "invalid_grant")]
    assert await client.check_credentials() is None
    assert wire.count("/auth/token") == 1 and wire.count("/auth/revoke") == 0
    assert wire.form("/auth/token")["client_secret"]


@pytest.mark.parametrize(
    ("response", "reason"),
    [
        (_err(400, "invalid_client"), "misconfigured"),
        (httpx.Response(503), "unavailable"),
        (httpx.Response(200, json={"refresh_token": "x"}), "misconfigured"),
    ],
    ids=["invalid-client", "5xx", "code-accepted"],
)
async def test_check_credentials_fails_otherwise_and_never_revokes(make, response, reason) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [response]
    with pytest.raises(AppleRevocationError) as exc:
        await client.check_credentials()
    assert exc.value.reason == reason
    assert wire.count("/auth/revoke") == 0


async def test_client_secret_jwt_claims_and_signature(make, keypair) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [httpx.Response(200)]
    await client.revoke_authorization("c", expected_sub=SUB)

    secret = wire.form("/auth/token")["client_secret"]
    header = jwt.get_unverified_header(secret)
    assert header["alg"] == "ES256"
    assert header["kid"] == KEY_ID
    claims = jwt.decode(
        secret,
        keypair[1],
        algorithms=["ES256"],
        audience="https://appleid.apple.com",
        options={"verify_iat": False, "verify_exp": False},
    )
    assert claims["iss"] == TEAM_ID
    assert claims["sub"] == CLIENT_ID
    assert claims["aud"] == "https://appleid.apple.com"
    assert claims["iat"] == NOW
    assert 0 < claims["exp"] - claims["iat"] <= 300
    # Same secret is used for both legs of one revocation.
    assert wire.form("/auth/revoke")["client_secret"] == secret


async def test_client_secret_is_minted_per_call(make) -> None:
    ticks = iter([NOW, NOW + 60])
    client, wire = make(clock=lambda: next(ticks))
    for _ in range(2):
        wire.queues["/auth/token"].append(_ok_exchange())
        wire.queues["/auth/revoke"].append(httpx.Response(200))
        await client.revoke_authorization("c", expected_sub=SUB)

    first = jwt.decode(wire.form("/auth/token", 0)["client_secret"], options={"verify_signature": False})
    second = jwt.decode(wire.form("/auth/token", 1)["client_secret"], options={"verify_signature": False})
    assert first["iat"] == NOW
    assert second["iat"] == NOW + 60


async def test_unusable_key_is_misconfigured_with_no_network_call() -> None:
    wire = Wire()
    client = HttpAppleRevocationClient(
        team_id=TEAM_ID,
        key_id=KEY_ID,
        private_key="not a pem",
        client_id=CLIENT_ID,
        transport=httpx.MockTransport(wire.handler),
    )
    with pytest.raises(AppleRevocationError) as exc:
        await client.revoke_authorization("c", expected_sub=SUB)
    assert exc.value.reason == "misconfigured"
    assert wire.requests == []


async def test_secrets_never_logged(make, keypair) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [httpx.Response(500), httpx.Response(500)]
    with capture_logs() as logs, pytest.raises(AppleRevocationError):
        await client.revoke_authorization("code-123", expected_sub=SUB)
    rendered = repr(logs)
    assert logs, "expected warnings to be logged"
    assert wire.form("/auth/token")["client_secret"] not in rendered
    assert "rt-secret" not in rendered
    assert "code-123" not in rendered
    assert "PRIVATE KEY" not in rendered


async def test_missing_id_token_is_invalid_grant_and_never_revokes(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange(None)]
    with pytest.raises(AppleRevocationError) as exc:
        await client.revoke_authorization("c", expected_sub=SUB)
    assert exc.value.reason == "invalid_grant"
    assert wire.count("/auth/revoke") == 0


async def test_id_token_sub_mismatch_is_invalid_grant_and_never_revokes(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange(_id_token("someone-else"))]
    with pytest.raises(AppleRevocationError) as exc:
        await client.revoke_authorization("c", expected_sub=SUB)
    assert exc.value.reason == "invalid_grant"
    assert wire.count("/auth/revoke") == 0


@pytest.mark.parametrize("override", [{"aud": "com.other.app"}, {"iss": "https://evil.example"}, {"exp": 1}])
async def test_unverifiable_id_token_is_invalid_grant_and_never_revokes(make, override) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange(_id_token(**override))]
    with pytest.raises(AppleRevocationError) as exc:
        await client.revoke_authorization("c", expected_sub=SUB)
    assert exc.value.reason == "invalid_grant"
    assert wire.count("/auth/revoke") == 0


async def test_stub_scripted_sub_mismatch_is_invalid_grant() -> None:
    stub = StubAppleRevocationClient(returned_sub="other")
    with pytest.raises(AppleRevocationError) as exc:
        await stub.revoke_authorization("x", expected_sub=SUB)
    assert exc.value.reason == "invalid_grant"
    assert stub.expected_subs == [SUB]


async def test_stub_records_calls_and_replays_scripted_outcomes() -> None:
    stub = StubAppleRevocationClient()
    assert stub.calls == []
    await stub.revoke_authorization("a", expected_sub=SUB)  # unscripted: succeeds

    stub.script("unavailable", None, "invalid_grant")
    with pytest.raises(AppleRevocationError) as e1:
        await stub.revoke_authorization("b", expected_sub=SUB)
    assert e1.value.reason == "unavailable"
    await stub.revoke_authorization("c", expected_sub=SUB)
    with pytest.raises(AppleRevocationError) as e2:
        await stub.revoke_authorization("d", expected_sub=SUB)
    assert e2.value.reason == "invalid_grant"
    assert stub.calls == ["a", "b", "c", "d"]


async def test_stub_on_call_runs_before_outcome() -> None:
    seen: list[str] = []
    stub = StubAppleRevocationClient(["misconfigured"], on_call=seen.append)
    with pytest.raises(AppleRevocationError) as exc:
        await stub.revoke_authorization("x", expected_sub=SUB)
    assert exc.value.reason == "misconfigured"
    assert seen == ["x"]


# ── D5: settings, startup resolution, log redaction ───────────────────────────


def _p256_pem() -> str:
    return (
        ec.generate_private_key(ec.SECP256R1())
        .private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        .decode()
    )


def _fresh_settings(**kw):
    from app.core.config import Settings

    return Settings(**kw)


def test_settings_defaults() -> None:
    s = _fresh_settings()
    assert s.apple_revocation_backend == "stub"
    assert s.apple_team_id == "FAND2W5VMM"
    assert s.apple_key_id is None
    assert s.apple_private_key is None
    assert s.account_deletion_reauth_max_age_seconds == 300
    assert s.account_delete_rate_limit == 5
    assert s.account_delete_rate_window_seconds == 3600
    assert s.apple_client_id == s.apple_oauth_audiences[0]


def test_client_id_explicit_wins_over_audience_default() -> None:
    s = _fresh_settings(apple_client_id="com.example.other")
    assert s.apple_client_id == "com.example.other"


def test_unknown_backend_rejected() -> None:
    with pytest.raises(ValueError, match="apple_revocation_backend"):
        _fresh_settings(apple_revocation_backend="mock")


def test_private_key_is_secret_and_hidden_in_repr() -> None:
    pem = _p256_pem()
    s = _fresh_settings(apple_private_key=pem)
    assert "BEGIN PRIVATE KEY" not in repr(s)
    assert "BEGIN PRIVATE KEY" not in str(s.apple_private_key)
    assert s.apple_private_key.get_secret_value().startswith("-----BEGIN PRIVATE KEY-----\n")


def test_private_key_accepts_real_multiline_pem() -> None:
    from app.core.config import assert_ec_p256_pem

    pem = _p256_pem()
    s = _fresh_settings(apple_private_key=pem)
    got = s.apple_private_key.get_secret_value()
    assert got == pem.strip()
    assert_ec_p256_pem(got)


def test_private_key_accepts_single_line_with_literal_backslash_n() -> None:
    from app.core.config import assert_ec_p256_pem

    pem = _p256_pem()
    escaped = pem.strip().replace("\n", "\\n")
    assert "\n" not in escaped and "\\n" in escaped  # truly one line
    s = _fresh_settings(apple_private_key=escaped)
    got = s.apple_private_key.get_secret_value()
    assert got == pem.strip()
    assert_ec_p256_pem(got)


def test_private_key_single_line_works_from_env(monkeypatch) -> None:
    """The DEPLOYMENT.md §13 form: one double-quoted line, literal \\n."""
    pem = _p256_pem()
    monkeypatch.setenv("APPLE_PRIVATE_KEY", pem.strip().replace("\n", "\\n"))
    assert _fresh_settings().apple_private_key.get_secret_value() == pem.strip()


def test_blank_private_key_is_unset(monkeypatch) -> None:
    monkeypatch.setenv("APPLE_PRIVATE_KEY", "")
    assert _fresh_settings().apple_private_key is None


@pytest.fixture
def reset_client():
    from app.core import apple_revocation as mod

    mod.set_apple_revocation_client(None)
    yield mod
    mod.set_apple_revocation_client(None)


def test_dev_boot_resolves_stub_with_live_false_warning(reset_client) -> None:
    with capture_logs() as logs:
        client = reset_client.get_apple_revocation_client()
    assert isinstance(client, StubAppleRevocationClient)
    assert any(
        e["event"] == "apple_revocation_backend"
        and e["log_level"] == "warning"
        and e["live"] is False
        for e in logs
    )
    assert reset_client.get_apple_revocation_client() is client  # singleton


def test_http_backend_resolves_http_client(reset_client, monkeypatch) -> None:
    from app.core.config import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "apple_revocation_backend", "http")
    monkeypatch.setattr(s, "apple_key_id", "ABC123DEFG")
    monkeypatch.setattr(s, "apple_private_key", SecretStr(_p256_pem()))
    assert isinstance(reset_client.get_apple_revocation_client(), HttpAppleRevocationClient)


def test_http_backend_without_key_is_misconfigured(reset_client, monkeypatch) -> None:
    from app.core.config import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "apple_revocation_backend", "http")
    monkeypatch.setattr(s, "apple_key_id", None)
    with pytest.raises(AppleRevocationError) as exc:
        reset_client.get_apple_revocation_client()
    assert exc.value.reason == "misconfigured"


SENSITIVE = [
    "client_secret",
    "authorization_code",
    "identity_token",
    "id_token",
    "refresh_token",
    "access_token",
    "apple_private_key",
    "password",
    "raw_nonce",
    "token",
    "secret",
    "authorization",
]


def _render(**event) -> str:
    """Run the redaction processor then JSON-render, like configure_logging."""
    from app.core.logging import redact_sensitive_keys

    out = redact_sensitive_keys(None, "info", {"event": "x", **event})
    return json.dumps(out)


@pytest.mark.parametrize("key", SENSITIVE)
@pytest.mark.parametrize(
    "shape",
    ["top", "nested_dict", "list_of_dicts", "case_variant"],
)
def test_redaction_processor(key: str, shape: str) -> None:
    secret = "s3cr3t-value-123"
    if shape == "top":
        rendered = _render(**{key: secret})
    elif shape == "nested_dict":
        rendered = _render(outer={"inner": {key: secret}})
    elif shape == "list_of_dicts":
        rendered = _render(items=[{"ok": 1}, {key: secret}])
    else:
        rendered = _render(**{key.upper(): secret, "Nested": {key.title(): secret}})
    assert secret not in rendered
    assert "[REDACTED]" in rendered


def test_redaction_leaves_other_keys_untouched() -> None:
    out = json.loads(_render(user_id="u1", detail={"status": 400, "client_id": "c"}))
    assert out["user_id"] == "u1"
    assert out["detail"] == {"status": 400, "client_id": "c"}
    assert "[REDACTED]" not in json.dumps(out)


def test_configure_logging_installs_redaction_end_to_end() -> None:
    import structlog

    from app.core.logging import configure_logging

    saved = structlog.get_config()
    buf = io.StringIO()
    try:
        configure_logging(log_level="INFO", json_logs=True)
        structlog.configure(logger_factory=structlog.PrintLoggerFactory(file=buf))
        structlog.get_logger("redaction-e2e").info(
            "e2e", authorization_code="CODE-xyz", nested={"refresh_token": "RT-abc"}
        )
    finally:
        structlog.configure(**saved)
    line = json.loads(buf.getvalue().strip())
    assert line["authorization_code"] == "[REDACTED]"
    assert line["nested"]["refresh_token"] == "[REDACTED]"
    assert "CODE-xyz" not in buf.getvalue() and "RT-abc" not in buf.getvalue()
