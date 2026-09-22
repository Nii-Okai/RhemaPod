from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import email as email_module
from app.core import security, token_store
from app.core.config import get_settings
from app.core.dependencies import CurrentUserDep, require_role
from app.core.logging import get_logger
from app.core.net import client_ip
from app.core.rate_limit import check_rate_limit
from app.db.database import get_db
from app.models.schemas import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LogoutRequest,
    MessageResponse,
    RefreshRequest,
    ResetPasswordRequest,
    TokenPair,
    UserLogin,
    UserPublic,
    UserRegister,
)
from app.services import auth_service
from app.services.auth_service import AuthError

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
    return UserPublic.model_validate(user)


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


@router.get("/me", response_model=UserPublic)
async def read_me(user: CurrentUserDep, db: DbDep) -> UserPublic:
    # CurrentUser is the lightweight auth principal; fetch the full row for
    # fields it doesn't carry (e.g. created_at).
    record = await auth_service.get_user_by_id(db, user.id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return UserPublic.model_validate(record)