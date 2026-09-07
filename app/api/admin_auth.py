import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import email as email_module
from app.core.config import get_settings
from app.core.dependencies import CurrentUser, require_role
from app.db.database import get_db

from app.models.models import UserRole
from app.models.content_schemas import Page
from app.models.schemas import (
    RoleUpdateRequest,
    StaffCreateRequest,
    StaffCreateResponse,
    UserPublic,
)
from app.services import auth_service
from app.services.auth_service import AuthError

settings = get_settings()

router = APIRouter(prefix="/users", tags=["admin auth"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ManagerPlus = Annotated[CurrentUser, Depends(require_role(UserRole.MANAGER, UserRole.ADMIN))]


# User management (managers/admins)
async def _actor(db: AsyncSession, current: CurrentUser):
    user = await auth_service.get_user_by_id(db, current.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


@router.get("", response_model=Page[UserPublic])
async def list_users(
    user: ManagerPlus,
    db: DbDep,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> Page[UserPublic]:
    rows, total = await auth_service.list_users(db, limit=limit, offset=offset)
    return Page[UserPublic](
        items=[UserPublic.model_validate(u) for u in rows],
        total=total, limit=limit, offset=offset,
    )


@router.post("", response_model=StaffCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_staff(
    data: StaffCreateRequest, user: ManagerPlus, db: DbDep
) -> StaffCreateResponse:
    """Create an editor/manager/admin account. A temporary password is set
    server-side; the user receives an email invite to set their own password."""
    actor = await _actor(db, user)
    try:
        created, invite_token = await auth_service.create_staff(
            db, data.email, data.full_name, data.role, actor,
            send_invite=email_module.send_staff_invite,
        )
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message)

    # Surface the link directly only while the console email backend is active,
    # so it's usable in dev. Drop this once real email is wired in Phase 6.
    invite_link = None
    if not settings.is_production:
        invite_link = email_module._reset_link(invite_token)

    return StaffCreateResponse(
        user=UserPublic.model_validate(created), invite_link=invite_link
    )


@router.patch("/{user_id}/role", response_model=UserPublic)
async def change_role(
    user_id: uuid.UUID, data: RoleUpdateRequest, user: ManagerPlus, db: DbDep
) -> UserPublic:
    actor = await _actor(db, user)
    try:
        updated = await auth_service.change_role(db, user_id, data.role, actor)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message)
    return UserPublic.model_validate(updated)
