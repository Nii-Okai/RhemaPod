"""Subscription endpoints: read-only status for the current member.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, CurrentUserDep
from app.db.database import get_db
from app.models.content_schemas import SubscriptionPublic
from app.models.models import User
from app.services import auth_service, subscription_service

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


async def _actor(db: AsyncSession, current: CurrentUser) -> User:
    user = await auth_service.get_user_by_id(db, current.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


@router.get("/me", response_model=SubscriptionPublic)
async def my_subscription(user: CurrentUserDep, db: DbDep) -> SubscriptionPublic:
    actor = await _actor(db, user)
    sub = await subscription_service.get_or_create(db, actor.id)
    return SubscriptionPublic(
        tier=sub.tier,
        status=sub.status,
        valid_until=sub.valid_until,
        cancel_at_period_end=sub.cancel_at_period_end,
        is_entitled=subscription_service.entitlement_from_row(sub),
    )
