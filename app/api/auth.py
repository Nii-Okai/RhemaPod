import hashlib
import time
import uuid
from dataclasses import replace
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, Response
from starlette.background import BackgroundTask
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import email as email_module
from app.core import security, token_store
from app.core.apple_revocation import AppleRevocationClient, get_apple_revocation_client
from app.core.config import get_settings
from app.core.dependencies import AuditCtx, CurrentUserDep, require_role
from app.core.logging import correlation_id, get_logger
from app.core.net import client_ip
from app.core.oauth import (
    OAuthTokenError,
    ProviderConfig,
    VerifiedIdentity,
    unverified_exp,
    verify_apple_identity_token,
    verify_google_id_token,
)
from app.core.rate_limit import (
    RateLimitUnavailable,
    check_rate_limit,
    email_digest,
    login_rate_limit_key,
)
from app.db.database import get_db
from app.models.models import AuditAction, AuditOutcome, AuthProvider, UserRole
from app.models.schemas import (
    AccountDeletionRequest,
    AppleDeletionRequest,
    GoogleDeletionRequest,
    PasswordDeletionRequest,
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
    ResendVerificationRequest,
    ResetPasswordRequest,
    TokenPair,
    UserLogin,
    UserPublic,
    UserRegister,
    VerifyEmailRequest,
)
from app.services import (
    account_deletion_service,
    audit_service,
    auth_service,
    comments_service,
    oauth_service,
)
from app.services.audit_service import AuditContext
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
async def register(
    data: UserRegister, background_tasks: BackgroundTasks, db: DbDep
) -> UserPublic:
    """Creates the account. While email verification is on, it cannot sign in
    until the 6-digit code emailed here is entered at `/auth/verify-email`."""
    try:
        user = await auth_service.register_user(db, data)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message)
    if auth_service.needs_email_verification(user):
        background_tasks.add_task(
            _dispatch_email_verification, user.id, user.email
        )
    return auth_service.to_user_public(user)


async def _dispatch_email_verification(user_id: uuid.UUID, to_email: str) -> None:
    """Off the response path, swallow-and-log like `_dispatch_password_reset`:
    the account exists either way, and the app's "Resend code" recovers from a
    Redis blip or a failed send."""
    try:
        code = await auth_service.issue_email_verification_code(user_id)
        await email_module.send_email_verification(to_email, code)
    except Exception as exc:
        log.warning(
            "email_verification_dispatch_failed",
            user_id=str(user_id),
            error=type(exc).__name__,
        )


@router.post("/verify-email", response_model=TokenPair)
async def verify_email(
    data: VerifyEmailRequest, request: Request, db: DbDep, ctx: AuditCtx
) -> TokenPair:
    """Confirm a self-registered account with its emailed 6-digit code and
    sign it in. Wrong guesses are capped per code (see
    `token_store.consume_email_code`) and per client IP here."""
    allowed = await check_rate_limit(
        f"verify_email:{client_ip(request)}",
        settings.login_rate_limit,
        settings.login_rate_window_seconds,
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Try again shortly.",
        )
    try:
        user = await auth_service.verify_email(db, data.email, data.code)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message)
    access, refresh_token = await auth_service.issue_token_pair(user)
    await _audit_login(user, ctx, {"method": "email_verification"})
    return TokenPair(
        access_token=access, refresh_token=refresh_token, expires_in=_ACCESS_TTL_SECONDS
    )


_RESEND_VERIFICATION_LIMIT = 3
_RESEND_VERIFICATION_WINDOW_SECONDS = 15 * 60


@router.post("/resend-verification", response_model=MessageResponse)
async def resend_verification(
    data: ResendVerificationRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: DbDep,
) -> MessageResponse:
    """Email a fresh code. Same generic answer whether or not the address
    exists or still needs verifying — not an enumeration oracle — and the send
    happens off the response path, as in `forgot_password`."""
    generic = MessageResponse(
        message="If that account needs verifying, a new code has been sent."
    )
    email = data.email.lower()
    allowed = await check_rate_limit(
        f"resend_verification:{email_digest(email)}",
        _RESEND_VERIFICATION_LIMIT,
        _RESEND_VERIFICATION_WINDOW_SECONDS,
    ) and await check_rate_limit(
        f"resend_verification_ip:{client_ip(request)}",
        settings.login_rate_limit,
        settings.login_rate_window_seconds,
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Try again in a few minutes.",
        )
    user = await auth_service.get_user_by_email(db, email)
    if (
        user is not None
        and user.is_active
        and auth_service.needs_email_verification(user)
    ):
        background_tasks.add_task(_dispatch_email_verification, user.id, user.email)
    return generic


async def _audit_login(user, ctx: AuditContext, details: dict) -> None:
    """`auth.login`, fail-open in its own session (§A.3): tokens are already
    issued, so a broken audit insert logs `audit_write_failed` and nothing
    else."""
    await audit_service.record_detached(
        AuditAction.LOGIN,
        actor=user, target=None, details=details,
        outcome=AuditOutcome.SUCCESS, ctx=ctx,
    )


@router.post("/login", response_model=TokenPair)
async def login(
    data: UserLogin, request: Request, db: DbDep, ctx: AuditCtx
) -> TokenPair | JSONResponse:
    client = client_ip(request)
    rl_key = login_rate_limit_key(client, data.email)
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
        # Same status and body the HTTPException handler would produce, but
        # returned directly so it can carry a background task — FastAPI drops
        # injected BackgroundTasks when the handler raises. `auth.login_failed`
        # needs an account lookup, and doing it here would undo
        # `authenticate`'s equal-cost guarantee for unknown vs known emails;
        # after the response it costs the caller nothing (§A.3).
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": exc.message, "correlation_id": correlation_id.get()},
            background=BackgroundTask(
                audit_service.record_login_failed, data.email, ctx=ctx
            ),
        )

    if auth_service.needs_email_verification(user):
        # Only reachable with the correct password, so this reveals nothing
        # to someone who doesn't already hold the credentials. The app sends
        # the user to its code screen on this exact status.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email address not verified",
        )

    access, refresh = await auth_service.issue_token_pair(user)
    await _audit_login(user, ctx, {"method": "password"})
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
async def logout(
    data: LogoutRequest, user: CurrentUserDep, ctx: AuditCtx
) -> MessageResponse:
    """Per-device: revokes only the session the presented refresh token
    identifies, not every device the caller is signed in on (plan §A.3 #4).
    Public API contract change from the pre-rework body-less version — see
    status.md "W0.4 multi-session refresh"."""
    await auth_service.logout(str(user.id), data.refresh_token)
    await audit_service.record_detached(
        AuditAction.LOGOUT,
        actor=user, target=None, details=None,
        outcome=AuditOutcome.SUCCESS, ctx=ctx,
    )
    return MessageResponse(message="Logged out")


@router.post("/change-password", response_model=MessageResponse)
async def change_password(
    data: ChangePasswordRequest, user: CurrentUserDep, db: DbDep, ctx: AuditCtx
) -> MessageResponse:
    """Requires the current password — an access token alone is not enough.
    Wrong guesses are capped per account like login, so a stolen access token
    can't be used to brute-force the current password."""
    if not await check_rate_limit(
        f"change_password:{user.id}",
        settings.login_rate_limit,
        settings.login_rate_window_seconds,
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Try again shortly.",
        )
    try:
        await auth_service.change_password(
            db, user.id, data.current_password, data.new_password, ctx=ctx
        )
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message)
    return MessageResponse(message="Password updated. Please log in again.")


async def _dispatch_password_reset(
    user_id: str,
    to_email: str,
    token: str,
    jti: str,
    ttl_seconds: int,
    for_app: bool = False,
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
        await email_module.send_password_reset(to_email, token, for_app=for_app)
    except Exception as exc:
        log.warning(
            "password_reset_dispatch_failed",
            user_id=user_id,
            error=type(exc).__name__,
        )


_FORGOT_PASSWORD_LIMIT = 3
_FORGOT_PASSWORD_WINDOW_SECONDS = 15 * 60


@router.post("/forgot-password", response_model=MessageResponse)
async def forgot_password(
    data: ForgotPasswordRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: DbDep,
) -> MessageResponse:
    # This endpoint's whole purpose is to NOT be an account-enumeration oracle
    # (test_forgot_password_is_generic). Both branches must return in
    # get_user_by_email time: the known-email side effects (mint the one-shot
    # jti, open an SMTP connection — 50-300ms of connect/STARTTLS/login in
    # prod) are handed to BackgroundTasks so they never show up as a
    # response-latency signal. A Redis outage or a send failure is swallowed in
    # the background task; the status code and body are already fixed by then.
    #
    # Capped per address and per IP, same shape as `resend_verification`:
    # without it anyone can flood a victim's inbox with reset mail. The cap is
    # charged before the lookup, so a 429 says nothing about whether the
    # address exists.
    allowed = await check_rate_limit(
        f"forgot_password:{email_digest(data.email)}",
        _FORGOT_PASSWORD_LIMIT,
        _FORGOT_PASSWORD_WINDOW_SECONDS,
    ) and await check_rate_limit(
        f"forgot_password_ip:{client_ip(request)}",
        settings.login_rate_limit,
        settings.login_rate_window_seconds,
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Try again in a few minutes.",
        )
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
            # Viewers reset from the mobile app; the landing page shows them
            # app copy instead of the staff portal's.
            user.role == UserRole.VIEWER,
        )
    return MessageResponse(
        message="If that email exists, a reset link has been sent."
    )


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(
    data: ResetPasswordRequest, db: DbDep, ctx: AuditCtx
) -> MessageResponse:
    try:
        await auth_service.reset_password(db, data.token, data.new_password, ctx=ctx)
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
    log.info("oauth_token_rejected", reason=exc.reason, detail=str(exc))
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
        log.info("oauth_token_replay_digest", digest_prefix=digest[:12])
        raise OAuthTokenError("replayed", "Sign-in token was already used")


async def _finish_oauth_sign_in(
    db: AsyncSession, identity: VerifiedIdentity, ctx: AuditContext
) -> TokenPair:
    try:
        user, new_account = await oauth_service.sign_in_with_identity(db, identity)
    except OAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    access, refresh = await auth_service.issue_token_pair(user)
    await _audit_login(
        user, ctx, {"method": identity.provider.value, "new_account": new_account}
    )
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
async def oauth_google(
    data: GoogleSignInRequest, request: Request, db: DbDep, ctx: AuditCtx
) -> TokenPair:
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

    return await _finish_oauth_sign_in(db, identity, ctx)


@router.post("/oauth/apple", response_model=TokenPair)
async def oauth_apple(
    data: AppleSignInRequest, request: Request, db: DbDep, ctx: AuditCtx
) -> TokenPair:
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

    return await _finish_oauth_sign_in(db, identity, ctx)


@router.get("/me", response_model=UserPublic)
async def read_me(user: CurrentUserDep, db: DbDep) -> UserPublic:
    # CurrentUser is the lightweight auth principal; fetch the full row for
    # fields it doesn't carry (e.g. created_at).
    record = await auth_service.get_user_by_id(db, user.id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return await auth_service.to_user_public_linked(db, record)


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
    return await auth_service.to_user_public_linked(db, record)


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
    return await auth_service.to_user_public_linked(db, record)


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


# ── Self-service account deletion (ADR 0020) ─────────────────────────────────
AppleRevocationDep = Annotated[AppleRevocationClient, Depends(get_apple_revocation_client)]

_DELETE_LIMITER_UNAVAILABLE = "Account deletion is temporarily unavailable. Try again shortly."


_IAT_FUTURE_LEEWAY_SECONDS = ProviderConfig.leeway_seconds  # the verifier's own clock-skew leeway


def _reauth_failed() -> ContentError:
    # One message for every cause (wrong password, wrong provider, `sub`
    # mismatch, stale `iat`, nonce, replay): no account-state oracle.
    return ContentError(account_deletion_service.REAUTH_FAILED_MESSAGE, status_code=403)


async def _verify_oauth_deletion_proof(
    provider: AuthProvider,
    verify,
    raw_token: str,
    target: account_deletion_service.DeletionTarget,
) -> None:
    try:
        identity = await verify()
        subject = target.subjects.get(provider)
        if subject is None or identity.subject != subject:
            log.info("account_delete_reauth_rejected", reason="subject_mismatch")
            raise _reauth_failed()
        iat = identity.iat
        now = time.time()
        if (
            iat is None
            or now - iat > settings.account_deletion_reauth_max_age_seconds
            # An `iat` further ahead than the verifier's clock leeway is not a
            # fresh sign-in; it is a token minted to look fresh for longer.
            or iat - now > _IAT_FUTURE_LEEWAY_SECONDS
        ):
            log.info("account_delete_reauth_rejected", reason="stale_iat")
            raise _reauth_failed()
        await _claim_oauth_token_once(raw_token)
    except OAuthTokenError as exc:
        if exc.reason == "unavailable":
            raise ContentError(
                _OAUTH_TOKEN_ERROR_RESPONSES["unavailable"][1], status_code=503
            ) from None
        log.info("account_delete_reauth_rejected", reason=exc.reason)
        raise _reauth_failed() from None


async def _verify_deletion_proof(
    data: AccountDeletionRequest, target: account_deletion_service.DeletionTarget
) -> None:
    if isinstance(data, PasswordDeletionRequest):
        if not security.verify_password(data.password, target.user.password_hash):
            log.info("account_delete_reauth_rejected", reason="password")
            raise _reauth_failed()
    elif isinstance(data, GoogleDeletionRequest):
        await _verify_oauth_deletion_proof(
            AuthProvider.GOOGLE,
            lambda: verify_google_id_token(data.id_token),
            data.id_token,
            target,
        )
    else:
        await _verify_oauth_deletion_proof(
            AuthProvider.APPLE,
            lambda: verify_apple_identity_token(data.identity_token, data.raw_nonce),
            data.identity_token,
            target,
        )


@router.post("/me/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    data: AccountDeletionRequest,
    user: CurrentUserDep,
    request: Request,
    db: DbDep,
    ctx: AuditCtx,
    apple_client: AppleRevocationDep,
    background_tasks: BackgroundTasks,
) -> Response:
    """Delete the caller's own account (viewers only). One fresh proof goes in
    the same request: password, a fresh Google token, or a fresh Apple token
    plus its authorization code (revoked at Apple before anything is erased).
    Errors: 403 staff or failed re-auth (one generic message), 409 Apple
    re-auth required / Apple-only account / authored history, 400 Apple code
    rejected, 429 limiter, 503 Apple or the limiter store unavailable."""
    try:
        account_deletion_service.ensure_viewer(user.role)

        try:
            allowed = await check_rate_limit(
                f"account_delete:{user.id}",
                settings.account_delete_rate_limit,
                settings.account_delete_rate_window_seconds,
                fail_open=False,
            )
        except RateLimitUnavailable:
            raise ContentError(_DELETE_LIMITER_UNAVAILABLE, status_code=503) from None
        if not allowed:
            raise ContentError(
                "Too many deletion attempts. Try again later.", status_code=429
            )

        if isinstance(data, PasswordDeletionRequest):
            # Password guesses draw down the same budget as /auth/login.
            login_allowed = await check_rate_limit(
                login_rate_limit_key(client_ip(request), user.email),
                settings.login_rate_limit,
                settings.login_rate_window_seconds,
            )
            if not login_allowed:
                raise ContentError(
                    "Too many login attempts. Try again shortly.", status_code=429
                )

        target = await account_deletion_service.prepare_account_deletion(
            db, user.id, method=data.method, apple_unavailable=data.apple_unavailable
        )
        await _verify_deletion_proof(data, target)
        email = await account_deletion_service.delete_own_account(
            db,
            target,
            ctx,
            apple_client=apple_client,
            authorization_code=(
                data.authorization_code if isinstance(data, AppleDeletionRequest) else None
            ),
        )
    except ContentError as exc:
        raise HTTPException(
            status_code=exc.status_code, detail=exc.message, headers=exc.headers or None
        )
    # After the response, so an SMTP stall can't delay the 204.
    background_tasks.add_task(
        account_deletion_service.send_deleted_notice, email, user.id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
