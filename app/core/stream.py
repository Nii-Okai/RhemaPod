"""Cloudflare Stream provider abstraction (ingest + status + webhooks + signed
playback URLs).

Two backends:
  * CloudflareStreamProvider — real Cloudflare Stream: "copy from URL" ingest,
    status polling, webhook signature verification (via httpx), and signed
    playback URL generation (RS256 JWT, signed locally with PyJWT — no
    per-request Cloudflare API call).
  * LocalStream            — in-process stub for tests and local dev with no
                              Cloudflare account. Fakes uids and lets tests
                              seed whatever status they want to exercise.

Nothing outside this module makes a Cloudflare Stream API call directly, so
swapping providers (or adding a second video backend) touches only this file
— same seam shape as app/core/storage.py.

There is no official Cloudflare Python SDK forcing a blocking call here, so
the ingest and status calls are genuinely async end to end via
httpx.AsyncClient rather than needing an asyncio.to_thread wrapper.
`verify_webhook` and
`signed_playback_url` are plain sync methods — both are pure computation
(HMAC / RSA over already-in-memory bytes), no I/O, so there is nothing to
await.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any, Protocol

import httpx
import jwt

from app.core.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
log = get_logger("stream")

# Bound the webhook replay window. Cloudflare does not itself expire
# signatures (the header just carries the signing time), so this bounds the
# same risk any webhook signature scheme has: a leaked signature+payload
# pair should not be replayable forever.
_WEBHOOK_TOLERANCE_SECONDS = 300


class StreamError(Exception):
    pass


@dataclass(frozen=True)
class StreamIngest:
    uid: str
    state: str  # Cloudflare's status.state at kickoff time, e.g. "queued"


@dataclass(frozen=True)
class StreamStatus:
    uid: str
    state: str  # "queued" | "downloading" | "inprogress" | "ready" | "error" | ...
    ready_to_stream: bool
    error_reason: str | None = None


class StreamProvider(Protocol):
    name: str

    async def start_ingest(
        self, *, source_url: str, meta: dict[str, str] | None = None
    ) -> StreamIngest: ...

    async def get_status(self, *, uid: str) -> StreamStatus: ...

    def verify_webhook(self, payload: bytes, signature: str | None) -> dict[str, Any]: ...

    def signed_playback_url(self, *, uid: str, expires_in: int) -> str: ...


class LocalStream:
    """Deterministic stub. `verify_webhook` just parses JSON, so tests can
    post events directly without signing."""

    name = "stream_stub"

    def __init__(self) -> None:
        self._counter = 0
        # uid -> current status. Seeded via set_status() by tests; empty
        # otherwise. Instance state, so a fresh LocalStream (see the `client`
        # fixture) starts clean and nothing bleeds between tests.
        self._statuses: dict[str, StreamStatus] = {}

    def reset(self) -> None:
        self._counter = 0
        self._statuses.clear()

    def set_status(self, uid: str, status: StreamStatus | None) -> None:
        """Test seam: declare what `get_status` should return for this uid."""
        if status is None:
            self._statuses.pop(uid, None)
        else:
            self._statuses[uid] = status

    async def start_ingest(
        self, *, source_url: str, meta: dict[str, str] | None = None
    ) -> StreamIngest:
        self._counter += 1
        uid = f"stub{self._counter:028d}"[:32]
        status = StreamStatus(uid=uid, state="queued", ready_to_stream=False)
        self._statuses[uid] = status
        log.info("stream_stub_ingest_started", uid=uid, source_url=source_url)
        return StreamIngest(uid=uid, state=status.state)

    async def get_status(self, *, uid: str) -> StreamStatus:
        status = self._statuses.get(uid)
        if status is None:
            raise StreamError(f"Unknown stub Stream uid '{uid}'")
        return status

    def verify_webhook(self, payload: bytes, signature: str | None) -> dict[str, Any]:
        # The stub checks no signature, so on an internet-reachable host
        # (staging) anyone could post a forged "ready" event. Nothing real
        # sends webhooks to a stub there anyway.
        if settings.is_internet_reachable:
            raise StreamError(
                "Unsigned Stream webhooks are refused outside local development"
            )
        try:
            return json.loads(payload.decode())
        except Exception as exc:
            raise StreamError("Malformed webhook payload") from exc

    def signed_playback_url(self, *, uid: str, expires_in: int) -> str:
        """Deterministic fake — no signing key needed, same as every other
        stub method here. Good enough for the calling code (and its tests) to
        exercise the Stream-vs-presigned-S3 branch without a real Cloudflare
        account or a real signing key."""
        return (
            f"https://stub.cloudflarestream.test/{uid}/manifest/video.m3u8"
            f"?stub_token=1&expires_in={expires_in}"
        )


def _parse_cf_response(resp: httpx.Response, label: str) -> dict[str, Any]:
    try:
        data = resp.json()
    except Exception as exc:
        raise StreamError(
            f"{label}: non-JSON response ({resp.status_code})"
        ) from exc
    if resp.status_code >= 400 or not data.get("success", True):
        errors = data.get("errors") or []
        detail = "; ".join(str(e) for e in errors) or resp.text[:200]
        raise StreamError(f"{label} failed ({resp.status_code}): {detail}")
    return data


class CloudflareStreamProvider:
    name = "cloudflare_stream"

    def __init__(self) -> None:
        self._base = (
            f"https://api.cloudflare.com/client/v4/accounts/"
            f"{settings.cf_account_id}/stream"
        )
        self._headers = {"Authorization": f"Bearer {settings.cf_stream_api_token}"}

    async def start_ingest(
        self, *, source_url: str, meta: dict[str, str] | None = None
    ) -> StreamIngest:
        body: dict[str, Any] = {"input": source_url}
        if meta:
            body["meta"] = meta
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                resp = await client.post(
                    f"{self._base}/copy", json=body, headers=self._headers
                )
            except httpx.HTTPError as exc:
                raise StreamError(f"Stream copy request failed: {exc}") from exc
        data = _parse_cf_response(resp, "Stream copy")
        result = data.get("result") or {}
        uid = result.get("uid")
        if not uid:
            raise StreamError("Stream copy response carried no uid")
        state = (result.get("status") or {}).get("state", "queued")
        log.info("stream_ingest_started", uid=uid, state=state)
        return StreamIngest(uid=uid, state=state)

    async def get_status(self, *, uid: str) -> StreamStatus:
        async with httpx.AsyncClient(timeout=15) as client:
            try:
                resp = await client.get(f"{self._base}/{uid}", headers=self._headers)
            except httpx.HTTPError as exc:
                raise StreamError(f"Stream status request failed: {exc}") from exc
        data = _parse_cf_response(resp, "Stream status")
        result = data.get("result") or {}
        status = result.get("status") or {}
        return StreamStatus(
            uid=result.get("uid", uid),
            state=status.get("state", "unknown"),
            ready_to_stream=bool(result.get("readyToStream", False)),
            error_reason=status.get("errorReasonText"),
        )

    def verify_webhook(self, payload: bytes, signature: str | None) -> dict[str, Any]:
        """Cloudflare Stream's `Webhook-Signature` header:
        `time=<unix-ts>,sig1=<hex hmac-sha256>` over `f"{time}.{body}"`,
        keyed with the secret returned when the webhook URL was registered
        (PUT /accounts/{id}/stream/webhook — see DEPLOYMENT.md).
        """
        if not settings.cf_stream_webhook_secret:
            raise StreamError(
                "CF_STREAM_WEBHOOK_SECRET is not configured — cannot verify "
                "Cloudflare Stream webhooks"
            )
        if not signature:
            raise StreamError("Missing webhook signature")

        parts: dict[str, str] = {}
        for field in signature.split(","):
            if "=" not in field:
                continue
            key, _, value = field.partition("=")
            parts[key.strip()] = value.strip()
        ts = parts.get("time")
        sig = parts.get("sig1")
        if not ts or not sig:
            raise StreamError("Malformed webhook signature header")

        try:
            signed_at = int(ts)
        except ValueError:
            raise StreamError("Malformed webhook signature timestamp") from None
        if abs(time.time() - signed_at) > _WEBHOOK_TOLERANCE_SECONDS:
            raise StreamError("Webhook signature timestamp outside tolerance")

        signed_payload = f"{ts}.".encode() + payload
        expected = hmac.new(
            settings.cf_stream_webhook_secret.encode(), signed_payload, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected, sig):
            raise StreamError("Invalid webhook signature")

        try:
            return json.loads(payload.decode())
        except Exception as exc:
            raise StreamError("Malformed webhook payload") from exc

    def signed_playback_url(self, *, uid: str, expires_in: int) -> str:
        """Self-signed Stream playback URL — an RS256 JWT built locally from
        the account's signing key, no per-request Cloudflare API call (per
        Cloudflare's "Secure your Stream videos" docs, confirmed live, not
        guessed: header `{"alg": "RS256", "kid": <key id>}`, payload
        `{"sub": <video uid>, "kid": <key id>, "exp": <unix ts>}`).

        The signing key is a separate, one-time-visible artifact from the
        account/API-token credentials this provider is otherwise built from
        (`POST /accounts/{id}/stream/keys` — DEPLOYMENT.md §12), so it can be
        unset even while Stream ingest itself is fully live; raises rather
        than silently signing with nothing. media_service.get_stream /
        get_audio_download catch this and fall back to the pre-Stream
        presigned-S3 path — see their docstrings.
        """
        if not settings.stream_signing_is_configured:
            raise StreamError(
                "CF_STREAM_SIGNING_KEY_ID / CF_STREAM_SIGNING_KEY_PEM not "
                "configured — cannot sign a Cloudflare Stream playback URL"
            )
        if not settings.cf_stream_customer_subdomain:
            raise StreamError(
                "CF_STREAM_CUSTOMER_SUBDOMAIN not configured — cannot build "
                "a Cloudflare Stream playback URL"
            )
        key_id = settings.cf_stream_signing_key_id
        try:
            token = jwt.encode(
                {
                    "sub": uid,
                    "kid": key_id,
                    "exp": int(time.time()) + expires_in,
                },
                settings.cf_stream_signing_key_pem,
                algorithm="RS256",
                headers={"kid": key_id},
            )
        except (jwt.exceptions.PyJWTError, TypeError, ValueError) as exc:
            # A *present but malformed* CF_STREAM_SIGNING_KEY_PEM — e.g.
            # newlines not folded correctly when hand-pasted (DEPLOYMENT.md
            # §12 step 5) — raises straight from PyJWT/cryptography, not this
            # module's own StreamError: InvalidKeyError (unparsable PEM or
            # wrong key type) in the common case, but an encrypted/
            # password-protected private key raises a bare TypeError instead
            # (confirmed against the installed PyJWT/cryptography, not
            # guessed). Normalize both to StreamError so
            # media_service._resolve_variant_url's existing `except
            # StreamError` fallback to presigned S3 catches this too — an
            # unconfigured key already degrades gracefully via the checks
            # above; a misconfigured one must degrade the same way, not 500.
            raise StreamError(f"Failed to sign Stream playback JWT: {exc}") from exc
        return (
            f"https://customer-{settings.cf_stream_customer_subdomain}"
            f".cloudflarestream.com/{token}/manifest/video.m3u8"
        )


_provider: StreamProvider | None = None


def get_provider() -> StreamProvider:
    """Return the active Stream provider (singleton).

    Uses Cloudflare when credentials are configured, otherwise the local stub
    — so the app boots and is fully testable with no Cloudflare account.
    """
    global _provider
    if _provider is None:
        if settings.stream_is_live:
            _provider = CloudflareStreamProvider()
            log.info("stream_provider", provider="cloudflare_stream")
        elif settings.is_production:
            # Belt-and-braces: config preflight already blocks this, but never
            # let a stub ingest sermon video in production even if that is
            # bypassed.
            raise StreamError(
                "Refusing to use the stub Stream provider in production. "
                "Set CF_ACCOUNT_ID and CF_STREAM_API_TOKEN."
            )
        else:
            _provider = LocalStream()
            log.warning("stream_provider", provider="stub", live=False)
    return _provider


def set_provider(provider: StreamProvider | None) -> None:
    """Override the provider (used by tests)."""
    global _provider
    _provider = provider
