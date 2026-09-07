# Plan: Remediate findings 1–8 of the non-auth codebase review

Source of truth for the defects: `docs/reviews/codebase-review.md` (Gilfoyle, 2026-09-07).
Findings **9 and 10**, all 🟢 Nits, and the entire auth backlog (`docs/reviews/api-auth-review.md`
findings 5–9 + its nits) are **explicitly out of scope for this stream** — see
*Explicitly deferred* below.

This is a **separate contract** from `plan.md`, which covers the already-executed auth batch
(commit `9e8d366`). `plan.md` is closed; do not edit it.

## Goal

Stop the catalog cache lying about who has paid, make playback-progress writes a real upsert,
and make the subscription webhook path idempotent under concurrency and honest about
re-activation, period end, and re-subscription.

## Definition of Done

- [ ] **Finding 1** closed — a `PATCH` to a published sermon busts the catalog cache, so
      `/catalog/sermons` and `/sermons/{id}/stream` never disagree on `tier`/`locked`.
- [ ] **Finding 2** closed — `record_progress` is a single-statement upsert. Concurrent first
      writes do not 500, and `watched_seconds` accumulates SQL-side without losing increments.
      Works on **both** PostgreSQL and SQLite (the suite's dialect).
- [ ] **Finding 3** closed — `customer.subscription.updated` handles the falsy
      `cancel_at_period_end` branch; an un-cancel in the provider portal restores `ACTIVE`.
- [ ] **Finding 4** closed — `checkout.session.completed` never sources `valid_until` from a
      checkout session's `expires_at`.
- [ ] **Finding 5** closed — a member with a live entitlement cannot open a second checkout;
      a member whose entitlement has fully expired still can.
- [ ] **Finding 6** closed — search `total` agrees with the returned page when `?tier=` is set.
- [ ] **Finding 7** closed — `GET /series/{id}/episodes` reports real `locked` state for the
      calling user.
- [ ] **Finding 8** closed — a concurrent duplicate webhook delivery returns
      `duplicate_ignored`, not a 500.
- [ ] `uv run pytest` green — the whole suite, not just the touched files.
- [ ] **A regression test exists per finding (1–8), and each fails against the pre-fix code.**
      A test that passes before the fix is not a regression test; it is decoration. The executor
      verifies this by stashing the fix, running the new test, and confirming it fails.
- [ ] `reviewer-gilfoyle` re-reviews the diff against `docs/reviews/codebase-review.md` and
      confirms 1–8 are closed with no new CONFIRMED findings left open in the touched code.
- [ ] **No scope creep.** Findings 9 (except the narrow, optional fold-in named in Step 4),
      10, the Nits, and the auth backlog are untouched. If a fix appears to require crossing
      that line, the executor halts and the Conductor decides.

## Constraints / Assumptions

- Stack conventions per `~/.claude/CLAUDE.md`: async all the way down, typed domain errors
  raised in services and translated to HTTP at the router boundary, `uv run` for everything.
- **No schema change, no migration, no new column, no new index.** Every fix in this plan is
  behavioural. `uq_playback_user_sermon` and `uq_webhook_provider_event` already exist and are
  the constraints findings 2 and 8 lean on. If a step appears to need DDL, that is a new gate —
  halt.
- **No new runtime dependencies.**
- The suite runs on in-memory SQLite (`sqlite+aiosqlite`) + `tests/fake_redis.FakeRedis`
  (`tests/conftest.py`). That is the existing reality; **do not** migrate these tests to
  Testcontainers as part of this stream. This constrains finding 2 — see the portability note
  in Step 2.
- The active payment backend under test is `app.core.payments.MockProvider`. Any provider-surface
  change in Step 5 must be implemented on **both** `MockProvider` and `StripeProvider`, and must
  keep `MockProvider` deterministic and offline.
- The review's own fix directions are the accepted approach. Where this plan deviates or picks
  between the review's options, the step says so and why.
- `_has_subscription` stays private in this stream. Making it public (`has_paid_access`) is a
  Nit and belongs with finding 10's refactor. Step 9 uses it exactly the way `api/media.py:119`
  and `api/analytics.py:76` already do — consistent with the codebase as it stands, not as it
  should be.

## Explicitly deferred — named so nobody "helpfully" fixes them

- **Finding 9** (Python-side timestamp filtering in `expire_lapsed` and `sweep_stale_jobs`).
  Not required by this contract. `subscription_service.expire_lapsed` is co-located with the
  webhook work in Steps 4–7; senior-dev **MAY** fold in the `expire_lapsed` half **only if**
  those steps leave the file open, the change is a `WHERE` predicate and nothing more, and the
  full suite stays green. It is optional, it gets its **own** `status.md` entry, and it is
  reported to gilfoyle as an addition. `media_service.sweep_stale_jobs` is a different file and
  is **not** in scope under any circumstance.
- **Finding 10** (`content_service.py` is a 724-line hub; extract `errors.py`/`domain.py`,
  split `taxonomy_service` and `thumbnail_service`). Architect-led task, separate contract.
  Nothing in this stream moves a symbol between modules.
- **All 🟢 Nits** from the non-auth review, including the `_has_subscription` privacy smell, the
  duplicate series-map loaders, `__import__("sqlalchemy").Integer`, the inline ORM construction
  in `create_series`/`create_speaker`, the `active_subscribers` `PAST_DUE` undercount, and the
  trailing-whitespace items. Steps in this plan touch files containing these. Leave them.
- **The entire auth backlog** — `docs/reviews/api-auth-review.md` findings 5–9 and its nits.

---

## [HUMAN_GATE] — Approve before ANY implementation begins

**Position:** after this plan is written, before Step 1. **This is the only gate in this plan.**

**Crossing this gate authorizes Steps 1–9 to run autonomously to completion.** No further gate
sits between them. After Step 9, execution **stops** and hands to Step 10
(`reviewer-gilfoyle`); it does not merge, does not deploy, does not proceed to findings 9/10 or
the Nits.

Four of these steps change money-path behaviour. What Isaac is approving, specifically:

**1. Webhook semantics change — un-cancel (Step 6 / finding 3).**
`customer.subscription.updated` gains a falsy `cancel_at_period_end` branch: the row is set to
`cancel_at_period_end=False` and, **if it was `CANCELLED`, promoted back to `ACTIVE`**. Today a
member who un-cancels in the provider portal stays `CANCELLED` in our database forever.
The promotion is deliberately scoped: `CANCELLED → ACTIVE` only. A row sitting in `PAST_DUE` or
`EXPIRED` is **not** promoted by this branch — those states are owned by the invoice and
subscription-lifecycle events, and a `subscription.updated` carrying an unrelated field change
must not resurrect a lapsed member.

**2. `valid_until` source change (Step 7 / finding 4).**
`checkout.session.completed` stops falling back to the checkout session's `expires_at` (~24h
from creation — the *link's* expiry, not a billing period). Period end is sourced from the real
subscription. **This affects every future subscription's expiry date** and therefore what
`expire_lapsed` sweeps. Two sub-decisions inside it:

  - *Provider surface.* `MockProvider` and `StripeProvider` gain a method to retrieve a
    subscription's `current_period_end` (Step 5 adds it; Step 7 consumes it). This widens the
    `PaymentProvider` Protocol — a real, if small, addition to an external seam. The alternative
    the review offers (set nothing on checkout, let `invoice.paid` do it) needs no provider
    change but is rejected below.
  - *Fallback when no period end can be obtained.* `valid_until` is left **unset** rather than
    invented from our own clock — `subscription_service`'s module docstring is explicit that we
    never infer a payment from our clock. Consequence Isaac should see plainly: an unset
    `valid_until` reads as **entitled with no expiry** in `entitlement_from_row`, and
    `expire_lapsed` filters on `valid_until IS NOT NULL` so it will not sweep such a row. In
    that narrow failure mode the system fails **open** (a member keeps access) rather than
    closed (a payer is cut off ~24h in, which is today's bug). That trade is the thing being
    approved. It is corrected by the next `invoice.paid`.

**3. New checkout refusal (Step 8 / finding 5).**
`start_checkout` currently refuses only when `entitlement_from_row(sub) and not
sub.cancel_at_period_end`. It will refuse whenever the entitlement is live **at all**, including
the cancelled-but-still-inside-the-paid-period case, with a 409 pointing the member at the
billing portal to un-cancel. **This is a client-visible behaviour change on a revenue path** —
a member who cancels and changes their mind can no longer self-serve through a fresh checkout;
they go through the portal. The upside is that we stop creating orphaned second provider
subscriptions that stomp `provider_subscription_id`. A genuinely lapsed member (tier back to
`FREE`, status `EXPIRED`, or `valid_until` in the past) is **not** blocked — that path is
protected by an explicit regression test in Step 8.

**4. Upsert and portability approach (Step 2 / finding 2).**
`record_progress` becomes a dialect-specific `INSERT … ON CONFLICT (user_id, sermon_id) DO
UPDATE`. There is **no** dialect-neutral upsert construct in SQLAlchemy 2.0: `postgresql.insert`
and `sqlite.insert` are separate imports with separate `on_conflict_do_update` implementations,
so the code branches on `db.bind.dialect.name` — the same pattern `search_service._is_postgres`
already uses. Production runs the Postgres arm; the test suite exercises the SQLite arm. **That
means the Postgres arm is not covered by the current suite** — it is the same gap that already
exists for the Postgres FTS path in `search_service`, and this plan does not close it. Isaac is
approving that the hot progress-write path ships with its production arm unit-untested here.

Also inside this decision: `position_seconds` stops being a blind overwrite, but it does **not**
become a plain `max()`. A plain max would break the deliberate restart semantics that
`test_restart_increments_play_count` guards (a member who restarts a sermon would be resumed at
their old high-water mark). See Step 2 for the exact rule.

**5. Webhook idempotency mechanism (Step 4 / finding 8).**
The ledger insert stays inside the single existing transaction; the `commit` is wrapped and a
unique-constraint violation on `uq_webhook_provider_event` is caught, rolled back, and returned
as `duplicate_ignored`. The review's alternative — insert and commit the ledger row *first*,
then apply the body — is rejected: it breaks the atomicity of ledger-and-effect, so a crash
between the two commits would record an event as processed that was never applied, and the
provider would never retry it. Losing the race is the correct outcome here: the winning
transaction applied the change in full.

---

## Steps

### Step 1 — Bust the catalog cache when a published sermon is edited
- **Owner agent:** senior-dev
- **Closes:** Finding 1 (🔴). Independent of every other step.
- **Files / scope:** `app/services/content_service.py` (`update_sermon`, currently at `:316-344`),
  `tests/test_content.py`.
- **What:**
  - After the commit in `update_sermon`, invalidate the catalog cache when the sermon is
    `PUBLISHED` and the update actually changed something. `update_series` (`:546-555`) is the
    reference implementation — commit first, then `await invalidate_catalog_cache()`, never the
    reverse.
  - **Deliberate widening, stated so it is not mistaken for scope creep:** `update_series` guards
    on `tier_changed` because a series tier is the only series field that reaches the cached
    catalog payload. For a sermon that is not true — the cached `SermonListItem` carries `title`,
    `description`, `thumbnail_url`, `duration_seconds`, `episode_number`, the denormalised
    speaker/category/series names **and** `tier`. Guarding only on `tier` would close the review's
    finding and leave an identical staleness bug on `title`. Invalidate on any effective change
    to a `PUBLISHED` sermon. `SermonUpdate` carries no `status` field (transitions go through
    `app/services/approval.py`, which already invalidates), so no was-published/is-published
    comparison is needed — read `sermon.status` and act.
  - Do not touch `update_series`, the approval transitions, or the cache key itself.
- **Verification:** `uv run pytest tests/test_content.py` then `uv run pytest`.
  New regression test in `tests/test_content.py`, which must **fail** on pre-fix code:
  publish a `free` sermon; `GET /api/v1/catalog/sermons` as an anonymous caller to prime the
  cache and assert `locked is False`; `PATCH /api/v1/sermons/{id}` to `tier: "paid"` as the
  owning editor; re-read the catalog **immediately** and assert `locked is True` and
  `tier == "paid"`. The pre-fix code serves the stale cached row, so the assertion fails.
  Note for the executor: the suite's `FakeRedis` is real enough to hold the cached payload
  across requests within one `client` fixture, which is what makes this test bite.
- **Status update:** append to `status.md` as `[NA Step 1] <result>`.

### Step 2 — Make `record_progress` an actual upsert
- **Owner agent:** senior-dev
- **Closes:** Finding 2 (🔴). Independent of every other step.
- **Files / scope:** `app/services/analytics_service.py` (`record_progress`, `:40-86`),
  `tests/test_analytics.py`.
- **What:**
  - Keep the existing published-sermon guard (`ContentError("Sermon not found", 404)`) exactly
    as it is — it runs before the write and is covered by
    `test_progress_on_unpublished_rejected`.
  - Replace the `SELECT` → branch → `add`/mutate sequence with one
    `INSERT … ON CONFLICT (user_id, sermon_id) DO UPDATE`, targeting `index_elements=["user_id",
    "sermon_id"]` (the columns behind `uq_playback_user_sermon`, `models.py:585`).
  - **Portability — the load-bearing detail.** SQLAlchemy 2.0 has no shared upsert construct.
    Import `from sqlalchemy.dialects.postgresql import insert as pg_insert` and
    `from sqlalchemy.dialects.sqlite import insert as sqlite_insert`, and choose on
    `db.bind.dialect.name == "postgresql"` — mirror the existing
    `search_service._is_postgres(db)` helper's shape rather than inventing a new idiom. Both
    dialects support `on_conflict_do_update(index_elements=…, set_=…)` and both expose the
    proposed row as `stmt.excluded`. **A single dialect-agnostic `set_` dict, built once and
    handed to whichever construct was selected, keeps the two arms from drifting** — the branch
    should choose the `insert()` function and nothing else.
  - Update semantics for the `DO UPDATE` set-clause, all as SQL expressions against the existing
    column and `excluded`:
    - `watched_seconds = PlaybackSession.watched_seconds + <delta>` — SQL-side accumulation.
      This is the increment-loss fix; a Python read-modify-write here reintroduces the bug.
    - `play_count` — increment only on a large backward jump, preserving today's rule
      (`position < stored.position - 60` means a fresh viewing, not a scrub). Express as a
      `case()` over the stored column, not in Python.
    - `position_seconds` — **not** a blind overwrite and **not** a plain `max()`. The brief's
      "take the max" and the existing restart semantics conflict: `test_restart_increments_play_count`
      posts position 5 after position 500 and the resume position must follow the member back to
      the start, so a plain max would both break that test and strand a restarting viewer at
      their old high-water mark. The rule that satisfies both: a **large backward jump (the same
      >60s threshold as `play_count`) wins outright** — it is a deliberate restart; **any other
      value takes the max** against the stored column, which is what discards an out-of-order or
      concurrent ping. Express with `case()`; do not reach for `GREATEST`/`max(a,b)`, whose
      spelling differs across the two dialects.
    - `completed` — must stay sticky. It is currently only ever set to `True`, never cleared, and
      a restart must not un-finish a sermon. `completed = stored.completed OR <new value>`.
      The 90% derivation itself may stay in Python (it is a function of the *request* and the
      sermon's duration, not of the stored row) as long as the write clause preserves stickiness.
    - `last_played_at` — set to now on the update path.
  - Return value: `record_progress` still returns a `PlaybackSession` and
    `app/api/analytics.py` still does `ProgressPublic.model_validate(...)`. Getting the row back
    from the upsert via `RETURNING` is fine on Postgres, but do not assume it across both
    dialects — **commit, then re-`SELECT` the row** and return that. One extra round-trip on a
    write path is a fair price for one code path instead of two.
  - **Clamp `position_seconds`** to `sermon.duration_seconds` when the duration is known
    (it is already loaded by the guard above, so this is free). This closes the review's
    "self-reported analytics can be trivially inflated" nit for the position field at zero cost.
    Do **not** also try to fix the client-settable `completed` flag — that is the same nit's
    other half and it needs a product decision, not a code change. Leave a one-line comment
    saying so.
- **Verification:** `uv run pytest tests/test_analytics.py` then `uv run pytest`. The existing
  `test_progress_accumulates_watch_time`, `test_completion_at_ninety_percent`,
  `test_restart_increments_play_count` and `test_record_and_read_progress` must stay green
  **unmodified** — if a fix requires weakening one of them, that is a signal the semantics
  drifted, and the executor halts rather than editing the assertion.
  New regression tests in `tests/test_analytics.py`, which must **fail** on pre-fix code:
  - **Concurrent first write.** Two `POST /api/v1/sermons/{id}/progress` calls for the same
    user+sermon issued from two independent sessions against the same engine, overlapping, with
    no prior row. Pre-fix: one raises `IntegrityError` and the endpoint 500s. Post-fix: both
    return 200 and exactly one row exists. If genuine overlap proves unreachable through the
    ASGI client on in-memory SQLite, drive `analytics_service.record_progress` directly with two
    `AsyncSession`s from the `engine` fixture (`tests/test_subscriptions.py:273-278` shows the
    established pattern for building a second session) — and if even that will not interleave on
    aiosqlite, assert the invariant instead: call `record_progress` twice from two sessions where
    the second still holds a pre-insert view, and require no exception plus a correct total.
    Whatever shape it takes, **it must fail against the pre-fix code** or it is not the test.
  - **Accumulation is not lost.** Two overlapping `watched_delta` writes total both deltas rather
    than one.
  - **Clamp.** A position beyond `sermon.duration_seconds` is stored clamped.
- **Status update:** append to `status.md` as `[NA Step 2] <result>`.

### Step 3 — (reserved: no action)
*Intentionally omitted so step numbers do not track finding numbers and invite confusion.
There is no Step 3.*

### Step 4 — Make webhook idempotency concurrency-safe
- **Owner agent:** senior-dev
- **Closes:** Finding 8 (🟡). **Ordered before Steps 5–8** — it hardens the commit path all three
  of those steps run through, so their tests exercise the final shape of the transaction rather
  than one that is about to change underneath them.
- **Files / scope:** `app/services/subscription_service.py` (`handle_webhook`, `:226-320`),
  `tests/test_subscriptions.py`.
- **What:**
  - Keep the cheap `_already_processed` pre-check. It is the fast path for the common sequential
    redelivery and costs one indexed read; removing it would push every duplicate through a
    failed transaction.
  - Wrap the single `await db.commit()` (`:309`): on `IntegrityError`, `await db.rollback()` and
    return `"duplicate_ignored"`. Import `IntegrityError` from `sqlalchemy.exc` at module top.
  - **Do not swallow every `IntegrityError` blindly.** The commit covers both the
    `ProcessedWebhook` insert and the subscription mutations. Narrow the catch to the webhook
    ledger constraint — inspect the constraint/`orig` for `uq_webhook_provider_event` — and
    re-raise anything else so a genuine data defect still surfaces instead of being reported to
    the provider as a successfully-ignored duplicate. If the constraint name cannot be recovered
    portably from the SQLite driver's exception, say so in `status.md` and fall back to matching
    on the constraint name appearing in `str(exc.orig)`, which both drivers include.
  - **The rollback path must not touch `sub` afterwards.** The existing
    `if sub is not None: await invalidate_entitlement(sub.user_id)` at `:311-312` runs after the
    commit; on the duplicate path the transaction is gone and the instance is stale. Return
    before it. (The winning transaction already invalidated the cache for that user.)
  - Log the duplicate outcome at info with `event_id` and `event_type`, same shape as the
    existing `webhook_handled` line, so a burst of concurrent redeliveries is visible in the
    logs rather than silent.
- **Verification:** `uv run pytest tests/test_subscriptions.py` then `uv run pytest`. The existing
  `test_webhook_is_idempotent` (sequential redelivery) must stay green unmodified.
  New regression test, which must **fail** on pre-fix code: two deliveries of the same
  `event_id` applied concurrently — build two `AsyncSession`s from the `engine` fixture, drive
  `subscription_service.handle_webhook` on both with the same event, and assert one returns a
  real outcome and the other returns `"duplicate_ignored"` with **no exception raised** and
  exactly one `processed_webhooks` row. Pre-fix, the loser raises an uncaught `IntegrityError`.
- **Status update:** append to `status.md` as `[NA Step 4] <result>`.

### Step 5 — Add a subscription-retrieval method to the payment provider seam
- **Owner agent:** senior-dev
- **Closes:** nothing on its own. **Prerequisite for Step 7 (finding 4).** Split out so the
  provider-surface change is one reviewable commit and Step 7 stays about webhook logic.
- **Files / scope:** `app/core/payments.py` (`PaymentProvider` Protocol, `MockProvider`,
  `StripeProvider`), `tests/test_subscriptions.py` (fixture helpers only).
- **What:**
  - Add one method to the `PaymentProvider` Protocol that, given a provider subscription id,
    returns that subscription's current period end (or `None` when it cannot be determined).
    Keep the return type narrow — a `datetime | None` or the raw epoch int, decided by whatever
    reads most naturally against the existing `_parse_ts` helper in `subscription_service`.
    Do not return the whole provider object; that would leak Stripe's shape past the seam, which
    is the entire point of this module.
  - `StripeProvider`: retrieve the subscription through the SDK and read `current_period_end`.
    Wrap failures in `PaymentError`, matching every other method in that class. Nothing outside
    `payments.py` imports `stripe` and that must remain true.
  - `MockProvider`: deterministic, offline, no network. It needs a way for a test to say "this
    subscription's period ends here" — the simplest honest shape is an in-process dict the mock
    records into on `create_checkout_session` and that tests can seed directly, returning `None`
    for an unknown id. Whatever shape is chosen, `MockProvider` must remain constructible with
    no arguments and must not acquire state that leaks between tests: the `client` fixture in
    `tests/conftest.py` does not currently reset the provider, so either reset it there
    alongside the existing `_fake.store.clear()` / `set_storage(...)` lines, or keep the mock's
    state keyed such that cross-test bleed is impossible. Adding a reset line to the fixture is
    in scope; restructuring the fixture is not.
  - This step is additive only. No existing provider method changes signature or behaviour.
- **Verification:** `uv run pytest tests/test_subscriptions.py` then `uv run pytest` — the whole
  suite must be green with the method added and nothing yet calling it. A direct unit test of
  `MockProvider`: an unknown subscription id returns `None`; a seeded one returns the seeded
  period end. (This step has no regression test of its own — it closes no finding. Its proof is
  Step 7's test.)
- **Status update:** append to `status.md` as `[NA Step 5] <result>`.

### Step 6 — Handle the webhook un-cancel branch
- **Owner agent:** senior-dev
- **Closes:** Finding 3 (🟡). **Depends on Step 4** (runs through the hardened commit path).
- **Files / scope:** `app/services/subscription_service.py`
  (`handle_webhook`, the `customer.subscription.updated` branch at `:294-304`),
  `tests/test_subscriptions.py`.
- **What:**
  - Give the branch an explicit falsy arm: set `cancel_at_period_end = False`, and promote
    `CANCELLED → ACTIVE`. **Only that transition.** A row in `PAST_DUE` or `EXPIRED` is left
    alone — those states belong to the invoice and lifecycle events, and a `subscription.updated`
    carrying some unrelated field change must not resurrect a lapsed member. This is the
    scoping Isaac approved at the gate; write it as an explicit status check, not an
    unconditional assignment.
  - Distinguish "the field is absent" from "the field is `false`". Today `obj.get(...)` conflates
    them and the falsy arm would fire on an event that never mentioned cancellation at all.
    Only act on the arm when the key is actually present in the payload.
  - The existing `valid_until`, tier, and `outcome = "updated"` handling in that branch is
    correct; leave it. The `invalidate_entitlement` call after commit already covers this path.
- **Verification:** `uv run pytest tests/test_subscriptions.py` then `uv run pytest`. Existing
  `test_cancel_keeps_access_until_period_end` must stay green unmodified.
  New regression tests, which must **fail** on pre-fix code:
  - **Un-cancel round-trip.** Activate via `checkout.session.completed`; `DELETE
    /api/v1/subscriptions/me` to cancel; post `customer.subscription.updated` with
    `cancel_at_period_end: false`; assert `GET /api/v1/subscriptions/me` reports
    `status == "active"` and `cancel_at_period_end is False`. Pre-fix the row stays
    `cancelled`/`True`.
  - **No accidental resurrection.** Drive a subscription to `EXPIRED` via
    `customer.subscription.deleted`, then post a `customer.subscription.updated` carrying
    `cancel_at_period_end: false`; assert the row is still `expired` and `is_entitled` is
    `False`.
  - **Absent key is inert.** A `customer.subscription.updated` that does not mention
    `cancel_at_period_end` at all leaves a cancelled row cancelled.
  Use the existing `sub_event(...)` helper (`tests/test_subscriptions.py:48`) and unique
  `event_id`s per call — the idempotency ledger will otherwise swallow the second event.
- **Status update:** append to `status.md` as `[NA Step 6] <result>`.

### Step 7 — Stop sourcing `valid_until` from a checkout session's `expires_at`
- **Owner agent:** senior-dev
- **Closes:** Finding 4 (🟡). **Depends on Step 5** (provider method) **and Step 4**.
- **Files / scope:** `app/services/subscription_service.py` (`handle_webhook`, the
  `checkout.session.completed` / `customer.subscription.created` branch at `:253-269`),
  `tests/test_subscriptions.py`.
- **What:**
  - Delete the `or obj.get("expires_at")` fallback at `:264-266`. A Checkout Session's
    `expires_at` is when the *payment link* dies, not a billing period, and writing it into
    `valid_until` sets a paying member's expiry ~24h out.
  - Source order for the period end on this branch: the event object's own
    `current_period_end` when present (real for `customer.subscription.created`, and what the
    existing test fixtures supply), otherwise the provider method from Step 5 called with the
    resolved `provider_sub_id`. A provider `PaymentError` here must **not** fail the webhook —
    log a warning and carry on; the ledger row and the activation still commit, and
    `invoice.paid` will correct `valid_until`. A webhook that 500s because a secondary lookup
    failed just earns a provider retry that will fail the same way.
  - When neither source yields a period end, leave `valid_until` untouched. Add a short comment
    stating the consequence Isaac ratified at the gate: an unset `valid_until` reads as entitled
    with no expiry and is not swept by `expire_lapsed`, so this path fails **open** by design
    and is corrected by the next invoice event.
  - Keep the rest of the branch — tier, status, customer/subscription ids,
    `cancel_at_period_end = False`, `outcome = "activated"` — exactly as it is.
- **Verification:** `uv run pytest tests/test_subscriptions.py` then `uv run pytest`. Every
  existing webhook test that supplies `current_period_end` on the session object
  (`test_checkout_completed_activates`, `test_payment_failed_sets_past_due_but_keeps_access`,
  `test_renewal_extends_validity`, `test_cancel_keeps_access_until_period_end`,
  `test_subscriber_can_stream_paid_content`, `test_subscriber_sees_unlocked_in_catalog`,
  `test_expire_lapsed_revokes_past_period_end`) must stay green **unmodified** — the object's
  own `current_period_end` still wins, which is exactly why it is first in the source order.
  New regression tests, which must **fail** on pre-fix code:
  - **`expires_at` is ignored.** Post a `checkout.session.completed` carrying **only**
    `expires_at` (≈24h out) and no `current_period_end`, with the provider seeded to return a
    30-day period end. Assert `valid_until` lands ~30 days out, not ~24h. Then run
    `subscription_service.expire_lapsed` and assert the member is **not** expired. Pre-fix,
    `valid_until` is the 24h value; make the assertion tight enough that 24h fails it.
  - **Unresolvable period end does not 500.** Same event with `expires_at` only and the provider
    returning `None` (or raising `PaymentError`): the webhook returns 200 with outcome
    `activated`, and `valid_until` is not set to the `expires_at` value.
- **Status update:** append to `status.md` as `[NA Step 7] <result>`.

### Step 8 — Refuse a second checkout while an entitlement is live
- **Owner agent:** senior-dev
- **Closes:** Finding 5 (🟡). **Depends on Step 4**; sits after 6 and 7 because it reads the
  same `cancel_at_period_end`/status semantics those two just corrected.
- **Files / scope:** `app/services/subscription_service.py` (`start_checkout`, `:119-138`),
  `tests/test_subscriptions.py`.
- **What:**
  - Change the guard from `entitlement_from_row(sub) and not sub.cancel_at_period_end` to refuse
    whenever `entitlement_from_row(sub)` is true. A member inside a paid period they have already
    bought — cancelled or not — does not get a second provider subscription. `entitlement_from_row`
    is already the single source of truth for "is this access live right now", including the
    `valid_until` expiry check, so no new date logic is needed and none should be added.
  - Give the cancelled case its own 409 message pointing at the billing portal
    (`POST /api/v1/subscriptions/portal` exists and `open_portal` already works for any member
    with a `provider_customer_id`), distinct from the plain "you already have an active
    subscription" message. A member who cancelled and changed their mind needs to be told where
    to go, not just refused.
  - **Do not** add a "cancel the old provider subscription then create a new one" path. That is
    the review's other option; it means an irreversible provider-side mutation inside a request
    handler, and it is not what was approved at the gate.
  - Nothing else in `start_checkout` changes — the `PaymentError → 502` mapping and the
    `checkout_started` log line stay.
- **Verification:** `uv run pytest tests/test_subscriptions.py` then `uv run pytest`. Existing
  `test_checkout_returns_url` and `test_checkout_rejects_free_tier` must stay green unmodified.
  New regression tests:
  - **Cancelled-but-entitled is refused** (must **fail** on pre-fix code): activate with a
    future `current_period_end`, `DELETE /api/v1/subscriptions/me`, then
    `POST /api/v1/subscriptions/checkout` → **409**, with the portal hint in the detail. Pre-fix
    this returns 200 and a checkout URL.
  - **A genuinely lapsed member can re-subscribe** — the guard against over-correcting. Activate
    with a `current_period_end` in the past, run `subscription_service.expire_lapsed` (the
    pattern is already in `test_expire_lapsed_revokes_past_period_end`), then
    `POST /api/v1/subscriptions/checkout` → **200** with a checkout URL. This one passes both
    before and after; it exists to fail loudly if anyone later tightens the guard into a
    lockout. Mark it in a comment as the anti-regression guard for the risk named below.
- **Status update:** append to `status.md` as `[NA Step 8] <result>`.

### Step 9 — Fix search `total` and the series-episode lock flag
- **Owner agent:** senior-dev
- **Closes:** Findings 6 and 7 (🟡). Both independent of every other step and of each other;
  grouped because each is small, they share no file, and splitting them buys nothing.
- **Files / scope:** `app/services/search_service.py` (`search_sermons`, `:98-143`),
  `app/api/series.py` (`series_episodes`, `:116-136`), `tests/test_search.py`,
  `tests/test_crud.py` (or a new `tests/test_series_episodes.py` if the episode tests read
  better on their own — executor's call, but say which in `status.md`).
- **What — finding 6 (search `total`):**
  - Push the tier filter into SQL so `total` and the page agree. The effective tier is
    `COALESCE(sermon.tier, series.tier, 'free')` — the SQL form of `effective_tier`
    (`content_service.py:84-89`). A `LEFT JOIN` onto `Series` plus a `COALESCE`/`case` predicate
    added to `conditions` gets it into **both** the count query (`:115-117`) and the page query
    (`:120-122`), which is the whole fix: the two must be built from one list of conditions.
  - Then delete the Python post-filter at `:138`. Leaving it in as a belt-and-braces second
    filter would keep the page and the count in sync but silently mask a broken predicate;
    remove it and let the SQL be the only answer.
  - Update the stale comment at `:124-125` ("the tier filter is applied after loading rather
    than in SQL") — it will be a lie the moment this lands.
  - The `series_map` lookup at `:126-132` is still needed for `effective_tier` on the returned
    items and stays. Do **not** try to collapse it into the join — that is the duplicate-loader
    Nit and it belongs to finding 10.
  - Must work on both dialects. `COALESCE` and `LEFT JOIN` are standard; no dialect branch
    should be needed here, unlike Step 2.
- **What — finding 7 (`series_episodes`):**
  - Add `user: OptionalUser` to the signature (`OptionalUser` is already defined at
    `app/api/series.py:27` and imported; nothing new is needed), resolve entitlement **once**
    before the loop via `content_service._has_subscription(db, user)`, and pass it to
    `to_list_item` in place of the hard-coded `False`. This is exactly the call
    `api/media.py:119` and `api/analytics.py:76` already make; the privacy of that helper is a
    Nit, deferred, and not this step's business.
  - Resolve entitlement once outside the comprehension — not per row. Calling it per episode
    would be a Redis round-trip per item on a list endpoint.
  - The endpoint keeps `ReadDbDep`. `is_entitled` writes only to Redis, never to the database,
    so the read-only session is not violated.
  - While in this function: leave the function-body imports (`select`, `Sermon`, `SermonStatus`
    at `:123-125`) alone, and leave `create_series`'s inline ORM construction alone. Both are
    Nits.
- **Verification:** `uv run pytest tests/test_search.py tests/test_crud.py` then `uv run pytest`.
  Existing `test_filter_by_tier` and `test_pagination` must stay green unmodified.
  New regression tests:
  - **Finding 6** (must **fail** on pre-fix code): publish several sermons across both tiers —
    at least three `free` and one `paid`. `GET /api/v1/search?tier=paid` and assert
    `total == 1` **and** `len(results) == 1`. Note for the executor: today's
    `test_filter_by_tier` asserts only on `results` and therefore passes against the bug; the
    `total` assertion is the one that bites. Add a paged variant — enough rows that
    `?tier=…&limit=2&offset=0` and `offset=2` partition the tier-filtered set exactly, with
    `total` matching the tier-filtered count on both pages.
  - **Finding 6, inherited tier:** a sermon with no explicit tier inside a `paid` series must be
    counted and returned under `?tier=paid`, and must not appear under `?tier=free`. This is the
    one the `COALESCE` exists for and a naive `WHERE sermon.tier = :tier` would fail it.
  - **Finding 7** (must **fail** on pre-fix code): create a `paid` series with a published
    episode; `GET /api/v1/series/{id}/episodes` as an anonymous caller → `locked is True`; as an
    entitled subscriber (activate via the webhook helper, same shape as
    `test_subscriber_sees_unlocked_in_catalog`) → `locked is False`. Pre-fix, the subscriber
    also sees `True`. There is **no existing test for this endpoint at all**, so this is new
    coverage, not an extension.
- **Status update:** append to `status.md` as `[NA Step 9] <result>`.

### Step 10 — Re-review
- **Owner agent:** reviewer-gilfoyle
- **What:** Review the full diff from Steps 1–9 against `docs/reviews/codebase-review.md`.
  Confirm findings 1–8 are actually closed — not merely relocated — and specifically check:
  - the catalog invalidation in `update_sermon` is commit-then-invalidate, not the reverse, and
    fires on the tier path the finding names;
  - the progress upsert accumulates `watched_seconds` **in SQL**, that the SQLite and Postgres
    arms share one `set_` clause rather than having drifted into two implementations, and that
    the `position_seconds` rule preserves both restart semantics and the concurrent-ping guard;
  - the `IntegrityError` catch in `handle_webhook` is narrowed to the webhook constraint and does
    not swallow a subscription-mutation failure as `duplicate_ignored`, and that the rollback
    path does not touch the stale `sub` instance;
  - the un-cancel branch cannot promote a `PAST_DUE` or `EXPIRED` row, and does not fire on an
    event that omits `cancel_at_period_end`;
  - `expires_at` no longer reaches `valid_until` on any path, and a provider-lookup failure
    cannot fail the webhook;
  - the checkout guard refuses the cancelled-but-entitled case **without** locking out a lapsed
    member;
  - search `total` and the returned page are built from one condition list;
  - `series_episodes` resolves entitlement once, not per row.
  Also verify each new test genuinely fails against pre-fix code (spot-check the two 🔴 ones at
  minimum), and flag any scope creep into findings 9/10, the Nits, or the auth backlog.
  Findings already known and deliberately deferred are **not** re-litigated here.
- **Verification:** a written verdict, appended to `status.md`. Any **new CONFIRMED** finding in
  code this stream touched is fixed by senior-dev — under this plan, no new gate — and
  re-verified by `uv run pytest` before the stream closes. New findings in code this stream did
  **not** touch are recorded for a later stream, not fixed here.
- **Status update:** append to `status.md` as `[NA Step 10] <result>`.

---

## Status logging

All entries go in the **existing** `status.md`, under a new section appended at the end:

```
## Non-auth remediation — findings 1–8 (plan-nonauth.md)
```

One entry per step, in execution order, prefixed `[NA Step N]`. `status.md` is append-only:
never rewrite or reorder an earlier entry, including entries from the auth batch. If the
optional finding-9 fold-in named in Step 4's deferral note is taken, it gets its **own** entry
(`[NA Step 4b] finding 9 (expire_lapsed only) folded in — …`), not a footnote on another step.

**Neither this plan file nor `plan.md` is edited by any executor.** `plan.md` is the closed auth
contract; this file is immutable once approved. If reality diverges from a step, the executor
halts and the Conductor decides whether to amend.

---

## Risks

- **The analytics upsert sits on a hot write path and must stay portable.**
  `record_progress` is called on every playback ping — roughly every 30 seconds per active
  viewer — so a defect here is high-frequency and shows up as lost watch time or 500s during
  services, which is exactly when nobody is available to fix it. The dialect branch means the
  **production (Postgres) arm is never executed by the test suite**; only the SQLite arm is
  covered. Mitigation within this plan: one shared `set_` clause so the two arms cannot drift
  in their semantics, and gilfoyle explicitly checking for drift in Step 10. Mitigation outside
  it: a Testcontainers Postgres integration test for this one function is the right follow-up
  and is **not** in this contract.
- **The `valid_until` change alters every future subscription's expiry.**
  Step 7 changes what date gets written on activation for every new member from this point on.
  Get it wrong in the generous direction and members keep access they have not paid for; get it
  wrong in the strict direction and `expire_lapsed` cuts off payers — the failure the finding
  exists to prevent. The approved fallback fails **open** by design. Existing rows are not
  migrated or corrected by this plan; any subscription already carrying a bad ~24h `valid_until`
  is Isaac's to reconcile out of band, and if `expire_lapsed` has already expired such a row,
  this plan does not un-expire it.
- **The double-checkout guard must not lock out legitimate re-subscribers.**
  Step 8 tightens a guard on a revenue path. Over-tighten it and a member who genuinely lapsed
  cannot give the church money — a silent revenue failure nobody reports as a bug, they just
  leave. The lapsed-member re-subscribe test in Step 8 is the anti-regression guard and must
  never be weakened. There is also a real UX consequence in the *approved* behaviour: a member
  who cancels and changes their mind now goes through the billing portal instead of a fresh
  checkout. If the portal is misconfigured for this provider account, that path is a dead end —
  worth Isaac verifying against the live Stripe configuration before this reaches production.
- **Steps 4, 6, 7 and 8 all mutate one function and one file.** `handle_webhook` and
  `start_checkout` live in `subscription_service.py` and four steps touch it in sequence. Each
  step must run the full suite before the next begins; a broken intermediate state that only
  surfaces two steps later is expensive to bisect.
- **`FakeRedis` and in-memory SQLite are not the production substrate.** Steps 1 and 9 depend on
  cache behaviour and Step 2 on constraint behaviour; both fakes are close enough for these
  tests, but "green on aiosqlite + FakeRedis" is weaker evidence than it looks. Not a reason to
  block, a reason not to over-claim in `status.md`.

## Rollback

- One feature branch for the whole stream, branched from `main`, **one commit per step** with
  conventional-commit messages (`fix:` for the finding-closing steps; `feat:` for Step 5, which
  adds a provider method). Any single step reverts with a single `git revert` of its commit.
- Dependency order for reverts:
  - Steps 1, 2 and 9 are independent — revert either freely.
  - Step 7 consumes Step 5's provider method: revert 7 before 5.
  - Steps 6, 7 and 8 assume Step 4's hardened commit path: revert them before 4.
  - Reverting Step 4 alone, with 6/7/8 still in place, leaves the code correct but with the
    concurrency hole reopened. Acceptable as an emergency measure, not as a resting state.
- **Nothing in this plan is a migration, a schema change, or a deploy.** No column is added, no
  index is created, no data is rewritten. Every change is reversible by reverting code.
- The one thing a revert does **not** undo: any `valid_until` value written to a live database
  while Step 7 was deployed. Code reverts; rows do not. If Step 7 has to be rolled back in a
  deployed environment, the subscriptions activated during that window need checking by hand.
