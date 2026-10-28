"""Apple revocation seam: wire behaviour via httpx.MockTransport, client_secret JWT, stub."""

from __future__ import annotations

from collections.abc import Callable

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from structlog.testing import capture_logs

from app.core.apple_revocation import (
    AppleRevocationError,
    HttpAppleRevocationClient,
    StubAppleRevocationClient,
)

TEAM_ID = "TEAM123456"
KEY_ID = "KEY1234567"
CLIENT_ID = "com.example.app"
NOW = 1_800_000_000


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


def _ok_exchange() -> httpx.Response:
    return httpx.Response(200, json={"refresh_token": "rt-secret", "access_token": "at"})


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

    assert await client.revoke_authorization("the-code") is None

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
    await client.revoke_authorization("c")
    assert {(r.url.scheme, r.url.host) for r in wire.requests} == {("https", "appleid.apple.com")}


def test_timeout_is_five_seconds(make) -> None:
    client, _ = make()
    assert client._timeout == httpx.Timeout(5.0)


async def test_exchange_invalid_grant(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_err(400, "invalid_grant")]
    with pytest.raises(AppleRevocationError) as exc:
        await client.revoke_authorization("spent")
    assert exc.value.reason == "invalid_grant"
    assert wire.count("/auth/revoke") == 0


async def test_exchange_invalid_client_is_misconfigured(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_err(400, "invalid_client")]
    with pytest.raises(AppleRevocationError) as exc:
        await client.revoke_authorization("c")
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
        await client.revoke_authorization("c")
    assert exc.value.reason == "unavailable"
    assert wire.count("/auth/token") == 1
    assert wire.count("/auth/revoke") == 0


async def test_revoke_5xx_twice_is_unavailable_with_exactly_two_calls(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [httpx.Response(500), httpx.Response(502)]
    with pytest.raises(AppleRevocationError) as exc:
        await client.revoke_authorization("c")
    assert exc.value.reason == "unavailable"
    assert wire.count("/auth/revoke") == 2
    assert wire.count("/auth/token") == 1


async def test_revoke_5xx_then_200_succeeds(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [httpx.Response(500), httpx.Response(200)]
    await client.revoke_authorization("c")
    assert wire.count("/auth/revoke") == 2
    assert wire.count("/auth/token") == 1


async def test_revoke_timeout_then_200_succeeds(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [httpx.ReadTimeout("slow"), httpx.Response(200)]
    await client.revoke_authorization("c")
    assert wire.count("/auth/revoke") == 2


async def test_revoke_network_error_twice_is_unavailable(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [httpx.ConnectError("a"), httpx.ConnectError("b")]
    with pytest.raises(AppleRevocationError) as exc:
        await client.revoke_authorization("c")
    assert exc.value.reason == "unavailable"
    assert wire.count("/auth/revoke") == 2
    assert wire.count("/auth/token") == 1


async def test_already_revoked_200_is_success(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [httpx.Response(200, content=b"")]
    assert await client.revoke_authorization("c") is None


async def test_revoke_invalid_client_is_misconfigured_and_not_retried(make) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [_err(400, "invalid_client")]
    with pytest.raises(AppleRevocationError) as exc:
        await client.revoke_authorization("c")
    assert exc.value.reason == "misconfigured"
    assert wire.count("/auth/revoke") == 1


async def test_client_secret_jwt_claims_and_signature(make, keypair) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [httpx.Response(200)]
    await client.revoke_authorization("c")

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
        await client.revoke_authorization("c")

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
        await client.revoke_authorization("c")
    assert exc.value.reason == "misconfigured"
    assert wire.requests == []


async def test_secrets_never_logged(make, keypair) -> None:
    client, wire = make()
    wire.queues["/auth/token"] = [_ok_exchange()]
    wire.queues["/auth/revoke"] = [httpx.Response(500), httpx.Response(500)]
    with capture_logs() as logs, pytest.raises(AppleRevocationError):
        await client.revoke_authorization("code-123")
    rendered = repr(logs)
    assert logs, "expected warnings to be logged"
    assert wire.form("/auth/token")["client_secret"] not in rendered
    assert "rt-secret" not in rendered
    assert "code-123" not in rendered
    assert "PRIVATE KEY" not in rendered


async def test_stub_records_calls_and_replays_scripted_outcomes() -> None:
    stub = StubAppleRevocationClient()
    assert stub.calls == []
    await stub.revoke_authorization("a")  # unscripted: succeeds

    stub.script("unavailable", None, "invalid_grant")
    with pytest.raises(AppleRevocationError) as e1:
        await stub.revoke_authorization("b")
    assert e1.value.reason == "unavailable"
    await stub.revoke_authorization("c")
    with pytest.raises(AppleRevocationError) as e2:
        await stub.revoke_authorization("d")
    assert e2.value.reason == "invalid_grant"
    assert stub.calls == ["a", "b", "c", "d"]


async def test_stub_on_call_runs_before_outcome() -> None:
    seen: list[str] = []
    stub = StubAppleRevocationClient(["misconfigured"], on_call=seen.append)
    with pytest.raises(AppleRevocationError) as exc:
        await stub.revoke_authorization("x")
    assert exc.value.reason == "misconfigured"
    assert seen == ["x"]
