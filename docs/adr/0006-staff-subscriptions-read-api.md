# ADR 0006 — Staff subscriptions read API: Manager+, read-only, no monetary field

- **Status:** Accepted
- **Date:** 2026-09-10
- **Scope:** `fastapi_sermon` backend — new `GET /api/v1/admin/subscriptions` and
  `GET /api/v1/admin/subscriptions/counts`
- **Deciders:** Isaac; architect, planner; `security-reviewer` (PII — staff-readable
  enumeration of paying members) + `reviewer-gilfoyle` (implementation review pending on W20)
- **Relates to:** `plans/plan-admin-portal-phase2.md` §A.3, §W20, resolved decisions 2, 4,
  11, 12; risk P4; `plans/plan-admin-portal.md` `[HUMAN_GATE 3]` (standing backend gate)

> Built by W20. This records what a future reader cannot recover from the diff:
> why the portal's first staff-facing read over billing data is Manager+, why it
> makes **no** outbound Stripe call and never will, why the row DTO deliberately
> omits every amount / price / currency field, and the PII shape of a paginated
> enumeration of the paying membership joined to name + email.

---

## Context

The Phase 2 "Subscriptions" screen (W21) needs to answer, for staff, *who is
subscribed, on what, until when* — plus three headline counts. Every route under
`/api/v1/subscriptions/*` today is **self-service** for the logged-in member
(`GET /subscriptions/me`, checkout, portal, cancel, the webhook receiver). There
is no staff read. W20 adds it.

Facts established from the code, not assumed:

| Observation | Evidence |
|---|---|
| `Subscription` has one row per user (free included); the paying columns are `tier`, `status`, `valid_until`, `provider_customer_id` | `app/models/models.py::Subscription` |
| **No amount is stored** on `Subscription`; `handle_webhook` never parses one; config holds Stripe *price IDs*, not amounts | `subscription_service.handle_webhook`, `app/core/config.py` |
| `count_active_paid_subscribers` already exists — `tier IN (monthly, annual)` AND `status IN (active, cancelled)` — and is the definition behind the analytics overview and the publish toast | `subscription_service.count_active_paid_subscribers`, `_PAID_SUBSCRIBER_STATUSES` |
| `provider_customer_id` is nullable — null until first payment; `MockProvider` never sets it | `Subscription.provider_customer_id`, `app/core/payments.py::MockProvider` |
| `PaymentProvider` carries `cancel_at_period_end(...)` and other mutating calls; the provider is a module singleton reached via `get_provider()` | `app/core/payments.py` |
| Other admin list routes cap the page at `limit: int = Query(25, ge=1, le=100)` | `app/api/admin_auth.py::list_users` |

Resolved decisions locked by Isaac and not relitigated here: **decision 4**
(Subscriptions is read-only; zero new outbound Stripe surface), **decision 2**
(MRR is cut; no dollar figure anywhere in the portal), **decision 12** (USD-only,
no currency column). GATE 4 settled the posture, so this is **not** its own gate
(decision 11) — it gets a mandatory `security-reviewer` pass at W20 instead.

## Decision

### 1 — Manager+ on billing data, enforced at the dependency

Both routes sit behind `require_role(UserRole.MANAGER, UserRole.ADMIN)`. An
editor or viewer is refused **403 at the dependency**, before any handler code
runs — the same `ManagerPlus` alias `admin_auth.py` and `analytics.py` already
use. There is no actor-dependent widening: a manager and an admin see exactly
the same rows.

The read uses the replica session (`get_read_db`), consistent with
`/admin/analytics/*`; it falls back to the primary when no replica is
configured.

### 2 — Read-only, and no new outbound Stripe surface — ever

Neither route imports `get_provider` or touches `app/core/payments` in any way.
Everything mutating — refunds, plan changes, forced cancellation, dunning
intervention, retry triggering — stays in the Stripe dashboard, which already
owns the audit trail, the permissions model and the fraud tooling.
`PaymentProvider.cancel_at_period_end(...)` exists and is **not** called from
this code path (nor from anywhere W20 adds).

This is asserted as a test, not stated as an intention
(`tests/test_admin_subscriptions.py::test_no_outbound_provider_call_on_list_or_counts`):
the payment provider singleton is swapped for a spy whose every attribute access
raises, three requests are made across both routes with filters, and all three
must return `200` — a single provider touch would surface as a `500`.

"Zero new surface" (decision 2's phrasing) means zero new *stored* surface — no
column, no write-path change. It does **not** mean zero code: the screen still
needs a staff-facing read, because every existing `/subscriptions/*` route is
self-service. W20 is that read and nothing more.

### 3 — The row DTO carries no amount / price / currency field

`SubscriptionAdminItem` is exactly nine fields: `id`, `user_id`, `user_name`,
`user_email`, `tier`, `status`, `current_period_end`, `provider_customer_id`,
`created_at`.

- `current_period_end` is the model's `valid_until` column, renamed at the DTO
  boundary to the vocabulary the screen uses. Null on free / fully-lapsed rows.
- `provider_customer_id` is passed through **nullable**. The frontend hides
  "Open in Stripe" when it is null (§A.3, W21) — a null here is load-bearing, not
  an error.
- **No `amount`, `price`, `currency`, `amount_cents`, `mrr`, or any monetary
  field.** No amount is stored and the webhook never parses one, so any figure
  here would be either a price map that drifts silently from Stripe or a live
  Stripe lookup on an internal screen — and decision 2 cuts the dollar figure
  outright. Asserted three ways
  (`tests/test_admin_subscriptions.py`): the Pydantic model's field set is
  pinned exactly; the regenerated `openapi.json` `SubscriptionAdminItem` /
  `SubscriptionCounts` property names are grepped for the forbidden tokens; and
  a live response row's keys are checked. The class *docstring* names the absent
  fields deliberately (so a future reader knows it was a choice) — the greps
  target property definitions, not prose.

### 4 — `active_paid` is `count_active_paid_subscribers`, reused not redefined

`GET /admin/subscriptions/counts` returns `{active_paid, monthly, annual}`:

- `active_paid` **calls `subscription_service.count_active_paid_subscribers`
  directly** — one definition, shared with the analytics overview and the
  publish toast. A second definition written for this screen is exactly the
  drift decision this avoids.
- `monthly` = `COUNT(*) WHERE tier = MONTHLY AND status IN
  _PAID_SUBSCRIBER_STATUSES`; `annual` = the same with `tier = ANNUAL`. Both
  **reuse `_PAID_SUBSCRIBER_STATUSES`** — the module constant
  `count_active_paid_subscribers` itself uses (`ACTIVE`, `CANCELLED`;
  `PAST_DUE` is entitled but deliberately excluded so the figure is stable and
  matches analytics).

Because `PAID_TIERS == (MONTHLY, ANNUAL)` and the status predicate is identical,
`active_paid == monthly + annual` holds **by construction**. A test seeds a mix
across every tier × status and asserts the route's `active_paid` equals the
function's return on the same data, and equals `monthly + annual`.

The counts live on a sibling route (`/counts`), not inline on the list —
mirroring W15's `GET /users/role-counts` next to `GET /users`, the consistent
choice on this codebase.

### 5 — Pagination has a hard maximum page size

`limit: int = Query(default=25, ge=1, le=100)`, `offset: int = Query(default=0,
ge=0)` — the same bounds as `GET /users`. `limit=1000` (or `101`) is rejected
**422** at the router boundary; the service also clamps to 100 defensively,
mirroring `auth_service.list_users`. Response shape is `Page[SubscriptionAdminItem]`
— `{items, total, limit, offset}`, `total` being the filtered count before
paging. Newest first: `ORDER BY created_at DESC, id DESC`. The `id` tiebreaker is
load-bearing, not decoration — `created_at` is `server_default=func.now()`
(transaction-start time on Postgres, 1s resolution on SQLite), so timestamp
collisions are ordinary and `created_at` alone is not a total order; without the
`id` key a paged client can repeat or drop a row across page boundaries.

`status` and `tier` are optional query params typed as the `SubscriptionStatus`
/ `SubscriptionTier` enums, so an unknown value is a 422, not a silent empty
page.

## Consequences

- **PII — a staff-readable enumeration of the paying membership (risk P4).** The
  list joins `Subscription` to `User` for `full_name` and `email`.
  - **Access control:** Manager+ at the dependency; the join `SELECT`s **only**
    the nine columns the DTO needs — no `password_hash`, no `role`, no other user
    column crosses the boundary. Mandatory `security-reviewer` pass at W20.
  - **Pagination is not access control.** The hard 100-row page ceiling bounds a
    single *response*; it does not gate who sees the data or cap how much of it
    one actor can pull over time. An authorized manager can walk every page and
    enumerate the full paying membership at will — that is the accepted posture
    (decisions 4 and 11), not something pagination prevents. It paces
    enumeration; it does not stop it.
  - **Detection:** every call to `GET /admin/subscriptions` and
    `GET /admin/subscriptions/counts` emits one structured audit line
    (`admin_subscriptions_listed` / `admin_subscriptions_counts_read`) carrying
    the actor `user_id`, the `status`/`tier` filter values, `offset`/`limit` and
    the returned row count (or the three counts) — **no** emails, names or
    `provider_customer_id`. After a manager-account compromise this is what makes
    a membership scrape visible in the logs rather than indistinguishable from
    ordinary screen traffic (CWE-778).
  - **Deferred:** a per-actor rate limit on `/admin/subscriptions` (the global
    limiter keys on client IP, and all portal traffic shares the BFF's IP, so it
    does not bound a single manager) is a logged **Phase 2 fast-follow — not
    built in W20**. See `status.md` (`[Phase 2 — deferred]`).
  - This is not a gate: GATE 4 settled the posture that creates it (decision 11).
- **The portal lags Stripe.** Read-only means the screen reflects the last
  webhook, not live Stripe. A member fixed by hand in Stripe still reads
  past-due here until the next event lands. W21's subhead states the lag; a
  past-due row carries **no date of any kind** (§A.3 — `updated_at` is
  last-any-change, not went-past-due, so no date is truthful).
- **No new migration, no model change.** W20 is API + DTO + service query only.
- `openapi.json` (repo root) regenerated and committed. The diff is **additive**:
  two paths (`GET /api/v1/admin/subscriptions`, `.../counts`), two schemas
  (`SubscriptionAdminItem`, `SubscriptionCounts`) plus the generated
  `Page_SubscriptionAdminItem_` wrapper. No amount / price / currency token
  appears anywhere in the diff. Both responses set `Cache-Control: no-store`
  (a response header, so it does not appear in the schema) — low risk (the
  bearer token already defeats shared caches and the BFF is the only client)
  but correct for a PII payload.
- **If operational Subscriptions is ever genuinely needed**, it is a Phase 3
  item (§E 6) gated on evidence that running billing through the Stripe
  dashboard is painful — and it would reopen this ADR's decision 2, so it wants
  its own authz ADR and `security-reviewer` pass.

## Notes for the implementation review (GATE 3 Batch 7 / W20)

- `reviewer-gilfoyle` on the implementation; `security-reviewer` **mandatory**
  (PII surface).
- Coverage: `tests/test_admin_subscriptions.py` — role gating (editor/viewer
  403, manager/admin 200 on both routes), the User join (name + email +
  user_id), nullable `provider_customer_id` pass-through, status/tier filters
  (exact and combined), unknown-filter-value 422, pagination + hard-max-page-size
  422, the no-monetary-field assertions (DTO field set, OpenAPI schema grep,
  live response keys), `active_paid == count_active_paid_subscribers` on a
  seeded mix (== `monthly + annual`), and the no-outbound-provider-call spy.
- The `active_paid` reuse is a one-line call
  (`await count_active_paid_subscribers(db)` inside
  `subscription_service.subscription_counts`); `monthly` / `annual` reuse
  `_PAID_SUBSCRIBER_STATUSES` from the same module. Do not inline a second
  status list.
