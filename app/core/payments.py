"""Payment provider abstraction.

Two backends:
  * StripeProvider — real Stripe Checkout, Billing Portal, and webhooks.
  * MockProvider   — in-process stub for tests and local dev with no Stripe
                     account. Issues fake checkout URLs and signs/verifies
                     webhook payloads trivially.

Nothing outside this module imports `stripe`, so swapping providers (or adding
Paystack/Flutterwave for a Nigerian church, say) touches only this file.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

from app.core.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
log = get_logger("payments")


class PaymentError(Exception):
    pass


@dataclass(frozen=True)
class CheckoutSession:
    session_id: str
    url: str


class PaymentProvider(Protocol):
    name: str

    def create_checkout_session(
        self, *, user_id: str, email: str, tier: str, customer_id: str | None
    ) -> CheckoutSession: ...

    def create_portal_session(self, *, customer_id: str) -> str: ...

    def cancel_at_period_end(self, *, subscription_id: str) -> None: ...

    def get_subscription_period_end(
        self, *, subscription_id: str
    ) -> datetime | None:
        """The subscription's current billing-period end, or None when it
        cannot be determined. Never raises for an unknown id."""
        ...

    def verify_webhook(self, payload: bytes, signature: str | None) -> dict[str, Any]: ...


class MockProvider:
    """Deterministic stub. Webhook 'verification' just parses JSON, so tests can
    post events directly without signing."""

    name = "mock"

    def __init__(self) -> None:
        self._counter = 0
        # subscription_id -> current_period_end. Seeded by tests via
        # `set_subscription_period_end`; empty otherwise. Kept on the instance
        # so a fresh MockProvider (see the `client` fixture) starts clean and
        # nothing bleeds between tests.
        self._period_ends: dict[str, datetime] = {}

    def reset(self) -> None:
        self._counter = 0
        self._period_ends.clear()

    def set_subscription_period_end(
        self, subscription_id: str, period_end: datetime | None
    ) -> None:
        """Test seam: declare what `get_subscription_period_end` should return
        for this subscription id."""
        if period_end is None:
            self._period_ends.pop(subscription_id, None)
        else:
            self._period_ends[subscription_id] = period_end

    def create_checkout_session(
        self, *, user_id: str, email: str, tier: str, customer_id: str | None
    ) -> CheckoutSession:
        self._counter += 1
        sid = f"cs_mock_{self._counter}_{user_id[:8]}"
        return CheckoutSession(
            session_id=sid,
            url=f"https://checkout.mock.invalid/{sid}?tier={tier}",
        )

    def create_portal_session(self, *, customer_id: str) -> str:
        return f"https://portal.mock.invalid/{customer_id}"

    def cancel_at_period_end(self, *, subscription_id: str) -> None:
        log.info("mock_cancel_scheduled", subscription_id=subscription_id)

    def get_subscription_period_end(
        self, *, subscription_id: str
    ) -> datetime | None:
        return self._period_ends.get(subscription_id)

    def verify_webhook(self, payload: bytes, signature: str | None) -> dict[str, Any]:
        try:
            return json.loads(payload.decode())
        except Exception as exc:
            raise PaymentError("Malformed webhook payload") from exc


class StripeProvider:
    name = "stripe"

    def __init__(self) -> None:
        try:
            import stripe
        except ImportError as exc:  # pragma: no cover
            raise PaymentError(
                "The `stripe` package is required. Install it, or leave "
                "STRIPE_SECRET_KEY unset to use the mock provider."
            ) from exc
        stripe.api_key = settings.stripe_secret_key
        self._stripe = stripe

    def _price_for(self, tier: str) -> str:
        price = {
            "monthly": settings.stripe_price_monthly,
            "annual": settings.stripe_price_annual,
        }.get(tier)
        if not price:
            raise PaymentError(f"No configured price for tier '{tier}'")
        return price

    def create_checkout_session(
        self, *, user_id: str, email: str, tier: str, customer_id: str | None
    ) -> CheckoutSession:
        params: dict[str, Any] = {
            "mode": "subscription",
            "line_items": [{"price": self._price_for(tier), "quantity": 1}],
            "success_url": f"{settings.frontend_base_url.rstrip('/')}/subscription/success",
            "cancel_url": f"{settings.frontend_base_url.rstrip('/')}/subscription/cancel",
            # Echoed back on the webhook so we can match the payment to a user
            # without trusting anything the client sends.
            "metadata": {"user_id": user_id, "tier": tier},
            "subscription_data": {"metadata": {"user_id": user_id, "tier": tier}},
        }
        if customer_id:
            params["customer"] = customer_id
        else:
            params["customer_email"] = email

        session = self._stripe.checkout.Session.create(**params)
        return CheckoutSession(session_id=session["id"], url=session["url"])

    def create_portal_session(self, *, customer_id: str) -> str:
        session = self._stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{settings.frontend_base_url.rstrip('/')}/account",
        )
        return session["url"]

    def cancel_at_period_end(self, *, subscription_id: str) -> None:
        self._stripe.Subscription.modify(subscription_id, cancel_at_period_end=True)

    def get_subscription_period_end(
        self, *, subscription_id: str
    ) -> datetime | None:
        try:
            sub = self._stripe.Subscription.retrieve(subscription_id)
        except Exception as exc:
            raise PaymentError(
                f"Could not retrieve subscription '{subscription_id}'"
            ) from exc
        epoch = sub.get("current_period_end") if hasattr(sub, "get") else None
        if epoch is None:
            return None
        return datetime.fromtimestamp(int(epoch), tz=timezone.utc)

    def verify_webhook(self, payload: bytes, signature: str | None) -> dict[str, Any]:
        if not signature:
            raise PaymentError("Missing webhook signature")
        try:
            return self._stripe.Webhook.construct_event(
                payload, signature, settings.stripe_webhook_secret
            )
        except Exception as exc:
            raise PaymentError("Invalid webhook signature") from exc


_provider: PaymentProvider | None = None


def get_provider() -> PaymentProvider:
    global _provider
    if _provider is None:
        if settings.stripe_secret_key:
            _provider = StripeProvider()
            log.info("payment_provider", provider="stripe")
        elif settings.is_production:
            # The mock provider accepts ANY unsigned webhook. In production that
            # is a free-subscription vulnerability, so refuse outright.
            raise PaymentError(
                "Refusing to use the mock payment provider in production. "
                "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET."
            )
        else:
            _provider = MockProvider()
            log.warning("payment_provider", provider="mock", live=False)
    return _provider


def set_provider(provider: PaymentProvider | None) -> None:
    """Override the provider (used by tests)."""
    global _provider
    _provider = provider
