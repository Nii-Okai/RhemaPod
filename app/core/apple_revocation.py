"""Apple "Sign in with Apple" token revocation seam.

Account deletion must revoke the user's Apple grant (App Store Guideline 5.1.1(v)). The
single-use ``authorization_code`` from the client is exchanged for a refresh token at
``/auth/token``, which is then revoked at ``/auth/revoke``.

Two implementations sit behind the :class:`AppleRevocationClient` Protocol:

* :class:`HttpAppleRevocationClient` — talks to ``https://appleid.apple.com``.
* :class:`StubAppleRevocationClient` — records calls and replays scripted outcomes (dev/test).

Retry policy lives here, not in the caller: the code exchange is never retried (the code is
single-use), the revoke call is retried once on 5xx / network failure / timeout.

Secrets (the ES256 ``client_secret``, the code, the refresh token) are minted/held in memory
for the duration of one call and are never logged.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Iterable
from typing import Any, Final, Literal, Protocol

import httpx
import jwt

from app.core.logging import get_logger

log = get_logger("apple_revocation")

APPLE_BASE_URL: Final = "https://appleid.apple.com"
APPLE_AUDIENCE: Final = "https://appleid.apple.com"
REQUEST_TIMEOUT_SECONDS: Final = 5.0
CLIENT_SECRET_TTL_SECONDS: Final = 300  # Apple allows up to 6 months; we keep it at 5 min.
REVOKE_ATTEMPTS: Final = 2  # one try + one retry

AppleRevocationReason = Literal["invalid_grant", "unavailable", "misconfigured"]

# Apple error codes that mean our credentials/config are wrong, not the user's code.
_MISCONFIGURED_ERRORS: Final = frozenset({"invalid_client", "unauthorized_client"})


class AppleRevocationError(Exception):
    """Revocation failed. ``reason`` drives the HTTP mapping done by the router."""

    def __init__(self, reason: AppleRevocationReason, message: str | None = None) -> None:
        self.reason: AppleRevocationReason = reason
        super().__init__(message or reason)


class AppleRevocationClient(Protocol):
    async def revoke_authorization(self, authorization_code: str) -> None:
        """Exchange ``authorization_code`` and revoke the resulting refresh token.

        Raises :class:`AppleRevocationError` on any failure.
        """
        ...


def _error_code(response: httpx.Response) -> str | None:
    """Apple's ``{"error": "..."}`` code, or None when the body isn't that shape."""
    try:
        body = response.json()
    except ValueError:
        return None
    if isinstance(body, dict):
        code = body.get("error")
        if isinstance(code, str):
            return code
    return None


class HttpAppleRevocationClient:
    def __init__(
        self,
        *,
        team_id: str,
        key_id: str,
        private_key: str,
        client_id: str,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._team_id = team_id
        self._key_id = key_id
        self._private_key = private_key
        self._client_id = client_id
        self._transport = transport
        self._clock = clock
        self._timeout = httpx.Timeout(REQUEST_TIMEOUT_SECONDS)

    def _mint_client_secret(self) -> str:
        """ES256 JWT Apple accepts as ``client_secret``. In memory only, minted per call."""
        now = int(self._clock())
        claims = {
            "iss": self._team_id,
            "sub": self._client_id,
            "aud": APPLE_AUDIENCE,
            "iat": now,
            "exp": now + CLIENT_SECRET_TTL_SECONDS,
        }
        try:
            return jwt.encode(
                claims, self._private_key, algorithm="ES256", headers={"kid": self._key_id}
            )
        except (ValueError, TypeError, jwt.PyJWTError) as exc:
            # Unusable key material is a deployment fault. Never include the key in the log.
            log.error("apple_client_secret_mint_failed", error_type=type(exc).__name__)
            raise AppleRevocationError("misconfigured") from exc

    async def revoke_authorization(self, authorization_code: str) -> None:
        client_secret = self._mint_client_secret()
        async with httpx.AsyncClient(
            base_url=APPLE_BASE_URL, timeout=self._timeout, transport=self._transport
        ) as http:
            refresh_token = await self._exchange_code(http, authorization_code, client_secret)
            await self._revoke_token(http, refresh_token, client_secret)

    async def _exchange_code(
        self, http: httpx.AsyncClient, authorization_code: str, client_secret: str
    ) -> str:
        # Never retried: the authorization code is single-use.
        try:
            response = await http.post(
                "/auth/token",
                data={
                    "grant_type": "authorization_code",
                    "code": authorization_code,
                    "client_id": self._client_id,
                    "client_secret": client_secret,
                },
            )
        except httpx.HTTPError as exc:
            log.warning("apple_exchange_network_error", error_type=type(exc).__name__)
            raise AppleRevocationError("unavailable") from exc

        if response.status_code == 200:
            try:
                body = response.json()
            except ValueError:
                body = None
            token = body.get("refresh_token") if isinstance(body, dict) else None
            if isinstance(token, str) and token:
                return token
            log.warning("apple_exchange_malformed_response")
            raise AppleRevocationError("unavailable")

        self._raise_for_failure("exchange", response)
        raise AssertionError("unreachable")  # pragma: no cover - _raise_for_failure always raises

    async def _revoke_token(
        self, http: httpx.AsyncClient, refresh_token: str, client_secret: str
    ) -> None:
        last_failure: AppleRevocationError | None = None
        for attempt in range(1, REVOKE_ATTEMPTS + 1):
            try:
                response = await http.post(
                    "/auth/revoke",
                    data={
                        "token": refresh_token,
                        "token_type_hint": "refresh_token",
                        "client_id": self._client_id,
                        "client_secret": client_secret,
                    },
                )
            except httpx.HTTPError as exc:
                log.warning(
                    "apple_revoke_network_error",
                    attempt=attempt,
                    error_type=type(exc).__name__,
                )
                last_failure = AppleRevocationError("unavailable")
                last_failure.__cause__ = exc
                continue

            # 200 is success, including for an already-revoked token.
            if response.status_code == 200:
                return
            if response.status_code >= 500:
                log.warning("apple_revoke_server_error", attempt=attempt, status=response.status_code)
                last_failure = AppleRevocationError("unavailable")
                continue
            self._raise_for_failure("revoke", response)

        assert last_failure is not None
        raise last_failure

    @staticmethod
    def _raise_for_failure(stage: str, response: httpx.Response) -> None:
        code = _error_code(response)
        status = response.status_code
        if code in _MISCONFIGURED_ERRORS:
            log.error("apple_revocation_misconfigured", stage=stage, status=status, apple_error=code)
            raise AppleRevocationError("misconfigured")
        if stage == "exchange" and status == 400 and code == "invalid_grant":
            raise AppleRevocationError("invalid_grant")
        # 5xx and any unrecognised 4xx: treat as transient so the user can retry or use the
        # support path rather than being told their (possibly valid) code is bad.
        log.warning("apple_revocation_unavailable", stage=stage, status=status, apple_error=code)
        raise AppleRevocationError("unavailable")


class StubAppleRevocationClient:
    """Records calls; replays scripted outcomes in order, then succeeds.

    ``outcomes`` items are ``None`` (success) or an :class:`AppleRevocationError` reason.
    ``on_call`` (optional, sync or async-free) runs before the outcome is applied, letting tests
    snapshot state at the moment revocation is attempted.
    """

    def __init__(
        self,
        outcomes: Iterable[AppleRevocationReason | None] = (),
        *,
        on_call: Callable[[str], Any] | None = None,
    ) -> None:
        self.calls: list[str] = []
        self._outcomes = list(outcomes)
        self._on_call = on_call

    def script(self, *outcomes: AppleRevocationReason | None) -> None:
        self._outcomes.extend(outcomes)

    async def revoke_authorization(self, authorization_code: str) -> None:
        self.calls.append(authorization_code)
        if self._on_call is not None:
            result = self._on_call(authorization_code)
            if hasattr(result, "__await__"):
                await result
        outcome = self._outcomes.pop(0) if self._outcomes else None
        if outcome is not None:
            raise AppleRevocationError(outcome)


_client: AppleRevocationClient | None = None


def get_apple_revocation_client() -> AppleRevocationClient:
    """Return the active revocation client (singleton), resolved at startup.

    Mirrors `get_storage()`: `http` builds the real client from settings,
    otherwise the recording stub so dev/test need no Apple account. Also the
    FastAPI dependency, so tests override it via `app.dependency_overrides`.
    """
    global _client
    if _client is None:
        from app.core.config import get_settings

        s = get_settings()
        if s.apple_revocation_backend == "http":
            if not (s.apple_key_id and s.apple_private_key and s.apple_client_id):
                raise AppleRevocationError("misconfigured")
            _client = HttpAppleRevocationClient(
                team_id=s.apple_team_id,
                key_id=s.apple_key_id,
                private_key=s.apple_private_key.get_secret_value(),
                client_id=s.apple_client_id,
            )
            log.info("apple_revocation_backend", backend="http", live=True)
        elif s.is_production and s.oauth_apple_enabled:
            # Belt-and-braces: production_preflight already blocks this.
            raise AppleRevocationError("misconfigured")
        else:
            _client = StubAppleRevocationClient()
            log.warning("apple_revocation_backend", backend="stub", live=False)
    return _client


def set_apple_revocation_client(client: AppleRevocationClient | None) -> None:
    """Override the client (used by tests)."""
    global _client
    _client = client
