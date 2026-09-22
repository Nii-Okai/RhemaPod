import uuid
from collections.abc import Iterable
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

# Token type markers embedded in the JWT "type" claim.
# `invite` is distinct from `reset` so logs/audit can tell an admin-issued
# set-your-password link apart from a self-service reset; /auth/reset-password
# accepts both.
TokenType = Literal["access", "refresh", "reset", "invite"]
ACCESS: TokenType = "access"
REFRESH: TokenType = "refresh"
RESET: TokenType = "reset"
INVITE: TokenType = "invite"


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


def create_refresh_token(user_id: str, sid: str, jti: str) -> str:
    """Encode a refresh JWT for a caller-supplied session id and jti.

    Unlike the other `create_*_token` functions, `jti` (and now `sid`) are
    supplied by the caller rather than generated here. This is deliberate
    (status.md "W0.4 kickoff decisions", D3): `auth_service` pre-generates the
    jti and claims it in the token store BEFORE minting, so a mint always
    follows a successful claim, never the other way around — closes the
    check-then-write race the old self-generating version had no way to avoid.

    `sid` identifies the session ("family", D2) and is stable across
    rotations; `jti` rotates on every refresh. Every refresh token minted from
    here carries a `sid` — one that doesn't (issued before this rework) is
    rejected outright by `rotate_refresh`, no legacy fallback (Isaac,
    status.md "sid rollout decision").

    Deliberately carries no role — a stale refresh token must not be able to
    mint an access token with privileges the user no longer holds. Refresh
    re-reads the user row instead."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "type": REFRESH,
        "iat": now,
        "nbf": now,
        "exp": now + timedelta(days=settings.refresh_token_expire_days),
        "jti": jti,
        "sid": sid,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def create_reset_token(user_id: str) -> tuple[str, str]:
    """Return (token, jti). The jti is registered in the single-use ledger
    (``token_store``) at mint and consumed on use, so a reset token cannot be
    replayed within its TTL."""
    jti = str(uuid.uuid4())
    token = _create_token(
        user_id,
        RESET,
        timedelta(minutes=settings.password_reset_expire_minutes),
        jti=jti,
    )
    return token, jti


def create_invite_token(user_id: str) -> tuple[str, str]:
    """A set-your-password token for admin-created staff. Carries its own
    ``invite`` type (distinct from a self-service ``reset``) so logs and audit
    can tell the two apart; /auth/reset-password consumes both. Longer TTL.
    Returns (token, jti) for the single-use ledger."""
    jti = str(uuid.uuid4())
    token = _create_token(
        user_id,
        INVITE,
        timedelta(hours=settings.invite_token_expire_hours),
        jti=jti,
    )
    return token, jti


def decode_token(
    token: str, expected_type: TokenType | Iterable[TokenType]
) -> dict[str, Any] | None:
    """Decode and fully validate a token. Returns the payload, or None if
    invalid — callers can't accidentally leak the specific reason to the client.

    Validates signature, expiry, not-before, audience, and issuer, requires the
    core claims, pins the algorithm (never accepts 'none'), and rejects a token
    whose `type` is not among the expected one(s). `expected_type` may be a
    single marker (the usual case) or a set of them — the reset endpoint accepts
    both `reset` and `invite`; an access or refresh token is still rejected
    anywhere it is not explicitly expected."""
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

    expected = (
        {expected_type}
        if isinstance(expected_type, str)
        else set(expected_type)
    )
    if payload.get("type") not in expected:
        log.warning(
            "token_rejected",
            reason="wrong_type",
            expected=sorted(expected),
            got=payload.get("type"),
        )
        return None

    return payload
