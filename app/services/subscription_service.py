"""Subscriptions: entitlement, checkout, cancellation, webhook handling.

Source of truth
---------------
The payment provider owns billing state; this database only reflects what the
provider tells us via webhooks. We never infer a payment from our own clock.

Entitlement
-----------
`is_entitled()` is on the hot path — every paid-content playback calls it — so
the answer is cached in Redis for a few minutes and busted whenever a webhook
changes the row.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.payments import PaymentError, get_provider
from app.core.redis import get_redis
from app.models.models import (
    ENTITLED_STATUSES,
    PAID_TIERS,
    ProcessedWebhook,
    Subscription,
    SubscriptionStatus,
    SubscriptionTier,
    User,
)

settings = get_settings()
log = get_logger("subscription")


class SubscriptionError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def _cache_key(user_id: uuid.UUID | str) -> str:
    return f"entitlement:{user_id}"


# ── Core record access ────────────────────────────────────────────────────────
async def get_or_create(db: AsyncSession, user_id: uuid.UUID) -> Subscription:
    """Every user has exactly one subscription row; free users included."""
    sub = (await db.execute(
        select(Subscription).where(Subscription.user_id == user_id)
    )).scalar_one_or_none()
    if sub is None:
        sub = Subscription(user_id=user_id, tier=SubscriptionTier.FREE)
        db.add(sub)
        await db.commit()
        await db.refresh(sub)
    return sub


def entitlement_from_row(sub: Subscription | None) -> bool:
    """Pure function: does this row grant access to paid content right now?"""
    if sub is None or sub.tier not in PAID_TIERS:
        return False
    if sub.status not in ENTITLED_STATUSES:
        return False
    if sub.valid_until is not None:
        now = datetime.now(timezone.utc)
        valid_until = sub.valid_until
        # Rows written by SQLite come back naive; treat them as UTC.
        if valid_until.tzinfo is None:
            valid_until = valid_until.replace(tzinfo=timezone.utc)
        if valid_until <= now:
            return False
    return True


async def invalidate_entitlement(user_id: uuid.UUID | str) -> None:
    try:
        await get_redis().delete(_cache_key(user_id))
    except Exception:
        log.warning("entitlement_cache_invalidation_failed", user_id=str(user_id))


async def is_entitled(db: AsyncSession, user: User | None) -> bool:
    """Cached entitlement check. Falls through to the database if Redis is
    unavailable — a cache outage must not silently revoke everyone's access."""
    if user is None:
        return False

    key = _cache_key(user.id)
    try:
        cached = await get_redis().get(key)
        if cached is not None:
            return cached == "1"
    except Exception:
        log.warning("entitlement_cache_read_failed", user_id=str(user.id))

    sub = (await db.execute(
        select(Subscription).where(Subscription.user_id == user.id)
    )).scalar_one_or_none()
    entitled = entitlement_from_row(sub)

    try:
        await get_redis().setex(
            key, settings.entitlement_cache_seconds, "1" if entitled else "0"
        )
    except Exception:
        log.warning("entitlement_cache_write_failed", user_id=str(user.id))
    return entitled


# ── Checkout & portal ─────────────────────────────────────────────────────────
async def start_checkout(
    db: AsyncSession, user: User, tier: SubscriptionTier
) -> tuple[str, str]:
    sub = await get_or_create(db, user.id)
    if entitlement_from_row(sub) and not sub.cancel_at_period_end:
        raise SubscriptionError("You already have an active subscription", 409)

    provider = get_provider()
    try:
        session = provider.create_checkout_session(
            user_id=str(user.id),
            email=user.email,
            tier=tier.value,
            customer_id=sub.provider_customer_id,
        )
    except PaymentError as exc:
        raise SubscriptionError(str(exc), 502)

    log.info("checkout_started", user_id=str(user.id), tier=tier.value)
    return session.url, session.session_id


async def open_portal(db: AsyncSession, user: User) -> str:
    sub = await get_or_create(db, user.id)
    if not sub.provider_customer_id:
        raise SubscriptionError("No billing account yet — subscribe first", 409)
    try:
        return get_provider().create_portal_session(
            customer_id=sub.provider_customer_id
        )
    except PaymentError as exc:
        raise SubscriptionError(str(exc), 502)


async def cancel(db: AsyncSession, user: User) -> Subscription:
    """Cancel at period end — the member keeps access they've paid for."""
    sub = await get_or_create(db, user.id)
    if sub.tier not in PAID_TIERS or sub.status == SubscriptionStatus.EXPIRED:
        raise SubscriptionError("No active subscription to cancel", 409)
    if sub.cancel_at_period_end:
        raise SubscriptionError("Subscription is already scheduled to cancel", 409)

    if sub.provider_subscription_id:
        try:
            get_provider().cancel_at_period_end(
                subscription_id=sub.provider_subscription_id
            )
        except PaymentError as exc:
            raise SubscriptionError(str(exc), 502)

    sub.cancel_at_period_end = True
    sub.status = SubscriptionStatus.CANCELLED
    await db.commit()
    await db.refresh(sub)
    # Entitlement is unchanged (access runs to period end), but the cached
    # answer may be stale in other respects — refresh it.
    await invalidate_entitlement(user.id)
    log.info("subscription_cancelled", user_id=str(user.id))
    return sub


# ── Webhooks ──────────────────────────────────────────────────────────────────
def _parse_ts(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


async def _already_processed(db: AsyncSession, provider: str, event_id: str) -> bool:
    found = (await db.execute(
        select(ProcessedWebhook).where(
            ProcessedWebhook.provider == provider,
            ProcessedWebhook.event_id == event_id,
        )
    )).scalar_one_or_none()
    return found is not None


async def _find_subscription(
    db: AsyncSession, *, user_id: str | None, provider_subscription_id: str | None
) -> Subscription | None:
    if provider_subscription_id:
        sub = (await db.execute(
            select(Subscription).where(
                Subscription.provider_subscription_id == provider_subscription_id
            )
        )).scalar_one_or_none()
        if sub is not None:
            return sub
    if user_id:
        try:
            uid = uuid.UUID(str(user_id))
        except ValueError:
            return None
        return (await db.execute(
            select(Subscription).where(Subscription.user_id == uid)
        )).scalar_one_or_none()
    return None


async def handle_webhook(db: AsyncSession, event: dict[str, Any]) -> str:
    """Apply a provider event. Idempotent: a redelivered event is a no-op.

    Returns a short outcome string for logging/tests.
    """
    provider_name = get_provider().name
    event_id = str(event.get("id") or "")
    event_type = str(event.get("type") or "")
    if not event_id or not event_type:
        raise SubscriptionError("Webhook missing id or type", 400)

    if await _already_processed(db, provider_name, event_id):
        return "duplicate_ignored"

    obj = (event.get("data") or {}).get("object") or {}
    metadata = obj.get("metadata") or {}
    user_id = metadata.get("user_id")
    tier_raw = metadata.get("tier")
    provider_sub_id = obj.get("subscription") or obj.get("id")
    customer_id = obj.get("customer")

    sub = await _find_subscription(
        db, user_id=user_id, provider_subscription_id=provider_sub_id
    )

    outcome = "ignored"

    if event_type in ("checkout.session.completed", "customer.subscription.created"):
        if sub is not None:
            if tier_raw in (t.value for t in SubscriptionTier):
                sub.tier = SubscriptionTier(tier_raw)
            sub.status = SubscriptionStatus.ACTIVE
            sub.provider = provider_name
            sub.provider_customer_id = customer_id or sub.provider_customer_id
            sub.provider_subscription_id = (
                provider_sub_id or sub.provider_subscription_id
            )
            sub.cancel_at_period_end = False
            period_end = _parse_ts(
                obj.get("current_period_end") or obj.get("expires_at")
            )
            if period_end:
                sub.valid_until = period_end
            outcome = "activated"

    elif event_type in ("invoice.paid", "invoice.payment_succeeded"):
        if sub is not None:
            sub.status = SubscriptionStatus.ACTIVE
            period_end = _parse_ts(obj.get("current_period_end") or obj.get("period_end"))
            if period_end:
                sub.valid_until = period_end
            outcome = "renewed"

    elif event_type == "invoice.payment_failed":
        if sub is not None:
            # Not revoked yet: the provider retries for days. Cutting a paying
            # member off at the first failed charge is the wrong trade.
            sub.status = SubscriptionStatus.PAST_DUE
            outcome = "past_due"

    elif event_type == "customer.subscription.deleted":
        if sub is not None:
            sub.status = SubscriptionStatus.EXPIRED
            sub.tier = SubscriptionTier.FREE
            sub.cancel_at_period_end = False
            sub.valid_until = None
            outcome = "expired"

    elif event_type == "customer.subscription.updated":
        if sub is not None:
            if obj.get("cancel_at_period_end"):
                sub.cancel_at_period_end = True
                sub.status = SubscriptionStatus.CANCELLED
            period_end = _parse_ts(obj.get("current_period_end"))
            if period_end:
                sub.valid_until = period_end
            if tier_raw in (t.value for t in SubscriptionTier):
                sub.tier = SubscriptionTier(tier_raw)
            outcome = "updated"

    db.add(ProcessedWebhook(
        provider=provider_name, event_id=event_id, event_type=event_type
    ))
    await db.commit()

    if sub is not None:
        await invalidate_entitlement(sub.user_id)

    log.info(
        "webhook_handled",
        event_type=event_type,
        event_id=event_id,
        outcome=outcome,
    )
    return outcome


# ── Reconciliation ────────────────────────────────────────────────────────────
async def expire_lapsed(db: AsyncSession) -> int:
    """Sweep subscriptions whose paid period has ended without a renewal.

    Webhooks can be missed (downtime, provider incident). This is the safety net
    that stops a lapsed subscription granting access indefinitely. Run it on a
    schedule.
    """
    now = datetime.now(timezone.utc)
    rows = (await db.execute(
        select(Subscription).where(
            Subscription.tier.in_(PAID_TIERS),
            Subscription.valid_until.is_not(None),
        )
    )).scalars().all()

    expired = 0
    for sub in rows:
        valid_until = sub.valid_until
        if valid_until is None:
            continue
        if valid_until.tzinfo is None:
            valid_until = valid_until.replace(tzinfo=timezone.utc)
        if valid_until <= now and sub.status != SubscriptionStatus.EXPIRED:
            sub.status = SubscriptionStatus.EXPIRED
            sub.tier = SubscriptionTier.FREE
            sub.valid_until = None
            sub.cancel_at_period_end = False
            expired += 1
            await invalidate_entitlement(sub.user_id)

    if expired:
        await db.commit()
        log.info("subscriptions_expired", count=expired)
    return expired
