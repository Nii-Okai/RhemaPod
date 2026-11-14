"""The signed-in app's push-notification devices."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUserDep
from app.db.database import get_db
from app.services import push_service

router = APIRouter(prefix="/me/push-devices", tags=["notifications"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

# Expo push tokens look like `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`.
_TOKEN_PATTERN = r"^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$"


class PushDeviceRegister(BaseModel):
    token: str = Field(pattern=_TOKEN_PATTERN, max_length=255)
    platform: Literal["ios", "android"]
    new_sermons: bool = True


class PushDeviceUnregister(BaseModel):
    token: str = Field(pattern=_TOKEN_PATTERN, max_length=255)


class PushDevicePublic(BaseModel):
    token: str
    platform: str
    new_sermons: bool


@router.put("", response_model=PushDevicePublic)
async def register_push_device(
    data: PushDeviceRegister, user: CurrentUserDep, db: DbDep
) -> PushDevicePublic:
    """Register (or refresh) this install's push token and its preferences.
    The app calls this on every sign-in and whenever the settings change."""
    device = await push_service.register_device(
        db, user.id, data.token, data.platform, data.new_sermons
    )
    return PushDevicePublic(token=device.token, platform=device.platform, new_sermons=device.new_sermons)


@router.post("/remove", status_code=status.HTTP_204_NO_CONTENT)
async def unregister_push_device(
    data: PushDeviceUnregister, user: CurrentUserDep, db: DbDep
) -> Response:
    """Stop pushing to this install (the app calls this when signing out).
    A POST with a body rather than DELETE with the token in the path, so the
    token never lands in access logs."""
    await push_service.unregister_device(db, user.id, data.token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
