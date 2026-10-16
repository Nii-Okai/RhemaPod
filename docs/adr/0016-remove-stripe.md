# ADR 0016 — Remove Stripe: no replacement now, provider-neutral schema kept for native IAP

- **Status:** Proposed (flips to Accepted after S9 review and `[HUMAN_GATE SR4]` merge to
  `dev`).
- **Date:** 2026-10-16
- **Scope:** Backend — the four Stripe-only routes and their service logic
  (`app/api/subscriptions.py`, `app/services/subscription_service.py`), the three Stripe-only DTOs
  (`app/models/content_schemas.py`), the payment seam (`app/core/payments.py`, deleted outright),
  the `stripe_*` config fields and production-preflight checks (`app/core/config.py`,
  `app/scripts/preflight.py`), the `stripe` dependency (`pyproject.toml`/`uv.lock`), and the seed
  data (`app/scripts/seed_dev.py`). Admin portal — the "Open in Stripe" column and link
  (`admin_portal/components/subscriptions/*`). **Not in scope:** any native IAP/RevenueCat design —
  no billing seam, no sync endpoint, no paywall UI. That is explicitly future work, not started
  here.
- **Deciders:** Isaac (+ planner, senior-dev-backend, senior-dev-frontend)
- **Relates to:** `plans/plan-stripe-removal.md` (the contract this ADR closes out);
  `status.md` "STRIPE-REMOVAL — S1" through "S8"; supersedes parts of ADR 0001 and ADR 0006 by
  note (see Decision §4) without editing either file.

> *"There are going to be purchases in the app, some sermons will be free and others will be paid
> to access. We will use native subscription for this instead of the previous proposed stripe
> option. For now remove Stripe no IAP. We will revisit using RevenueCat after the app is being
> tested by other users."* — Isaac
>
> Stripe is removed entirely — the checkout/portal/cancel/webhook endpoints, the service logic
> behind them, the payment seam, the config, the dependency, and the admin portal's "Open in
> Stripe" link — and nothing replaces it yet. The provider-neutral `Subscription` columns
> (`provider`, `provider_customer_id`, `provider_subscription_id`) are kept unchanged, deliberately,
> for a future native in-app-purchase integration. `GET /subscriptions/me` and the staff read API
> (`GET /admin/subscriptions`, `/admin/subscriptions/counts`) keep working exactly as before, now
> proven by direct row seeding instead of webhooks.

---

## Context

Isaac's decision above forced three questions, each with a real wrong answer:

1. **How much of the Stripe surface comes out, and what (if anything) replaces it today?** The
   quote is explicit: remove Stripe now, build no IAP yet. That rules out leaving a stub seam
   "ready" for IAP (D5) and rules out starting IAP work in the same change (Scope, above).
2. **Does the `Subscription` schema change?** Stripe touches seven columns on that model. A
   migration could rename or drop the Stripe-specific ones, but nothing yet is known about what a
   native IAP integration (store receipt validation, RevenueCat webhooks, or similar) will actually
   need to store.
3. **What happens to paid-tier content and existing entitlement logic while no provider exists?**
   `ContentTier.PAID` gating, `is_entitled`, `expire_lapsed`, and the staff read API all predate
   this decision and have their own correctness properties independent of which provider is behind
   them.

## Decision

### 1. Stripe removed entirely; nothing replaces it now (D1)

Every Stripe-specific surface is deleted: the four endpoints (`POST /subscriptions/checkout`,
`POST /subscriptions/portal`, `DELETE /subscriptions/me`, `POST /subscriptions/webhook`, all now
404/405), the service functions behind them, the three DTOs (`CheckoutRequest`,
`CheckoutResponse`, `PortalResponse`), `app/core/payments.py` outright (no stub left in its place
— D5), the `stripe_*` config fields and `payments_are_live`, both production-preflight checks that
cited them, and the `stripe` package dependency. `GET /subscriptions/me`,
`app/api/admin_subscriptions.py`, `SubscriptionAdminItem` (same field set, reworded docstring),
`is_entitled`/`entitlement_from_row`, and `expire_lapsed` all keep working unchanged (D3) — this is
a removal of the payment provider, not a change to entitlement logic.

### 2. Schema unchanged — provider-neutral columns kept, deliberately, for a future native IAP (D2)

`Subscription` (`app/models/models.py`) keeps every column exactly as it was: `tier`, `status`,
`valid_until`, `provider`, `provider_customer_id`, `provider_subscription_id`,
`cancel_at_period_end`. No migration. These columns were already named provider-neutrally, not
Stripe-specifically, so a future native IAP integration (most likely RevenueCat, per Isaac's
quote) can start by writing a new value into `provider` and populating the same
`provider_customer_id`/`provider_subscription_id` pair with store-native identifiers — it does not
need a schema change to begin. The only edit inside `models.py` is the column comment at ~L547,
which no longer names Stripe.

### 3. Deferred, not reversed — and Stripe specifically will never be the mechanism

`plans/plan-mobile-app.md` L1 ("Paid tier / IAP — **Cut indefinitely.** Free content only. No
paywall screens, no membership/billing section, no `PAID` badge.") is **not edited by this ADR**
and still stands exactly as written (repo convention — historical documents aren't rewritten,
D10). What this decision changes is not that line but the mechanism for whenever Isaac does
revisit it: Stripe is permanently off the table for that future work. The quote's own sequencing —
remove Stripe now, no IAP now, revisit RevenueCat once the app has outside testers — makes this a
deferral of scope, not a reversal of L1's "cut indefinitely." Until that future work starts, every
member reads as FREE-tier-only in practice, since nothing can grant entitlement except a
hand-inserted DB row (§ Consequences).

### 4. Supersedes ADR 0001 and ADR 0006 by note, not by edit

Per repo convention, neither ADR is modified (D10). This section is the supersession record.

- **ADR 0001** (Tier 1 production readiness) rationalized `verify_webhook`
  (`stripe.Webhook.construct_event`) as pure CPU with no network hop, and listed "Stripe's
  `*_async` clients" as a rejected option under its sync/async storage-and-payments client
  decision. Both no longer apply — there is no Stripe client, sync or async, and no webhook
  verification left in the codebase to reason about.
- **ADR 0006** (Staff subscriptions read API) decision 2's "zero new outbound Stripe surface"
  framing said mutating actions (refunds, plan changes, forced cancellation, dunning, retry
  triggering) "stay in the Stripe dashboard, which already owns the audit trail." There is no
  Stripe dashboard anymore for them to stay in. The "Open in Stripe" UI affordance that decision
  anticipated (§A.3, W21 — hidden when `provider_customer_id` is null) is deleted along with the
  rest of the admin portal's provider-link column (D7). **What still stands, unchanged:** the
  read-only API itself (`GET /admin/subscriptions`, `/admin/subscriptions/counts`), its "zero new
  *stored* surface" guarantee (no column, no write path), and decision 3's no-monetary-field rule
  — `SubscriptionAdminItem`'s nine fields, including the nullable `provider_customer_id`, are
  unchanged by this plan.

## Consequences

- **Positive:** no dead payment code, config, or dependency left to maintain against a provider
  that was never configured live. The provider-neutral schema (D2) means a future native IAP
  integration starts from a clean, already-correctly-shaped `Subscription` model instead of a
  Stripe-shaped one that would need undoing first. The entitlement path (`is_entitled`,
  `expire_lapsed`, the staff read API) is now proven by direct row seeding rather than simulated
  webhooks, which is a more direct test of the actual guarantee.
- **Negative (accepted):**
  1. **Paid-tier sermons become unreachable for every member** until IAP ships.
     `ContentTier.PAID` gating (`content_service.py`, `comments_service.py`, series episodes) stays
     exactly as it is; nobody can become entitled except through a hand-inserted DB row. If any
     published sermon is currently `PAID`, members will see it locked. Re-tiering content is
     explicitly **not** part of this plan — that is Isaac's own call, outside it.
  2. Any developer's local `.env` with leftover `STRIPE_*` lines **fails to boot** once the config
     change lands, because `pydantic-settings` rejects unknown keys in a dotenv file. Isaac's own
     `.env` was checked and had none. Deployed environments inject process env vars, which are
     unaffected either way.
- **Neutral:** `openapi.json`, `admin_portal/lib/api/schema.d.ts`, and `mobile/lib/api/schema.d.ts`
  lose the four removed paths and three removed schemas; `SubscriptionAdminItem`'s docstring is
  reworded to be provider-neutral but its field set is unchanged. `ProcessedWebhook` stays — it is
  shared with the unrelated Cloudflare Stream webhook (D4). `.githooks/pre-commit`'s Stripe
  live-key scanner is left in place; it's a harmless secret pattern and costs nothing to keep (D9).

## Alternatives considered

- **Keep `app/core/payments.py` as a dormant/stubbed seam:** rejected (D5). The future IAP seam has
  a fundamentally different shape (store sync, not checkout/portal/webhook), so a Stripe-shaped
  `Protocol` would give it no head start — it would just be dead code pretending to be a head
  start.
- **Build native IAP now instead of only removing Stripe:** rejected. Out of scope per Isaac's own
  sequencing ("For now remove Stripe no IAP"); there are no outside testers yet, which is the
  condition Isaac set for even revisiting it.
- **Migrate the `Subscription` schema now to anticipate IAP's shape:** rejected (D2). Nothing is
  yet known about what RevenueCat or another native IAP provider will actually require; the
  existing columns are already provider-neutral enough to defer that decision without cost.
- **Leave the "Open in Stripe" link rendering, since `provider_customer_id` stays in the DTO:**
  rejected (D7). The column stays for a future provider to populate, but nothing populates it
  today — rendering a link to a dashboard that doesn't exist for this field would be dishonest UI,
  not a harmless no-op.
