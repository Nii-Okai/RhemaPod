"""Subscription endpoints: checkout, status, cancellation, billing portal,
and the provider webhook receiver.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, CurrentUserDep
from app.core.logging import get_logger
from app.core.payments import PaymentError, get_provider
from app.db.database import get_db
from app.models.content_schemas import (
    CheckoutRequest,
    CheckoutResponse,
    PortalResponse,
    SubscriptionPublic,
)
from app.models.models import User
from app.services import auth_service, subscription_service
from app.services.subscription_service import SubscriptionError

log = get_logger("subscriptions_api")

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


async def _actor(db: AsyncSession, current: CurrentUser) -> User:
    user = await auth_service.get_user_by_id(db, current.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


def _err(exc: SubscriptionError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


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


@router.post("/checkout", response_model=CheckoutResponse)
async def start_checkout(
    data: CheckoutRequest, user: CurrentUserDep, db: DbDep
) -> CheckoutResponse:
    """Begin a subscription. Returns a hosted checkout URL — card details never
    touch this API."""
    actor = await _actor(db, user)
    try:
        url, session_id = await subscription_service.start_checkout(db, actor, data.tier)
    except SubscriptionError as exc:
        raise _err(exc)
    return CheckoutResponse(checkout_url=url, session_id=session_id)


@router.post("/portal", response_model=PortalResponse)
async def billing_portal(user: CurrentUserDep, db: DbDep) -> PortalResponse:
    """Hosted billing portal for changing plan or payment method."""
    actor = await _actor(db, user)
    try:
        url = await subscription_service.open_portal(db, actor)
    except SubscriptionError as exc:
        raise _err(exc)
    return PortalResponse(portal_url=url)


@router.delete("/me", response_model=SubscriptionPublic)
async def cancel_subscription(user: CurrentUserDep, db: DbDep) -> SubscriptionPublic:
    """Cancel at period end — access continues until what's been paid for runs out."""
    actor = await _actor(db, user)
    try:
        sub = await subscription_service.cancel(db, actor)
    except SubscriptionError as exc:
        raise _err(exc)
    return SubscriptionPublic(
        tier=sub.tier,
        status=sub.status,
        valid_until=sub.valid_until,
        cancel_at_period_end=sub.cancel_at_period_end,
        is_entitled=subscription_service.entitlement_from_row(sub),
    )


@router.post("/webhook", include_in_schema=False)
async def provider_webhook(request: Request, db: DbDep) -> dict:
    """Receive provider events.

    Unauthenticated by design — the signature is the authentication. Returns
    200 quickly so the provider doesn't retry on slow processing.
    """
    payload = await request.body()
    signature = request.headers.get("stripe-signature")

    try:
        event = get_provider().verify_webhook(payload, signature)
    except PaymentError as exc:
        log.warning("webhook_rejected", reason=str(exc))
        raise HTTPException(status_code=400, detail="Invalid webhook")

    try:
        outcome = await subscription_service.handle_webhook(db, event)
    except SubscriptionError as exc:
        raise _err(exc)
    return {"received": True, "outcome": outcome}
