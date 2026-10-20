"""Church settings API (plan-admin-settings §A.5, D7).

* `GET /settings/public` — no auth. The mobile app's source for contact
  email, comment guidelines and legal links. Served from Redis cache-aside,
  with `ETag: W/"<version>"` and `Cache-Control: public, max-age=300`; a
  matching `If-None-Match` gets a bodiless 304.
* `GET /admin/settings`, `PATCH /admin/settings` — manager and admin.
  PATCH is a partial update guarded by `version` (409 when stale) and
  writes a `settings.updated` audit row in the same transaction.

Both reads use the primary session, not the replica: right after a PATCH
deletes the cache key, a lagging replica could otherwise re-cache the old
row for the full TTL.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import AuditCtx, CurrentUser, require_role
from app.db.database import get_db
from app.models.content_schemas import (
    ChurchSettingsAdmin,
    ChurchSettingsPublic,
    ChurchSettingsUpdate,
)
from app.models.models import UserRole
from app.services import auth_service, settings_service
from app.services.content_service import ContentError

public_router = APIRouter(prefix="/settings", tags=["settings"])
router = APIRouter(prefix="/admin/settings", tags=["admin settings"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ManagerPlus = Annotated[
    CurrentUser, Depends(require_role(UserRole.MANAGER, UserRole.ADMIN))
]

_PUBLIC_CACHE_CONTROL = f"public, max-age={settings_service.PUBLIC_CACHE_TTL}"


@public_router.get(
    "/public",
    response_model=ChurchSettingsPublic,
    responses={304: {"description": "Not modified (matching If-None-Match)."}},
)
async def public_settings(
    response: Response,
    db: DbDep,
    if_none_match: Annotated[str | None, Header()] = None,
):
    try:
        body = await settings_service.get_public(db)
    except ContentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    version = body["version"]
    headers = {
        "ETag": settings_service.etag_for(version),
        "Cache-Control": _PUBLIC_CACHE_CONTROL,
    }
    if settings_service.etag_matches(if_none_match, version):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    response.headers.update(headers)
    return body


@router.get("", response_model=ChurchSettingsAdmin)
async def get_settings(user: ManagerPlus, db: DbDep) -> ChurchSettingsAdmin:
    try:
        return await settings_service.get_admin(db)
    except ContentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.patch("", response_model=ChurchSettingsAdmin)
async def update_settings(
    data: ChurchSettingsUpdate, user: ManagerPlus, db: DbDep, ctx: AuditCtx
) -> ChurchSettingsAdmin:
    """Send only the fields you changed, plus the `version` you loaded. A
    409 means someone else saved first: reload and reapply."""
    actor = await auth_service.get_user_by_id(db, user.id)
    if actor is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    try:
        return await settings_service.update(db, data, actor, ctx)
    except ContentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
