"""CloudflareStreamProvider.signed_playback_url (W1.5) — self-signed RS256
JWTs for Stream playback, no per-request Cloudflare API call. Pure
computation, no network, so these run synchronously — same rationale as
test_stream_webhook_signature.py for verify_webhook.

JWT shape per Cloudflare's "Secure your Stream videos" docs (confirmed live,
not guessed): header {"alg": "RS256", "kid": <key id>}, payload
{"sub": <video uid>, "kid": <key id>, "exp": <unix ts>}. Playback URL:
https://customer-<subdomain>.cloudflarestream.com/<token>/manifest/video.m3u8
"""
import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core.config import Settings, get_settings
from app.core.stream import CloudflareStreamProvider, StreamError


def _rsa_keypair() -> tuple[str, str]:
    """A real, freshly generated 2048-bit RSA keypair — same bar as the
    webhook HMAC tests computing a real signature rather than mocking it.
    Returns (private_pem, public_pem)."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    public_pem = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return private_pem, public_pem


def test_signed_playback_url_shape_and_claims(monkeypatch):
    private_pem, public_pem = _rsa_keypair()
    s = get_settings()
    monkeypatch.setattr(s, "cf_stream_signing_key_id", "key123")
    monkeypatch.setattr(s, "cf_stream_signing_key_pem", private_pem)
    monkeypatch.setattr(s, "cf_stream_customer_subdomain", "abcxyz")
    provider = CloudflareStreamProvider.__new__(CloudflareStreamProvider)

    before = int(time.time())
    url = provider.signed_playback_url(uid="video-uid-123", expires_in=3600)

    assert url.startswith("https://customer-abcxyz.cloudflarestream.com/")
    assert url.endswith("/manifest/video.m3u8")
    token = url.removeprefix("https://customer-abcxyz.cloudflarestream.com/").removesuffix(
        "/manifest/video.m3u8"
    )

    header = jwt.get_unverified_header(token)
    assert header["alg"] == "RS256"
    assert header["kid"] == "key123"

    # Verify against the REAL public key — proves this is genuine RS256
    # signing, not a cosmetic wrapper, and that our own decode round-trips.
    claims = jwt.decode(token, public_pem, algorithms=["RS256"])
    assert claims["sub"] == "video-uid-123"
    assert claims["kid"] == "key123"
    assert before + 3600 <= claims["exp"] <= before + 3600 + 5


def test_signed_playback_url_rejects_tampered_token(monkeypatch):
    """A public key that does NOT match the signing key must fail
    verification — proves the token is bound to the actual private key,
    not just shaped like a JWT."""
    private_pem, _ = _rsa_keypair()
    _, other_public_pem = _rsa_keypair()
    s = get_settings()
    monkeypatch.setattr(s, "cf_stream_signing_key_id", "key123")
    monkeypatch.setattr(s, "cf_stream_signing_key_pem", private_pem)
    monkeypatch.setattr(s, "cf_stream_customer_subdomain", "abcxyz")
    provider = CloudflareStreamProvider.__new__(CloudflareStreamProvider)

    url = provider.signed_playback_url(uid="video-uid-123", expires_in=3600)
    token = url.split("/")[3]

    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(token, other_public_pem, algorithms=["RS256"])


def test_signed_playback_url_requires_signing_key_configured(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "cf_stream_signing_key_id", None)
    monkeypatch.setattr(s, "cf_stream_signing_key_pem", None)
    monkeypatch.setattr(s, "cf_stream_customer_subdomain", "abcxyz")
    provider = CloudflareStreamProvider.__new__(CloudflareStreamProvider)

    with pytest.raises(StreamError, match="CF_STREAM_SIGNING_KEY_ID"):
        provider.signed_playback_url(uid="video-uid-123", expires_in=3600)


def test_signed_playback_url_raises_stream_error_on_malformed_key(monkeypatch):
    """A PRESENT but MALFORMED signing key (e.g. newlines not folded
    correctly when hand-pasted) must raise this module's own StreamError,
    not PyJWT's InvalidKeyError leaking unwrapped -- media_service's
    fallback-to-presigned-S3 logic only catches StreamError (see
    _resolve_variant_url), so an unwrapped PyJWT exception would 500 instead
    of degrading gracefully."""
    s = get_settings()
    monkeypatch.setattr(s, "cf_stream_signing_key_id", "key123")
    monkeypatch.setattr(s, "cf_stream_signing_key_pem", "not-a-valid-pem")
    monkeypatch.setattr(s, "cf_stream_customer_subdomain", "abcxyz")
    provider = CloudflareStreamProvider.__new__(CloudflareStreamProvider)

    with pytest.raises(StreamError, match="Failed to sign Stream playback JWT"):
        provider.signed_playback_url(uid="video-uid-123", expires_in=3600)


def test_signed_playback_url_raises_stream_error_on_encrypted_key(monkeypatch):
    """A password-protected private key is valid PEM but jwt.encode raises a
    bare TypeError for it (confirmed against the installed PyJWT/
    cryptography, not guessed) -- a different exception type than the
    unparsable-PEM case above, so it needs its own coverage to prove the
    wrapper catches both."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    encrypted_pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.BestAvailableEncryption(b"pw"),
    ).decode()
    s = get_settings()
    monkeypatch.setattr(s, "cf_stream_signing_key_id", "key123")
    monkeypatch.setattr(s, "cf_stream_signing_key_pem", encrypted_pem)
    monkeypatch.setattr(s, "cf_stream_customer_subdomain", "abcxyz")
    provider = CloudflareStreamProvider.__new__(CloudflareStreamProvider)

    with pytest.raises(StreamError, match="Failed to sign Stream playback JWT"):
        provider.signed_playback_url(uid="video-uid-123", expires_in=3600)


def test_signed_playback_url_requires_customer_subdomain(monkeypatch):
    private_pem, _ = _rsa_keypair()
    s = get_settings()
    monkeypatch.setattr(s, "cf_stream_signing_key_id", "key123")
    monkeypatch.setattr(s, "cf_stream_signing_key_pem", private_pem)
    monkeypatch.setattr(s, "cf_stream_customer_subdomain", None)
    provider = CloudflareStreamProvider.__new__(CloudflareStreamProvider)

    with pytest.raises(StreamError, match="CF_STREAM_CUSTOMER_SUBDOMAIN"):
        provider.signed_playback_url(uid="video-uid-123", expires_in=3600)


# ── Settings: "\n"-escaped PEM normalization ──────────────────────────────────
def test_signing_key_pem_unescapes_literal_newlines():
    """Most env-var mechanisms can't carry a real multi-line PEM cleanly, so
    the field accepts one physical line with literal backslash-n and
    unescapes it (DEPLOYMENT.md §12 / .env.example document this)."""
    s = Settings(
        secret_key="a-sufficiently-long-secret-key-for-tests",
        database_url="postgresql+psycopg://u:p@db/app",
        redis_url="redis://r:6379/0",
        cf_stream_signing_key_pem="line1\\nline2\\nline3",
    )
    assert s.cf_stream_signing_key_pem == "line1\nline2\nline3"


def test_signing_key_pem_leaves_real_newlines_unchanged():
    s = Settings(
        secret_key="a-sufficiently-long-secret-key-for-tests",
        database_url="postgresql+psycopg://u:p@db/app",
        redis_url="redis://r:6379/0",
        cf_stream_signing_key_pem="line1\nline2",
    )
    assert s.cf_stream_signing_key_pem == "line1\nline2"
