"""Staff-facing read over billing data (plan §A.3, §W20).

Manager+ only (editors / viewers 403 at the dependency). **Read-only**: no
route here makes an outbound provider call — refunds, plan changes, forced
cancellation and dunning all stay with whichever provider handles billing
(resolved decision 4). No monetary field is exposed anywhere in the response
(resolved decision 2); see `SubscriptionAdminItem`.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, require_role
from app.core.logging import get_logger
from app.db.database import get_read_db
from app.models.content_schemas import (
    Page,
    SubscriptionAdminItem,
    SubscriptionCounts,
)
from app.models.models import SubscriptionStatus, SubscriptionTier, UserRole
from app.services import subscription_service

router = APIRouter(prefix="/admin/subscriptions", tags=["admin subscriptions"])

log = get_logger("admin_subscriptions")

ReadDbDep = Annotated[AsyncSession, Depends(get_read_db)]
ManagerPlus = Annotated[
    CurrentUser, Depends(require_role(UserRole.MANAGER, UserRole.ADMIN))
]


@router.get("/counts", response_model=SubscriptionCounts)
async def subscription_counts(
    user: ManagerPlus, db: ReadDbDep, response: Response
) -> SubscriptionCounts:
    """Active paid · Monthly · Annual (plan §A.3).

    `active_paid` is `subscription_service.count_active_paid_subscribers`
    exactly — the same definition the analytics overview and the publish toast
    use. `monthly` + `annual` partition it, so they always sum to `active_paid`.
    """
    counts = await subscription_service.subscription_counts(db)
    # PII-adjacent aggregate — don't let a shared cache retain it.
    response.headers["Cache-Control"] = "no-store"
    # Audit trail (CWE-778): who read the paying-membership headline counts, and
    # what those counts were. No emails / names / customer ids in the line.
    log.info(
        "admin_subscriptions_counts_read",
        actor_user_id=str(user.id),
        active_paid=counts["active_paid"],
        monthly=counts["monthly"],
        annual=counts["annual"],
    )
    return SubscriptionCounts(**counts)


@router.get("", response_model=Page[SubscriptionAdminItem])
async def list_subscriptions(
    user: ManagerPlus,
    db: ReadDbDep,
    response: Response,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status: SubscriptionStatus | None = Query(
        default=None, description="Filter by subscription status."
    ),
    tier: SubscriptionTier | None = Query(
        default=None, description="Filter by subscription tier."
    ),
) -> Page[SubscriptionAdminItem]:
    """Paginated enumeration of the paying membership, `Subscription` joined to
    `User` for name and email (plan §A.3). Newest first. Hard maximum page size
    of 100.
    """
    rows, total = await subscription_service.list_subscriptions_for_staff(
        db,
        limit=limit,
        offset=offset,
        status_filter=status,
        tier_filter=tier,
    )
    # PII payload (name + email of every paying member) — never cache it.
    response.headers["Cache-Control"] = "no-store"
    # Audit trail (CWE-778): who enumerated the paying membership, with what
    # filters and page window, and how many rows came back. Deliberately no
    # emails / names / provider_customer_id in the line.
    log.info(
        "admin_subscriptions_listed",
        actor_user_id=str(user.id),
        status_filter=status.value if status is not None else None,
        tier_filter=tier.value if tier is not None else None,
        offset=offset,
        limit=limit,
        returned=len(rows),
    )
    return Page[SubscriptionAdminItem](
        items=[SubscriptionAdminItem(**r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
