"""Provider-token verification for "Sign in with Google" / "Sign in with
Apple" (ADR 0015).

Deliberately NOT `pyjwt`'s own `PyJWKClient` — it fetches keys via blocking
`urllib`, which would stall the event loop on every cache miss. This module
re-implements the same "fetch the provider's JWKS, cache it, verify the RS256
signature against the right key" shape with `httpx.AsyncClient` instead (the
same library `app/core/stream.py` already uses for its own outbound calls).

One generic verifier (`_verify_token` + `ProviderConfig`) is shared by both
providers; `verify_google_id_token` / `verify_apple_identity_token` are thin,
provider-specific wrappers around it. Google and Apple diverge only in:
issuer, audience source, and Apple's extra nonce check (its ID token embeds
`sha256(raw_nonce)`; Google's client libraries may not even surface a raw
nonce today, so that check is a no-op there rather than an invented one).

Failure posture: an unknown/misconfigured `kid`, a bad signature, wrong
issuer/audience, or (Apple) a nonce mismatch are all `OAuthTokenError`
instances the router maps to a stable HTTP response — see the table in
`app/api/auth.py`. A JWKS fetch failing with nothing already cached is the one
case that is NOT the caller's fault (`reason="unavailable"`) — the router
maps that to 503, never a false-accept.
"""
from __future__ import annotations

import asyncio
import hashlib
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx
import jwt
from jwt import PyJWK

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.models import AuthProvider

settings = get_settings()
log = get_logger("oauth")

# Reasons `OAuthTokenError` can carry. `replayed` is produced by the router
# (via `token_store.claim_once`), not by this module — listed here only so
# the full set of values this field can hold lives in one place.
OAuthTokenErrorReason = str  # "invalid" | "audience_mismatch" | "replayed" | "unavailable"


class OAuthTokenError(Exception):
    """A provider ID/identity token failed verification, or its key could
    not be fetched at all. `reason` is what `app/api/auth.py` switches on to
    pick the HTTP response — never the raw exception message, which is for
    logs only."""

    def __init__(self, reason: OAuthTokenErrorReason, message: str):
        self.reason = reason
        super().__init__(message)


class JwksProvider(Protocol):
    async def get_key(self, kid: str) -> PyJWK: ...


@dataclass
class _CachedKeys:
    keys: dict[str, PyJWK]
    expires_at: float  # time.monotonic() deadline


class HttpJwksProvider:
    """Fetches a provider's JWKS over HTTPS via `httpx.AsyncClient` and
    caches it per-process.

    Cache lifetime honours the response's `Cache-Control: max-age` when
    present, else `settings.oauth_jwks_default_ttl_seconds` (1 hour default).
    An unknown `kid` against an otherwise-fresh cache forces exactly one
    re-fetch attempt, cooldown-gated (`_UNKNOWN_KID_COOLDOWN_SECONDS`) so a
    flood of bad/replayed tokens carrying random `kid`s can't force a
    re-fetch on every single request. Both the routine (cache-expired) and
    unknown-kid re-fetch paths are single-flighted behind `self._lock`, so
    concurrent callers never issue overlapping fetches.

    If a fetch fails and nothing is cached yet, this fails closed —
    `OAuthTokenError(reason="unavailable", ...)` — rather than a false
    accept or an unhandled crash. If a fetch fails but a (possibly stale)
    cache already exists, that cache is used rather than hard-failing a
    live request over a transient provider blip.
    """

    _UNKNOWN_KID_COOLDOWN_SECONDS = 60.0

    def __init__(self, jwks_url: str, default_ttl_seconds: int | None = None):
        self._jwks_url = jwks_url
        self._default_ttl = default_ttl_seconds
        self._cache: _CachedKeys | None = None
        self._lock = asyncio.Lock()
        self._last_unknown_kid_refetch: float = 0.0

    async def get_key(self, kid: str) -> PyJWK:
        now = time.monotonic()
        cached = self._cache
        if cached is not None and now < cached.expires_at and kid in cached.keys:
            return cached.keys[kid]

        async with self._lock:
            # Re-check after acquiring the lock — another coroutine may have
            # already refreshed the cache while this one was waiting
            # (single-flight: only one request per cache miss ever reaches
            # `_fetch`).
            cached = self._cache
            now = time.monotonic()
            if cached is not None and now < cached.expires_at and kid in cached.keys:
                return cached.keys[kid]

            cache_is_fresh = cached is not None and now < cached.expires_at
            if cache_is_fresh:
                # Known-fresh key set, just missing this one kid: cooldown-gate
                # the re-fetch so a flood of unknown/bad kids can't hammer the
                # provider every request.
                if now - self._last_unknown_kid_refetch < self._UNKNOWN_KID_COOLDOWN_SECONDS:
                    raise OAuthTokenError("invalid", "Unknown signing key")
                self._last_unknown_kid_refetch = now

            try:
                fetched = await self._fetch()
            except Exception as exc:
                if cached is not None:
                    log.warning(
                        "oauth_jwks_refetch_failed_using_stale",
                        url=self._jwks_url,
                        error=str(exc),
                    )
                    if kid in cached.keys:
                        return cached.keys[kid]
                    raise OAuthTokenError("invalid", "Unknown signing key") from exc
                log.error("oauth_jwks_fetch_failed", url=self._jwks_url, error=str(exc))
                raise OAuthTokenError("unavailable", "Key fetch failed") from exc

            self._cache = fetched
            if kid not in fetched.keys:
                raise OAuthTokenError("invalid", "Unknown signing key")
            return fetched.keys[kid]

    async def _fetch(self) -> _CachedKeys:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(self._jwks_url)
            resp.raise_for_status()
            data = resp.json()

        ttl = self._parse_max_age(resp.headers.get("cache-control"))
        if ttl is None:
            ttl = self._default_ttl or settings.oauth_jwks_default_ttl_seconds

        keys: dict[str, PyJWK] = {}
        for raw_key in data.get("keys", []):
            kid = raw_key.get("kid")
            if not kid:
                continue
            try:
                keys[kid] = PyJWK.from_dict(raw_key)
            except Exception:
                # A key this provider published in a shape pyjwt can't parse
                # (e.g. a non-RSA entry) — skip it, don't fail the whole set.
                log.warning("oauth_jwks_key_unparseable", url=self._jwks_url, kid=kid)
                continue
        return _CachedKeys(keys=keys, expires_at=time.monotonic() + ttl)

    @staticmethod
    def _parse_max_age(cache_control: str | None) -> int | None:
        if not cache_control:
            return None
        for part in cache_control.split(","):
            part = part.strip()
            if part.startswith("max-age="):
                try:
                    return int(part.split("=", 1)[1])
                except ValueError:
                    return None
        return None


class StaticJwksProvider:
    """Test-only: a pre-built key set (e.g. one RSA key generated fresh per
    test run), so the test suite never has to reach Google's/Apple's real
    JWKS endpoints. Never used by app code — only `tests/test_oauth.py`."""

    def __init__(self, keys: dict[str, PyJWK]):
        self._keys = keys

    async def get_key(self, kid: str) -> PyJWK:
        try:
            return self._keys[kid]
        except KeyError:
            raise OAuthTokenError("invalid", "Unknown signing key") from None


@dataclass
class ProviderConfig:
    # Not frozen, unlike `VerifiedIdentity` below: `jwks_provider` is exactly
    # what `tests/test_oauth.py` swaps out via `monkeypatch.setattr(GOOGLE,
    # "jwks_provider", StaticJwksProvider(...))`, the same pattern this
    # codebase already uses for settings (e.g. `monkeypatch.setattr(
    # storage_module.settings, "cdn_base_url", ...)`).
    provider: AuthProvider
    jwks_provider: JwksProvider
    issuer: str | tuple[str, ...]
    # A zero-arg thunk rather than a baked-in list: `GOOGLE`/`APPLE` below are
    # built once at import time, but the audience allow-list
    # (`settings.google_oauth_client_ids` / `apple_oauth_audiences`) must be
    # read fresh on every verification — not frozen at module-import time.
    audience: Any = field(repr=False)
    algorithms: tuple[str, ...] = ("RS256",)
    leeway_seconds: int = 30
    required_claims: tuple[str, ...] = ("iss", "aud", "sub", "exp", "iat")


GOOGLE = ProviderConfig(
    provider=AuthProvider.GOOGLE,
    jwks_provider=HttpJwksProvider("https://www.googleapis.com/oauth2/v3/certs"),
    # pyjwt 2.13 accepts a sequence for `issuer`. Google's ID tokens carry
    # either form depending on client library/version.
    issuer=("accounts.google.com", "https://accounts.google.com"),
    audience=lambda: settings.google_oauth_client_ids,
)

APPLE = ProviderConfig(
    provider=AuthProvider.APPLE,
    jwks_provider=HttpJwksProvider("https://appleid.apple.com/auth/keys"),
    issuer="https://appleid.apple.com",
    audience=lambda: settings.apple_oauth_audiences,
)


@dataclass(frozen=True)
class VerifiedIdentity:
    provider: AuthProvider
    subject: str
    email: str | None
    email_verified: bool
    # Apple-specific: true when `email` is a per-app relay address ("Hide My
    # Email") rather than the user's real address. Always False for Google.
    is_private_email: bool
    given_name: str | None
    family_name: str | None
    # Google's `picture` claim — a profile photo URL. Apple's identity token
    # has no equivalent claim, so `verify_apple_identity_token` always sets
    # this to None rather than inventing one. Consumed exactly once, by
    # `oauth_service.sign_in_with_identity`'s fresh-account-creation branch
    # (never on auto-link, never on a repeat sign-in — see that module).
    picture: str | None


def _as_bool(v: Any) -> bool:
    """Normalise a claim that may arrive as a real bool or the literal string
    "true"/"false" — Apple's `email_verified`/`is_private_email` have shipped
    as both depending on client library version. Never assume one."""
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.strip().lower() == "true"
    return bool(v)


def _log_audience_mismatch(provider: AuthProvider, token: str) -> None:
    """`aud` values are public (they're the app's own client IDs) — safe to
    log. An audience mismatch is almost always Isaac's own config being
    wrong (a client ID missing from the allow-list), not an attack, so this
    is logged loud (ERROR), not just the quiet INFO a routine invalid token
    gets."""
    try:
        unverified = jwt.decode(token, options={"verify_signature": False})
        received_aud = unverified.get("aud")
    except jwt.InvalidTokenError:
        received_aud = None
    log.error("oauth_audience_mismatch", provider=provider.value, received_aud=received_aud)


async def _verify_token(token: str, config: ProviderConfig) -> dict[str, Any]:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError as exc:
        raise OAuthTokenError("invalid", "Malformed sign-in token") from exc

    kid = header.get("kid")
    if not kid:
        raise OAuthTokenError("invalid", "Sign-in token has no key id")
    if header.get("alg") not in config.algorithms:
        raise OAuthTokenError("invalid", f"Unsupported signing algorithm {header.get('alg')!r}")

    jwk = await config.jwks_provider.get_key(kid)
    audience = config.audience()
    issuer = list(config.issuer) if isinstance(config.issuer, tuple) else config.issuer

    try:
        payload = jwt.decode(
            token,
            key=jwk.key,
            algorithms=list(config.algorithms),
            audience=audience,
            issuer=issuer,
            leeway=config.leeway_seconds,
            options={"require": list(config.required_claims)},
        )
    except jwt.InvalidAudienceError as exc:
        _log_audience_mismatch(config.provider, token)
        raise OAuthTokenError("audience_mismatch", "Token audience mismatch") from exc
    except jwt.InvalidTokenError as exc:
        log.info("oauth_token_rejected", provider=config.provider.value, reason=type(exc).__name__)
        raise OAuthTokenError("invalid", "Invalid sign-in token") from exc

    return payload


async def verify_google_id_token(token: str) -> VerifiedIdentity:
    """Google's nonce check is a deliberate no-op: it's unconfirmed whether
    the mobile Google Sign-In libraries even surface a raw nonce today, and
    an invented check that doesn't verify anything real is worse than none."""
    payload = await _verify_token(token, GOOGLE)
    return VerifiedIdentity(
        provider=AuthProvider.GOOGLE,
        subject=payload["sub"],
        email=payload.get("email"),
        email_verified=_as_bool(payload.get("email_verified", False)),
        is_private_email=False,
        given_name=payload.get("given_name"),
        family_name=payload.get("family_name"),
        picture=payload.get("picture"),
    )


async def verify_apple_identity_token(token: str, raw_nonce: str) -> VerifiedIdentity:
    """Apple's identity token never carries the user's name — that arrives
    exactly once, out-of-band, in the authorization response, and the caller
    (the router) is responsible for merging `AppleSignInRequest.given_name`/
    `family_name` onto the returned identity. `given_name`/`family_name` here
    are always None."""
    payload = await _verify_token(token, APPLE)

    expected_nonce = hashlib.sha256(raw_nonce.encode("utf-8")).hexdigest()
    if payload.get("nonce") != expected_nonce:
        raise OAuthTokenError("invalid", "Sign-in token nonce does not match")

    return VerifiedIdentity(
        provider=AuthProvider.APPLE,
        subject=payload["sub"],
        email=payload.get("email"),
        email_verified=_as_bool(payload.get("email_verified", False)),
        is_private_email=_as_bool(payload.get("is_private_email", False)),
        given_name=None,
        family_name=None,
        picture=None,
    )


def unverified_exp(token: str) -> int | None:
    """Best-effort extraction of a token's `exp` claim WITHOUT re-verifying
    its signature. Only safe to call on a token that has already been fully
    verified by `verify_google_id_token`/`verify_apple_identity_token` — this
    function proves nothing about authenticity on its own. Used solely to
    size the replay-guard TTL (`token_store.claim_once`) to the token's own
    remaining lifetime. Returns None if even this trivial decode fails,
    which should not happen for a token that just passed full verification."""
    try:
        payload = jwt.decode(token, options={"verify_signature": False})
    except jwt.InvalidTokenError:
        return None
    exp = payload.get("exp")
    return int(exp) if exp is not None else None


def unverified_iat(token: str) -> int | None:
    """`iat` of an already-verified provider token, read WITHOUT re-verifying
    the signature (same contract as `unverified_exp`: proves nothing about
    authenticity on its own). Used by account deletion to require a *fresh*
    provider sign-in. Returns None if the claim is absent or not an integer,
    which the caller treats as stale."""
    try:
        payload = jwt.decode(token, options={"verify_signature": False})
    except jwt.InvalidTokenError:
        return None
    iat = payload.get("iat")
    if isinstance(iat, bool) or not isinstance(iat, (int, float)):
        return None
    return int(iat)
