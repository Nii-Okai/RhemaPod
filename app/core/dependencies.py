import uuid
from typing import Annotated
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.logging import get_logger
from app.db.database import get_db
from app.models.models import User, UserRole
from app.services import auth_service

log = get_logger("auth_deps")

_bearer = HTTPBearer(auto_error=True)

CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)

@dataclass(frozen=True)
class CurrentUser:
    id: uuid.UUID
    email: str
    role: UserRole
    is_active: bool


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CurrentUser:
    if credentials is None:
        raise CREDENTIALS_EXCEPTION
    
    payload = security.decode_token(credentials.credentials, security.ACCESS)

    if payload is None:
        raise CREDENTIALS_EXCEPTION

    try:
        user_id = uuid.UUID(str(payload["sub"]))
    except (ValueError, KeyError):
        raise CREDENTIALS_EXCEPTION

    user = await auth_service.get_user_by_id(db, user_id)

    if user is None or not user.is_active:
        log.info("auth_rejected", reason="missing_or_inactive", user_id=str(user_id))
        raise CREDENTIALS_EXCEPTION
    
    return CurrentUser(
        id=user.id, 
        email=user.email, 
        role=user.role, 
        is_active=user.is_active
    )

CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]


_optional_bearer = HTTPBearer(auto_error=False)


async def get_optional_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_optional_bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User | None:
    """Like get_current_user but returns None instead of 401 when no valid token
    is present. Used by public catalog reads that personalise (e.g. the `locked`
    flag) when the caller happens to be logged in."""
    if credentials is None:
        return None
    payload = security.decode_token(credentials.credentials, security.ACCESS)
    if payload is None:
        return None
    try:
        user_id = uuid.UUID(str(payload["sub"]))
    except (ValueError, KeyError):
        return None
    user = await auth_service.get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        return None
    return user


def require_role(*allowed: UserRole):
    """Dependency factory enforcing that the user has one of the given roles."""

    async def _guard(user: CurrentUserDep) -> CurrentUser:
        if user.role not in allowed:
            log.warning(
                "authz_denied",
                user_id=str(user.id),
                user_role=user.role.value,
                required=[r.value for r in allowed],
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return _guard
