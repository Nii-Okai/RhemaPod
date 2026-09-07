from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.config import get_settings
from app.core.dependencies import CurrentUserDep, require_role
from app.core.logging import get_logger
from app.core.rate_limit import check_rate_limit
from app.db.database import get_db
from app.models.schemas import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
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
    client = request.client.host if request.client else "unknown"
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
async def logout(user: CurrentUserDep) -> MessageResponse:
    await auth_service.logout(str(user.id))
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


@router.post("/forgot-password", response_model=MessageResponse)
async def forgot_password(data: ForgotPasswordRequest, db: DbDep) -> MessageResponse:
    user = await auth_service.get_user_by_email(db, data.email)
    if user is not None:
        token = security.create_reset_token(str(user.id))
        # Phase 6 wires this to real email delivery. For now, log it.
        log.info("password_reset_requested", user_id=str(user.id), reset_token=token)
    # Always return the same response so emails can't be enumerated.
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