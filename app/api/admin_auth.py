import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import email as email_module
from app.core.config import get_settings
from app.core.dependencies import AuditCtx, CurrentUser, require_role
from app.db.database import get_db

from app.models.models import UserRole
from app.models.content_schemas import Page
from app.models.schemas import (
    ActiveUpdateRequest,
    RoleCounts,
    RoleUpdateRequest,
    StaffCreateRequest,
    StaffCreateResponse,
    UserActiveResponse,
    UserPublic,
)
from app.services import auth_service
from app.services.auth_service import AuthError
from app.services.content_service import ContentError
from app.core.token_store import TokenStoreUnavailable

settings = get_settings()

router = APIRouter(prefix="/users", tags=["admin auth"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ManagerPlus = Annotated[CurrentUser, Depends(require_role(UserRole.MANAGER, UserRole.ADMIN))]
AdminOnly = Annotated[CurrentUser, Depends(require_role(UserRole.ADMIN))]


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
    role: UserRole | None = Query(
        default=None,
        description="Narrow within staff roles (editor / manager / admin). "
        "`viewer` is rejected — the staff directory never lists viewers.",
    ),
) -> Page[UserPublic]:
    """Staff accounts only (editor / manager / admin), for every actor — a
    viewer is never a row, with or without `role` (plan §A.6, decision 5).
    Use the aggregate at `GET /users/role-counts` for the viewer headcount.
    """
    if role == UserRole.VIEWER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The staff directory does not include viewers.",
        )
    rows, total = await auth_service.list_users(
        db, limit=limit, offset=offset, role_filter=role
    )
    return Page[UserPublic](
        items=[auth_service.to_user_public(u) for u in rows],
        total=total, limit=limit, offset=offset,
    )


@router.get("/members", response_model=Page[UserPublic])
async def list_members(
    user: AdminOnly,
    db: DbDep,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    q: str | None = Query(default=None, max_length=200, description="Email or name contains"),
    status_filter: Literal["all", "active", "deactivated"] = Query(default="all", alias="status"),
) -> Page[UserPublic]:
    """Mobile app accounts (role `viewer`), newest first. Admin only: the
    staff directory above never lists viewers, and this list exists so an
    admin can deactivate or remove one (`PATCH /users/{id}/active`,
    `DELETE /users/{id}`)."""
    rows, total = await auth_service.list_members(
        db, limit=limit, offset=offset, search=q, status=status_filter
    )
    return Page[UserPublic](
        items=[auth_service.to_user_public(u) for u in rows],
        total=total, limit=limit, offset=offset,
    )


@router.get("/role-counts", response_model=RoleCounts)
async def role_counts(user: ManagerPlus, db: DbDep) -> RoleCounts:
    """Full-table `GROUP BY role` headcount for the Users & roles tiles.

    Deliberately **not** staff-scoped like `GET /users`: the `viewer` bucket is
    a real number here because a count identifies no one (plan §A.6).
    """
    counts = await auth_service.role_counts(db)
    return RoleCounts(
        viewer=counts[UserRole.VIEWER.value],
        editor=counts[UserRole.EDITOR.value],
        manager=counts[UserRole.MANAGER.value],
        admin=counts[UserRole.ADMIN.value],
        total=sum(counts.values()),
    )


@router.post("", response_model=StaffCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_staff(
    data: StaffCreateRequest, user: ManagerPlus, db: DbDep, ctx: AuditCtx
) -> StaffCreateResponse:
    """Create an editor/manager/admin account. A temporary password is set
    server-side; the user receives an email invite to set their own password."""
    actor = await _actor(db, user)
    try:
        created, invite_token = await auth_service.create_staff(
            db, data.email, data.full_name, data.role, actor,
            send_invite=email_module.send_staff_invite, ctx=ctx,
        )
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message)
    except TokenStoreUnavailable:
        # The create is transactional and rolls back on this, so nothing was
        # created. Say so explicitly — the generic 503 handler's "please retry"
        # otherwise reads as "your account may or may not exist".
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "The invite could not be recorded (auth store unavailable) — "
                "the account was not created. Please try again."
            ),
        )

    # Surface the link directly only while the console email backend is active,
    # so it's usable in dev. Drop this once real email is wired in Phase 6.
    invite_link = None
    if not settings.is_production:
        invite_link = email_module._reset_link(invite_token)

    return StaffCreateResponse(
        user=auth_service.to_user_public(created), invite_link=invite_link
    )


@router.patch("/{user_id}/role", response_model=UserPublic)
async def change_role(
    user_id: uuid.UUID,
    data: RoleUpdateRequest,
    user: ManagerPlus,
    db: DbDep,
    ctx: AuditCtx,
) -> UserPublic:
    actor = await _actor(db, user)
    try:
        updated = await auth_service.change_role(db, user_id, data.role, actor, ctx=ctx)
    except ContentError as exc:
        # The last-admin invariant (409) surfaces as a typed ContentError from
        # the shared guard; everything else here is still AuthError -> 400.
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message)
    return auth_service.to_user_public(updated)


@router.patch("/{user_id}/active", response_model=UserActiveResponse)
async def set_active(
    user_id: uuid.UUID,
    data: ActiveUpdateRequest,
    user: ManagerPlus,
    db: DbDep,
    ctx: AuditCtx,
) -> UserActiveResponse:
    """Deactivate (`is_active=false`) or reactivate a staff account.

    Managers may act on editors only; admins on anyone, except where it would
    leave zero active admins (409). Deactivation commits first, then revokes
    refresh tokens best-effort: a Redis outage still returns 200 with
    `revocation_deferred=true` rather than 503, because every request re-checks
    `is_active` regardless (plan §W18, GATE 6).
    """
    actor = await _actor(db, user)
    try:
        updated, revocation_deferred = await auth_service.set_active(
            db, user_id, data.is_active, actor, ctx=ctx
        )
    except ContentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message)
    return UserActiveResponse(
        user=auth_service.to_user_public(updated),
        revocation_deferred=revocation_deferred,
    )


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID, user: ManagerPlus, db: DbDep, ctx: AuditCtx
) -> Response:
    """Permanently remove a staff or mobile account. Admin only (a manager gets 403).
    The account must already be deactivated (409 otherwise), can't be your
    own, and can't have authored content or review history (409, with what
    it is linked to — keep such accounts deactivated)."""
    actor = await _actor(db, user)
    try:
        await auth_service.delete_user(db, user_id, actor, ctx=ctx)
    except ContentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{user_id}/resend-invite", response_model=StaffCreateResponse)
async def resend_invite(
    user_id: uuid.UUID, user: ManagerPlus, db: DbDep, ctx: AuditCtx
) -> StaffCreateResponse:
    """Re-issue the invite for a staff account that has not finished
    set-password. Same authz as `PATCH /users/{id}/active`. A 409 means the
    account has already been activated (nothing to resend); a 503 means the
    single-use invite jti could not be recorded (Redis down) — unlike
    deactivate, this operation cannot degrade gracefully without it.
    """
    actor = await _actor(db, user)
    try:
        target, invite_token = await auth_service.resend_invite(
            db, user_id, actor, send_invite=email_module.send_staff_invite,
            ctx=ctx,
        )
    except ContentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message)
    except TokenStoreUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "The invite link could not be issued (auth store unavailable). "
                "Please try again."
            ),
        )

    invite_link = None
    if not settings.is_production:
        invite_link = email_module._reset_link(invite_token)

    return StaffCreateResponse(
        user=auth_service.to_user_public(target), invite_link=invite_link
    )
