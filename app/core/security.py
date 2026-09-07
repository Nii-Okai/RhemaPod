import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
log = get_logger("security")

_password_hash = PasswordHash.recommended()

# A precomputed hash so a login for a non-existent user still burns the same
# Argon2 time — login latency can't be used to enumerate accounts.
_DUMMY_HASH = _password_hash.hash("timing-attack-mitigation-dummy-password")

# Token type markers embedded in the JWT "type" claim
TokenType = Literal["access", "refresh", "reset"]
ACCESS: TokenType = "access"
REFRESH: TokenType = "refresh"
RESET: TokenType = "reset"


# --- Passwords ---
def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(plain: str, hashed: str | None) -> bool:
    """Verify a password. Passing hashed=None still runs a dummy verify so the
    call takes the same time as a real miss (no account-existence timing leak)."""
    if hashed is None:
        _password_hash.verify(plain, _DUMMY_HASH)
        return False
    try:
        return _password_hash.verify(plain, hashed)
    except Exception:
        # Malformed/legacy hash — treat as failed login, never a 500.
        log.warning("password_verify_failed_malformed_hash")
        return False


def verify_and_rehash(plain: str, hashed: str) -> tuple[bool, str | None]:
    """Verify, returning a fresh hash if the stored one used weaker Argon2
    parameters. Lets cost parameters be raised over time and transparently
    upgraded on the user's next login — no password reset required."""
    try:
        return _password_hash.verify_and_update(plain, hashed)
    except Exception:
        log.warning("password_verify_and_update_failed")
        return False, None


# --- JWT ---
def _create_token(
    subject: str,
    token_type: TokenType,
    expires_delta: timedelta,
    **claims: Any,
) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "iat": now,
        "nbf": now,
        "exp": now + expires_delta,
        "jti": str(uuid.uuid4()),
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        **claims,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: str, role: str) -> str:
    return _create_token(
        user_id,
        ACCESS,
        timedelta(minutes=settings.access_token_expire_minutes),
        role=role,
    )


def create_refresh_token(user_id: str) -> tuple[str, str]:
    """Return (token, jti). The jti is stored in Redis for rotation checks.

    Deliberately carries no role — a stale refresh token must not be able to
    mint an access token with privileges the user no longer holds. Refresh
    re-reads the user row instead."""
    jti = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "type": REFRESH,
        "iat": now,
        "nbf": now,
        "exp": now + timedelta(days=settings.refresh_token_expire_days),
        "jti": jti,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
    return token, jti


def create_reset_token(user_id: str) -> str:
    return _create_token(
        user_id,
        RESET,
        timedelta(minutes=settings.password_reset_expire_minutes),
    )


def create_invite_token(user_id: str) -> str:
    """A set-your-password token for admin-created staff. Same RESET type as a
    normal reset (so /auth/reset-password consumes it), just a longer TTL."""
    return _create_token(
        user_id,
        RESET,
        timedelta(hours=settings.invite_token_expire_hours),
    )


def decode_token(token: str, expected_type: TokenType) -> dict[str, Any] | None:
    """Decode and fully validate a token. Returns the payload, or None if
    invalid — callers can't accidentally leak the specific reason to the client.

    Validates signature, expiry, not-before, audience, and issuer, requires the
    core claims, pins the algorithm (never accepts 'none'), and rejects a token
    whose `type` does not match the expected one."""
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={"require": ["exp", "iat", "sub", "type"]},
        )
    except jwt.ExpiredSignatureError:
        log.info("token_rejected", reason="expired")
        return None
    except jwt.InvalidTokenError as exc:
        log.info("token_rejected", reason=type(exc).__name__)
        return None

    if payload.get("type") != expected_type:
        log.warning(
            "token_rejected",
            reason="wrong_type",
            expected=expected_type,
            got=payload.get("type"),
        )
        return None

    return payload
