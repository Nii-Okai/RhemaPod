"""Subscriptions: entitlement and the staff-facing read.

Entitlement
-----------
`is_entitled()` is on the hot path — every paid-content playback calls it — so
the answer is cached in Redis for a few minutes and busted whenever the
underlying row changes.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.models.models import (
    ENTITLED_STATUSES,
    PAID_TIERS,
    Subscription,
    SubscriptionStatus,
    SubscriptionTier,
    User,
)

settings = get_settings()
log = get_logger("subscription")

# `subscription_counts` below returns one field per paid tier and hardcodes the
# MONTHLY / ANNUAL pair, so the `active_paid == monthly + annual` invariant only
# holds while those are the *only* paid tiers. If a third paid tier is ever added
# to `PAID_TIERS`, `count_active_paid_subscribers` picks it up but the explicit
# per-tier fields do not — this assert fires at import so the omission is caught
# here, not in a drifting analytics tile. Grow `subscription_counts` (and its
# DTO) a field per new paid tier when it does.
assert set(PAID_TIERS) == {
    SubscriptionTier.MONTHLY,
    SubscriptionTier.ANNUAL,
}, "PAID_TIERS changed — subscription_service.subscription_counts must grow a field"


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


# Paid subscribers as counted for admin-facing figures (the analytics overview
# and the publish toast). Deliberately ACTIVE + CANCELLED only — PAST_DUE is
# entitled (see ENTITLED_STATUSES) but excluded here so the "paid members"
# number is stable and matches analytics.overview(); a publish push isn't an
# entitlement decision.
_PAID_SUBSCRIBER_STATUSES = (SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED)


async def count_active_paid_subscribers(db: AsyncSession) -> int:
    """Paid subscribers for an admin figure (publish toast / analytics overview).

    One `SELECT count(*)`: a paid tier (`PAID_TIERS`) in `_PAID_SUBSCRIBER_STATUSES`.
    Not an entitlement decision — `is_entitled()` is the source of truth for access.
    """
    return (await db.execute(
        select(func.count())
        .select_from(Subscription)
        .where(
            Subscription.tier.in_(PAID_TIERS),
            Subscription.status.in_(_PAID_SUBSCRIBER_STATUSES),
        )
    )).scalar_one()


# ── Staff-facing read (plan §A.3, §W20) ──────────────────────────────────────
# Manager+ enumeration of the paying membership. Read-only: nothing below makes
# an outbound provider call, and no monetary field is selected or returned
# (resolved decisions 2 and 4).
async def list_subscriptions_for_staff(
    db: AsyncSession,
    *,
    limit: int = 25,
    offset: int = 0,
    status_filter: SubscriptionStatus | None = None,
    tier_filter: SubscriptionTier | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """`Subscription` joined to `User`, newest first. Returns (rows, total) —
    total is the filtered count before paging.

    The join selects only the columns the `SubscriptionAdminItem` DTO needs
    (id, user_id, name, email, tier, status, period end, customer id, created)
    — the PII surface is kept as tight as the DTO. `limit` is clamped to 100
    defensively even though the router already bounds it (mirrors
    `auth_service.list_users`).
    """
    conditions = []
    if status_filter is not None:
        conditions.append(Subscription.status == status_filter)
    if tier_filter is not None:
        conditions.append(Subscription.tier == tier_filter)

    total = (await db.execute(
        select(func.count())
        .select_from(Subscription)
        .where(*conditions)
    )).scalar_one()

    rows = (await db.execute(
        select(
            Subscription.id,
            Subscription.user_id,
            User.full_name,
            User.email,
            Subscription.tier,
            Subscription.status,
            Subscription.valid_until,
            Subscription.provider_customer_id,
            Subscription.created_at,
        )
        .join(User, User.id == Subscription.user_id)
        .where(*conditions)
        # `created_at` is `server_default=func.now()` — transaction-start time on
        # Postgres, 1s resolution on SQLite — so equal timestamps are common and
        # `created_at` alone is not a total order. `id` desc is the deterministic
        # tiebreaker: without it a paged client can repeat or drop a row when two
        # rows share a timestamp (W21 builds the paginated table on this).
        .order_by(Subscription.created_at.desc(), Subscription.id.desc())
        .limit(max(1, min(limit, 100)))
        .offset(max(0, offset))
    )).all()

    return [
        {
            "id": r.id,
            "user_id": r.user_id,
            "user_name": r.full_name,
            "user_email": r.email,
            "tier": r.tier,
            "status": r.status,
            "current_period_end": r.valid_until,
            "provider_customer_id": r.provider_customer_id,
            "created_at": r.created_at,
        }
        for r in rows
    ], total


async def subscription_counts(db: AsyncSession) -> dict[str, int]:
    """The three Subscriptions tiles (plan §A.3).

    `active_paid` is `count_active_paid_subscribers` verbatim — one definition,
    not a second. `monthly` / `annual` reuse that function's exact status
    predicate (`_PAID_SUBSCRIBER_STATUSES`) so they partition the same
    population and `active_paid == monthly + annual` by construction.
    """
    active_paid = await count_active_paid_subscribers(db)

    async def _tier_count(tier: SubscriptionTier) -> int:
        return (await db.execute(
            select(func.count())
            .select_from(Subscription)
            .where(
                Subscription.tier == tier,
                Subscription.status.in_(_PAID_SUBSCRIBER_STATUSES),
            )
        )).scalar_one()

    return {
        "active_paid": int(active_paid),
        "monthly": int(await _tier_count(SubscriptionTier.MONTHLY)),
        "annual": int(await _tier_count(SubscriptionTier.ANNUAL)),
    }


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
