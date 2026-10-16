import hashlib
import time
from dataclasses import replace
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import email as email_module
from app.core import security, token_store
from app.core.config import get_settings
from app.core.dependencies import CurrentUserDep, require_role
from app.core.logging import get_logger
from app.core.net import client_ip
from app.core.oauth import (
    OAuthTokenError,
    VerifiedIdentity,
    unverified_exp,
    verify_apple_identity_token,
    verify_google_id_token,
)
from app.core.rate_limit import check_rate_limit
from app.db.database import get_db
from app.models.schemas import (
    AppleSignInRequest,
    AvatarResponse,
    AvatarTicket,
    AvatarUploadRequest,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    GoogleSignInRequest,
    LogoutRequest,
    MessageResponse,
    ProfileDetailsUpdate,
    ProfileUpdate,
    RefreshRequest,
    ResetPasswordRequest,
    TokenPair,
    UserLogin,
    UserPublic,
    UserRegister,
)
from app.services import auth_service, comments_service, oauth_service
from app.services.auth_service import AuthError
from app.services.content_service import ContentError
from app.services.oauth_service import OAuthError

settings = get_settings()
log = get_logger("auth_api")

router = APIRouter(prefix="/auth", tags=["auth"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

_ACCESS_TTL_SECONDS = settings.access_token_expire_minutes * 60


@router.post(
    "/register",
    response_model=UserPublic,
    status_code=status.HTTP_201_CREATED,
)
async def register(data: UserRegister, db: DbDep) -> UserPublic:
    try:
        user = await auth_service.register_user(db, data)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message)
    return auth_service.to_user_public(user)


@router.post("/login", response_model=TokenPair)
async def login(data: UserLogin, request: Request, db: DbDep) -> TokenPair:
    client = client_ip(request)
    rl_key = f"login:{client}:{data.email.lower()}"
    allowed = await check_rate_limit(
        rl_key, settings.login_rate_limit, settings.login_rate_window_seconds
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Try again shortly.",
        )

    try:
        user = await auth_service.authenticate(db, data.email, data.password)
    except AuthError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=exc.message
        )

    access, refresh = await auth_service.issue_token_pair(user)
    return TokenPair(
        access_token=access, refresh_token=refresh, expires_in=_ACCESS_TTL_SECONDS
    )


@router.post("/refresh", response_model=TokenPair)
async def refresh(data: RefreshRequest, db: DbDep) -> TokenPair:
    try:
        access, refresh_token = await auth_service.rotate_refresh(
            db, data.refresh_token
        )
    except AuthError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=exc.message
        )
    return TokenPair(
        access_token=access,
        refresh_token=refresh_token,
        expires_in=_ACCESS_TTL_SECONDS,
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(data: LogoutRequest, user: CurrentUserDep) -> MessageResponse:
    """Per-device: revokes only the session the presented refresh token
    identifies, not every device the caller is signed in on (plan §A.3 #4).
    Public API contract change from the pre-rework body-less version — see
    status.md "W0.4 multi-session refresh"."""
    await auth_service.logout(str(user.id), data.refresh_token)
    return MessageResponse(message="Logged out")


@router.post("/change-password", response_model=MessageResponse)
async def change_password(
    data: ChangePasswordRequest, user: CurrentUserDep, db: DbDep
) -> MessageResponse:
    """Requires the current password — an access token alone is not enough."""
    try:
        await auth_service.change_password(
            db, user.id, data.current_password, data.new_password
        )
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message)
    return MessageResponse(message="Password updated. Please log in again.")


async def _dispatch_password_reset(
    user_id: str, to_email: str, token: str, jti: str, ttl_seconds: int
) -> None:
    """Off the response path — see forgot_password for why.

    Record the one-shot jti, then hand the token to the email seam. Both are
    swallowed-and-logged: a reset token that never reached the single-use
    ledger is inert (/auth/reset-password rejects it), and a delivery failure
    must not retroactively change what the endpoint already answered. The
    token itself is never logged; in production delivery is real SMTP (no body
    logged) and in dev the console backend (which logs the link — a deliberate
    dev-only affordance, structurally unreachable in prod).
    """
    try:
        await token_store.register_single_use(jti, ttl_seconds)
        await email_module.send_password_reset(to_email, token)
    except Exception as exc:
        log.warning(
            "password_reset_dispatch_failed",
            user_id=user_id,
            error=type(exc).__name__,
        )


@router.post("/forgot-password", response_model=MessageResponse)
async def forgot_password(
    data: ForgotPasswordRequest, background_tasks: BackgroundTasks, db: DbDep
) -> MessageResponse:
    # This endpoint's whole purpose is to NOT be an account-enumeration oracle
    # (test_forgot_password_is_generic). Both branches must return in
    # get_user_by_email time: the known-email side effects (mint the one-shot
    # jti, open an SMTP connection — 50-300ms of connect/STARTTLS/login in
    # prod) are handed to BackgroundTasks so they never show up as a
    # response-latency signal. A Redis outage or a send failure is swallowed in
    # the background task; the status code and body are already fixed by then.
    user = await auth_service.get_user_by_email(db, data.email)
    if user is not None:
        token, jti = security.create_reset_token(str(user.id))
        background_tasks.add_task(
            _dispatch_password_reset,
            str(user.id),
            user.email,
            token,
            jti,
            settings.password_reset_expire_minutes * 60,
        )
    return MessageResponse(
        message="If that email exists, a reset link has been sent."
    )


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(data: ResetPasswordRequest, db: DbDep) -> MessageResponse:
    try:
        await auth_service.reset_password(db, data.token, data.new_password)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message)
    return MessageResponse(message="Password updated. Please log in again.")


# ── Social sign-in (ADR 0015) ─────────────────────────────────────────────────
# Status, detail string per reason — stable/documented, not to be paraphrased.
_OAUTH_TOKEN_ERROR_RESPONSES: dict[str, tuple[int, str]] = {
    "invalid": (status.HTTP_401_UNAUTHORIZED, "Invalid or expired sign-in token"),
    "replayed": (status.HTTP_401_UNAUTHORIZED, "Invalid or expired sign-in token"),
    "audience_mismatch": (
        status.HTTP_401_UNAUTHORIZED,
        "Sign-in token was issued for a different app",
    ),
    "unavailable": (
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "Sign-in temporarily unavailable",
    ),
}


def _oauth_token_error_response(exc: OAuthTokenError) -> HTTPException:
    status_code, detail = _OAUTH_TOKEN_ERROR_RESPONSES[exc.reason]
    return HTTPException(status_code=status_code, detail=detail)


# Minimum replay-guard TTL floor (seconds): a token verified right at its own
# expiry boundary must still get a real replay window, not a near-zero one.
_OAUTH_REPLAY_TTL_FLOOR_SECONDS = 60


async def _claim_oauth_token_once(raw_token: str) -> None:
    """Single-use claim on an already-verified provider token (see
    `token_store.claim_once`'s docstring for why this is a distinct
    primitive from the mint-then-consume single-use ledger). Sized to the
    token's own remaining lifetime, floored so a token verified right at its
    expiry boundary still gets a real window. Raises `OAuthTokenError(reason=
    "replayed")` on a replay — routed through the same `_oauth_token_error_response`
    table every other verification failure uses, rather than a one-off
    HTTPException, so "replayed" is a real reachable branch and not a dead
    table entry."""
    exp = unverified_exp(raw_token)
    ttl = _OAUTH_REPLAY_TTL_FLOOR_SECONDS
    if exp is not None:
        ttl = max(_OAUTH_REPLAY_TTL_FLOOR_SECONDS, exp - int(time.time()))
    digest = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    claimed = await token_store.claim_once(f"oauth:used:{digest}", ttl)
    if not claimed:
        raise OAuthTokenError("replayed", "Sign-in token was already used")


async def _finish_oauth_sign_in(db: AsyncSession, identity: VerifiedIdentity) -> TokenPair:
    try:
        user = await oauth_service.sign_in_with_identity(db, identity)
    except OAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    access, refresh = await auth_service.issue_token_pair(user)
    return TokenPair(access_token=access, refresh_token=refresh, expires_in=_ACCESS_TTL_SECONDS)


async def _check_oauth_rate_limit(provider: str, request: Request) -> None:
    client = client_ip(request)
    allowed = await check_rate_limit(
        f"oauth:{provider}:{client}",
        settings.login_rate_limit,
        settings.login_rate_window_seconds,
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Try again shortly.",
        )


@router.post("/oauth/google", response_model=TokenPair)
async def oauth_google(data: GoogleSignInRequest, request: Request, db: DbDep) -> TokenPair:
    if not settings.oauth_google_enabled:
        # Don't expose a route that then 503s — a disabled feature looks like
        # it doesn't exist.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

    await _check_oauth_rate_limit("google", request)

    try:
        identity = await verify_google_id_token(data.id_token)
        await _claim_oauth_token_once(data.id_token)
    except OAuthTokenError as exc:
        raise _oauth_token_error_response(exc)

    return await _finish_oauth_sign_in(db, identity)


@router.post("/oauth/apple", response_model=TokenPair)
async def oauth_apple(data: AppleSignInRequest, request: Request, db: DbDep) -> TokenPair:
    if not settings.oauth_apple_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

    await _check_oauth_rate_limit("apple", request)

    try:
        identity = await verify_apple_identity_token(data.identity_token, data.raw_nonce)
    except OAuthTokenError as exc:
        raise _oauth_token_error_response(exc)

    # Apple's identity token never carries a name — the client forwards it
    # separately, and only on the first authorization ever (None on every
    # later sign-in). Merge it onto the verified identity before it reaches
    # the service layer, which only prefills a brand-new account's name.
    if data.given_name or data.family_name:
        identity = replace(identity, given_name=data.given_name, family_name=data.family_name)

    try:
        await _claim_oauth_token_once(data.identity_token)
    except OAuthTokenError as exc:
        raise _oauth_token_error_response(exc)

    return await _finish_oauth_sign_in(db, identity)


@router.get("/me", response_model=UserPublic)
async def read_me(user: CurrentUserDep, db: DbDep) -> UserPublic:
    # CurrentUser is the lightweight auth principal; fetch the full row for
    # fields it doesn't carry (e.g. created_at).
    record = await auth_service.get_user_by_id(db, user.id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return auth_service.to_user_public(record)


@router.patch("/me", response_model=UserPublic)
async def update_me(data: ProfileUpdate, user: CurrentUserDep, db: DbDep) -> UserPublic:
    """Self-edit of `full_name`, the only self-editable field. It is shown to
    other viewers as "First L." on comments, so it goes through the same
    normalisation, URL, contact and blocklist rules as a comment body, plus
    reserved titles. Limited to 5 changes per hour per user (429 + Retry-After);
    a rejected name returns one generic message. The comments flow's own name
    prompt is the one remaining caller — the Me page's own profile editor uses
    `PATCH /me/profile` below instead."""
    record = await auth_service.get_user_by_id(db, user.id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    try:
        record = await comments_service.update_full_name(db, record, data.full_name)
    except ContentError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=exc.message,
            headers=exc.headers or None,
        )
    return auth_service.to_user_public(record)


@router.patch("/me/profile", response_model=UserPublic)
async def update_me_profile(data: ProfileDetailsUpdate, user: CurrentUserDep, db: DbDep) -> UserPublic:
    """Me page profile edit (Isaac's ask, session 2026-10-09): first/last name
    and gender, independent of `PATCH /me`'s `full_name` field and of avatar
    upload. A name change goes through the exact same moderation and rate
    limit `PATCH /me` already has (`comments_service.update_profile_name`) —
    it still recomputes and publicly displays as `full_name`."""
    record = await auth_service.get_user_by_id(db, user.id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    if (data.first_name is None) != (data.last_name is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="first_name and last_name must be provided together",
        )
    try:
        if data.first_name is not None and data.last_name is not None:
            record = await comments_service.update_profile_name(db, record, data.first_name, data.last_name)
        if data.gender is not None:
            record = await auth_service.update_gender(db, record, data.gender)
    except ContentError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail=exc.message,
            headers=exc.headers or None,
        )
    return auth_service.to_user_public(record)


@router.post("/me/avatar/upload-ticket", response_model=AvatarTicket, status_code=status.HTTP_201_CREATED)
async def avatar_upload_ticket(data: AvatarUploadRequest, user: CurrentUserDep, db: DbDep) -> AvatarTicket:
    record = await auth_service.get_user_by_id(db, user.id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    try:
        return await auth_service.create_avatar_ticket(record, data.filename, data.content_type)
    except ContentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.post("/me/avatar/confirm", response_model=AvatarResponse)
async def avatar_confirm(avatar_key: str, user: CurrentUserDep, db: DbDep) -> AvatarResponse:
    record = await auth_service.get_user_by_id(db, user.id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    try:
        url = await auth_service.confirm_avatar(db, record, avatar_key)
    except ContentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    return AvatarResponse(avatar_url=url)
