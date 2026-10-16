# Plan: Remove Stripe

Design source of truth is Isaac's decision, quoted exactly: *"There are going to be purchases in the
app, some sermons will be free and others will be paid to access. We will use native subscription for
this instead of the previous proposed stripe option. For now remove Stripe no IAP. We will revisit
using RevenueCat after the app is being tested by other users."* §A is binding. Changing any row is a
plan amendment, not an executor's call.

Execution log: the append-only root `status.md`, never this file. Every step appends a heading
`## STRIPE-REMOVAL — <step id> <short title>`, then the line
`[STRIPE-REMOVAL — <step id> <short title>] <agent: …> <ISO-8601 UTC timestamp>`, then the body.
Nothing is logged until `[HUMAN_GATE SR0]` is crossed.

Branch: `feat/stripe-removal` off `dev` (S0). One controlled merge back into `dev` at
`[HUMAN_GATE SR4]`, which matches how every prior plan in `plans/` has landed. Isaac can redirect the
target at SR0.

Executors halt **only** at gates. Between gates they run to the step's verification. If reality
diverges from this plan (an anchor has moved, a test depends on a removed path in a way not listed
here, or a migration starts to look necessary), the executor stops, writes `HALTED: <reason>` in its
status entry, and the Conductor decides whether to amend.

---

## Goal

No Stripe code, config, dependency, endpoint or live-setup instruction is left in the backend, admin
portal or generated clients. The provider-neutral `Subscription` model, the entitlement check and the
staff read API all keep working unchanged, so every member reads as FREE.

## Scope

- **In:** delete the Stripe payment seam, the four Stripe-only endpoints, their service logic and
  DTOs, the `stripe_*` config and its production-preflight checks, the `stripe` dependency, the
  admin portal's "Open in Stripe" link, the Stripe-shaped seed IDs, the dead `DEPLOYMENT.md`
  instructions, and the misleading comments. Regenerate the contract. Write one ADR.
- **Out. This is a hard boundary.** No IAP or RevenueCat work: no billing seam, no sync endpoint, no
  paywall or locked-content UI, no new columns, no admin comp/grant flow, no schema migration. If a
  step seems to need any of these, it is out of scope. Halt.

## Definition of Done

- [ ] `POST /subscriptions/checkout`, `POST /subscriptions/portal`, `DELETE /subscriptions/me` and
      `POST /subscriptions/webhook` return 404/405. `GET /subscriptions/me` still returns 200 with a
      FREE, unentitled body for a new user.
- [ ] `GET /admin/subscriptions` and `/admin/subscriptions/counts` are unchanged (response shape
      included; `SubscriptionAdminItem` keeps `provider_customer_id`).
- [ ] Entitlement coverage is not lost. A user seeded with an ACTIVE paid row can still stream paid
      content and sees it unlocked in the catalog and series episodes, and `expire_lapsed` still
      revokes. These are now proven by direct row seeding, not webhooks.
- [ ] `app/core/payments.py` no longer exists. `Settings` has no `stripe_*` fields and no
      `payments_are_live`. Production preflight (validator and `app/scripts/preflight.py`) asserts
      nothing billing-related, and every other production check still fires.
- [ ] `stripe` is gone from `pyproject.toml` and `uv.lock`, and `uv sync --frozen` succeeds.
- [ ] `openapi.json`, `admin_portal/lib/api/schema.d.ts` and `mobile/lib/api/schema.d.ts` are
      regenerated. The diff contains only the removed paths/schemas and the edited docstring.
- [ ] The admin portal Subscriptions screen renders with no "Open in Stripe" column, link or copy.
- [ ] `alembic check` (or the repo's autogenerate-diff equivalent) reports **no** model drift.
- [ ] `grep -rniI stripe` hits only the allow-list in §A.4.
- [ ] Backend `pytest -q --tb=short` is green. Admin portal tests, typecheck and lint are green.
      Mobile typecheck is green.
- [ ] ADR 0016 is written, and `plans/README.md` has a row for this plan.

---

## A.1 Locked decisions

| # | Decision | Source |
|---|---|---|
| D1 | Stripe is removed entirely and nothing replaces it now. Native IAP (likely RevenueCat) is a future project, started once the app has outside testers. | Isaac |
| D2 | **No schema migration.** `Subscription` (`app/models/models.py` ~492–561) keeps every column as-is (`tier`, `status`, `valid_until`, `provider`, `provider_customer_id`, `provider_subscription_id`, `cancel_at_period_end`). The only edit allowed in `models.py` is the comment at ~547. | Isaac |
| D3 | Kept and functional: `GET /subscriptions/me`, `app/api/admin_subscriptions.py`, `SubscriptionAdminItem` (field set unchanged), `is_entitled` / `entitlement_from_row`, `expire_lapsed` + `app/scripts/expire_subscriptions.py`, `entitlement_cache_seconds`. | Isaac |
| D4 | `ProcessedWebhook` model and table **stay**. They are shared with the Cloudflare Stream webhook (`app/services/media_service.py` ~1075, ~1143). | Planner, verified |
| D5 | `app/core/payments.py` is **deleted outright**, with no stub. The future IAP seam will have a different shape (store sync, not checkout/portal), so a Stripe-shaped Protocol gives it no head start. | Brief, planner concurs |
| D6 | `DELETE /subscriptions/me` (cancel) is dropped, not left dormant. Apple and Google don't allow server-side cancellation, so it has no future. No client calls it: the only reference outside the backend is the generated `mobile/lib/api/schema.d.ts`. | Brief, verified |
| D7 | Admin portal: the whole "Open in Stripe" column and `stripeCustomerUrl` are deleted. The `provider_customer_id` field stays in the DTO (D3) but the portal no longer renders it. Nothing will populate it until IAP lands, and IAP will decide its own deep link. | Planner |
| D8 | Seed data keeps its paid rows, which the admin portal filters/counts and local paid-content testing need, with `provider`, `provider_customer_id` and `provider_subscription_id` all `None`. | Planner |
| D9 | `.githooks/pre-commit` Stripe live-key pattern (and its README line) is **left as-is**. It's a harmless secret scanner and costs nothing to keep. | Brief |
| D10 | Historical documents are not edited: `docs/adr/0001`, `docs/adr/0006`, `plans/*.md` (including `plan-mobile-app.md` L1 at line 69), `docs/reviews/codebase-review.md` and `docs/design_admin_portal/*`. ADR 0016 supersedes them where relevant. | Repo convention |

## A.2 Accepted consequences (shown to Isaac at SR0)

- **Paid-tier sermons become unreachable for every member** until IAP ships. `ContentTier.PAID`
  gating (`content_service.py` ~348, `comments_service.py` ~132, series episodes) stays exactly as
  it is, and nobody can become entitled except through a hand-inserted DB row. If any published
  sermon is currently PAID, members will see it locked. Re-tiering content is **not** part of this
  plan. That's Isaac's call, outside it.
- Any developer's local `.env` that still has `STRIPE_*` lines will **fail to boot** once S3 lands,
  because pydantic-settings rejects unknown keys in a dotenv file. Isaac's `.env` was checked at
  planning time and has 0 such lines. Deployed envs inject process env vars, which are ignored, so
  they're unaffected. S3 checks `.env.docker` / any `docker-compose.override.yml` the same way.

## A.3 Hook points (verified against `dev` @ `f7b700d` at planning time; S0 re-verifies)

| Area | Anchor |
|---|---|
| Router | `app/api/subscriptions.py` (116 lines). `/checkout` L54, `/portal` L68, `DELETE /me` L79, `/webhook` L96. `GET /me` L41 stays. |
| Service | `app/services/subscription_service.py` (599 lines). Delete `start_checkout` L256, `open_portal` L292, `cancel` L304, `_parse_ts` L332, `_is_webhook_ledger_violation` L345, `_already_processed` L370, `_find_subscription` L380, `handle_webhook` L402–~565, and the `PaymentError, get_provider` import L26 plus the now-unused `ProcessedWebhook`/`IntegrityError`/`Any` imports. Keep everything L54–~254 and `expire_lapsed` L566. `SubscriptionError` and the router's `_err`/`_actor` are deleted only if nothing references them afterwards. |
| DTOs | `app/models/content_schemas.py`: `CheckoutRequest` L534, `CheckoutResponse` L545, `PortalResponse` L550. `SubscriptionAdminItem` docstring L577. That docstring **is in the OpenAPI output**, so it is edited in S1, before regeneration. |
| Seam | `app/core/payments.py` (217 lines). Whole file. |
| Config | `app/core/config.py`: settings L226–231 (keep `entitlement_cache_seconds`), `payments_are_live` L334–336, preflight validator docstring L472–477 and problems L484–490. |
| Preflight script | `app/scripts/preflight.py`: `_check_payments` L162–172, registration L239. |
| Tests | `tests/conftest.py` L38, 40, 157, 184. `tests/test_subscriptions.py` (27 tests: keep L57, L66, rewrite L579/L600/L619 to seed rows, delete the rest). `tests/test_series_episodes.py` L91 (subscribes via webhook, so it needs a rewrite). `tests/test_admin_subscriptions.py` L22, spy test ~L420–460, comment L182. `tests/test_production_hardening.py` L22–25, L59, L107–110, L163. `tests/test_seed_dev.py` ~L117, L134. |
| Seed | `app/scripts/seed_dev.py` ~L625–640 docstring, ~L725–737 row build. |
| Admin portal | `admin_portal/components/subscriptions/subscriptions-screen.tsx` L31–55, L209–225. Comments in `app/(portal)/subscriptions/page.tsx` L11–15, `lib/query/hooks/use-subscriptions.ts` L12, `components/portal/data-table.tsx` L632, `components/subscriptions/subscriptions-csv.ts` L11. Tests: `tests/subscriptions/subscriptions-screen.dom.test.tsx` L16, L231–258. |
| Comments | `app/core/stream.py` L15–17, L45. `app/services/media_service.py` L1104, L1119. `app/models/models.py` L547. `app/api/admin_subscriptions.py` L5. `docker-compose.yml` L9–10. |
| Contract regen | `app/scripts/dump_openapi.py`, then `npm run gen:api` in `admin_portal/` and `mobile/`. |
| Docs | `DEPLOYMENT.md` L18–27 (rationale + table rows) and §6 L162–173. |

## A.4 Residual `stripe` allow-list (final grep in S9)

`plans/**`, `status.md`, `docs/adr/0001-*`, `docs/adr/0006-*`, `docs/adr/0016-*`,
`docs/reviews/codebase-review.md`, `docs/design_admin_portal/**`, `.githooks/**`,
`DEPLOYMENT.md` §6 pointer line, `admin_portal/tests/subscriptions/subscriptions-csv.test.ts` L40
(a banned-word assertion, still correct), and "striped"/`STRIPE` placeholder-art styling in
`admin_portal` (`media-placeholder.tsx`, `series-*.tsx`, `media-card.tsx`, `thumbnail-card.tsx`,
`submission-card.tsx`, `auth-layout.tsx` and their tests). That styling isn't related to payments.

---

### [HUMAN_GATE SR0] — Plan approval

Isaac approves this plan, including D1–D10 and the §A.2 consequences. He also confirms that the
in-flight social-sign-in work currently uncommitted on `dev` (it overlaps this plan's files:
`app/core/config.py`, `pyproject.toml`, `openapi.json`, `tests/test_production_hardening.py`,
`app/models/models.py`) has been committed/landed before S0, or he says how to sequence it.
The merge target is `dev` unless he says otherwise.

## Steps

### S0 — Preconditions and branch
- **Owner agent:** senior-dev-backend
- **What:** Confirm `git status` is clean on `dev`. If it isn't, halt; never stash, commit or
  discard someone else's work-in-progress. Cut `feat/stripe-removal`. Re-verify every §A.3 anchor
  and record any drift. Record the baseline: `uv run pytest -q --tb=line | tail -5`, admin portal
  test/typecheck/lint, mobile typecheck. Re-confirm that no hand-written client code calls the four
  endpoints (only `schema.d.ts` should hit).
- **Files / scope:** none modified.
- **Verification:** branch exists, baseline green (or pre-existing failures listed), anchor table
  confirmed in the status entry.
- **Status update:** `## STRIPE-REMOVAL — S0 preconditions + branch`

### [HUMAN_GATE SR1] — Public API contract removal
Isaac reviews the S0 report and approves deleting four public endpoints and three DTOs, plus the
contract regeneration that follows. Crossing this authorises S1–S2.

### S1 — Remove Stripe endpoints, service logic and DTOs; re-seed the keeper tests
- **Owner agent:** senior-dev-backend
- **What:** Delete the four routes, the service functions and the three DTOs listed in §A.3.
  Reword the `SubscriptionAdminItem` docstring so it doesn't mention Stripe; the meaning is
  provider-neutral (null until a provider populates it). Rewrite `test_subscriber_can_stream_paid_content`,
  `test_subscriber_sees_unlocked_in_catalog`, `test_expire_lapsed_revokes_past_period_end` and the
  `tests/test_series_episodes.py` L91 helper to insert an ACTIVE paid `Subscription` row directly
  (real Postgres, no mocks) and invalidate the entitlement cache. Delete all other
  checkout/portal/cancel/webhook tests and the `sub_event` helper. Add one test asserting the four
  removed routes return 404/405.
- **Files / scope:** `app/api/subscriptions.py`, `app/services/subscription_service.py`,
  `app/models/content_schemas.py`, `tests/test_subscriptions.py`, `tests/test_series_episodes.py`.
  `app/core/payments.py` is **not** touched in this step; it becomes unreferenced from the app but
  `conftest.py` still imports it until S3.
- **Verification:** `uv run pytest -q --tb=short tests/test_subscriptions.py tests/test_series_episodes.py tests/test_admin_subscriptions.py`
  then the full suite, both green. `grep -n "get_provider\|PaymentError" app/api app/services/subscription_service.py`
  returns nothing.
- **Status update:** `## STRIPE-REMOVAL — S1 endpoints + service`

### S2 — Regenerate the contract
- **Owner agent:** noob-dev
- **What:** Regenerate `openapi.json` via `app/scripts/dump_openapi.py`, then run `npm run gen:api`
  in `admin_portal/` and `mobile/`. Typecheck both.
- **Files / scope:** `openapi.json`, `admin_portal/lib/api/schema.d.ts`, `mobile/lib/api/schema.d.ts`.
  Nothing else.
- **Verification:** `git diff --stat` touches only those three files. The diff only removes
  `/subscriptions/checkout`, `/subscriptions/portal`, `DELETE /subscriptions/me`,
  `CheckoutRequest`/`CheckoutResponse`/`PortalResponse`, and changes the one docstring. Admin
  portal and mobile `tsc --noEmit` are green.
- **Status update:** `## STRIPE-REMOVAL — S2 contract regen`

### [HUMAN_GATE SR2] — Secrets, config and production preflight
Isaac approves removing the four `STRIPE_*` settings, `payments_are_live`, both production-validator
checks and the `payments` preflight check. Production will then assert nothing billing-related.
He also confirms that no deployed environment or secrets store expects these keys. Planning found
no evidence they were ever configured live.

### S3 — Delete the payment seam, config and preflight checks
- **Owner agent:** senior-dev-backend
- **What:** Delete `app/core/payments.py`. Remove the `stripe_*` fields, `payments_are_live` and
  the two validator problems. Rewrite the `production_preflight` docstring, whose rationale cites
  the mock payment provider, so it fits the remaining checks. Remove `_check_payments` and its
  registration. Remove the payments import/reset from `tests/conftest.py`. Delete the
  `_ProviderSpy` test in `tests/test_admin_subscriptions.py`: with no provider, the "no outbound
  call" guarantee is now structural. Drop the `stripe_*` defaults and `payments_are_live`
  assertions from `tests/test_production_hardening.py`, and delete
  `test_production_refuses_mock_payments`. Check `.env.docker`/`docker-compose.override.yml` (if
  present) for `STRIPE_*` keys **by count only, never printing values** and report the result.
- **Files / scope:** `app/core/payments.py` (delete), `app/core/config.py`, `app/scripts/preflight.py`,
  `tests/conftest.py`, `tests/test_admin_subscriptions.py`, `tests/test_production_hardening.py`.
- **Verification:** full `pytest -q --tb=short` green. `grep -rn "payments" app tests --include='*.py'`
  hits nothing payment-seam related. `uv run python -m app.scripts.preflight` runs in dev without a
  `payments` line. The remaining production-refusal tests (storage, email, debug, origins) still
  pass.
- **Status update:** `## STRIPE-REMOVAL — S3 seam + config + preflight`

### [HUMAN_GATE SR3] — Dependency removal
Isaac approves the `pyproject.toml` / `uv.lock` change.

### S4 — Remove the `stripe` dependency
- **Owner agent:** noob-dev
- **What:** `uv remove stripe`. Keep `requests` if anything else depends on it; let the resolver
  decide and report what changed.
- **Files / scope:** `pyproject.toml`, `uv.lock`.
- **Verification:** `uv sync --frozen` succeeds. `uv run python -c "import stripe"` fails. Full
  `pytest -q --tb=short` green. `pre-commit run --all-files` green. Report the `uv.lock` package
  diff in the status entry.
- **Status update:** `## STRIPE-REMOVAL — S4 dependency`

### S5 — Admin portal: remove "Open in Stripe"
- **Owner agent:** senior-dev-frontend
- **What:** Delete `stripeCustomerUrl`, the `stripe` column and its copy, and the Stripe sentences
  in the header comment and the L49 banner string; keep a neutral read-only description. Fix the
  Stripe mentions in the comments of `page.tsx`, `use-subscriptions.ts`, `data-table.tsx` (comment
  only; the link-click handling is generic and stays) and `subscriptions-csv.ts`. Delete the "Open
  in Stripe" describe block and add one assertion that no row renders an external dashboard link.
  Leave the CSV banned-word test as-is.
- **Files / scope:** the five `admin_portal` files in §A.3 and
  `admin_portal/tests/subscriptions/subscriptions-screen.dom.test.tsx`.
- **Verification:** admin portal test suite, `tsc --noEmit` and lint all green.
  `grep -rni "stripe" admin_portal --exclude-dir=node_modules` hits only §A.4 entries.
- **Status update:** `## STRIPE-REMOVAL — S5 admin portal`

### S6 — Seed data and comment cleanup
- **Owner agent:** senior-dev-backend
- **What:** Make the paid seed rows use `provider=None`, `provider_customer_id=None` and
  `provider_subscription_id=None`, update the docstring, and update `tests/test_seed_dev.py` to
  assert the provider fields are null. Reword the comment-only references in `stream.py`,
  `media_service.py`, `models.py` L547 (comment only, per D2), `admin_subscriptions.py` L5,
  `tests/test_admin_subscriptions.py` L182 and `docker-compose.yml` L9–10.
- **Files / scope:** `app/scripts/seed_dev.py`, `tests/test_seed_dev.py`, plus the comment lines
  listed. No logic changes outside the seed.
- **Verification:** `pytest -q --tb=short tests/test_seed_dev.py` and the full suite green.
  `alembic check` (or the repo's drift test) reports no model changes.
- **Status update:** `## STRIPE-REMOVAL — S6 seed + comments`

### S7 — DEPLOYMENT.md
- **Owner agent:** scribe
- **What:** Remove the two `STRIPE_*` rows from the production-required table and rewrite the
  rationale sentence above it (it cites the stub payment provider). Replace the §6 body with a
  single line saying Stripe was removed, pointing to ADR 0016. Keep the heading so §7+ numbering
  and any cross-references stay stable.
- **Files / scope:** `DEPLOYMENT.md`.
- **Verification:** `grep -ni stripe DEPLOYMENT.md` returns only the §6 heading and pointer line.
  No other section changes.
- **Status update:** `## STRIPE-REMOVAL — S7 deployment doc`

### S8 — ADR 0016 and plans index
- **Owner agent:** scribe
- **What:** Write `docs/adr/0016-remove-stripe.md`, with `0011`'s gap and `0015`'s numbering
  confirmed in S0. It records:
  - the decision (D1, with Isaac's quote);
  - that the provider-neutral `Subscription` columns are kept deliberately for a future native-IAP
    integration (D2);
  - that `plan-mobile-app.md` L1 ("Paid tier/IAP cut indefinitely") is **deferred, not reversed**,
    and that Stripe specifically will never be the mechanism;
  - superseding notes for ADR 0001 (the Stripe async-client / `verify_webhook` rationale no longer
    applies) and ADR 0006 (decision 2's "stays in the Stripe dashboard" and the "Open in Stripe"
    affordance no longer apply, while the read-only API itself stands);
  - the §A.2 consequences.

  Add a `plan-stripe-removal.md` row to `plans/README.md`. **No IAP design content.**
- **Files / scope:** `docs/adr/0016-remove-stripe.md` (new), `plans/README.md`.
- **Verification:** the ADR follows the existing ADR template (match `0015`'s headings), and no
  other ADR file is modified (`git diff --stat docs/adr`).
- **Status update:** `## STRIPE-REMOVAL — S8 ADR`

### S9 — Review
- **Owner agent:** reviewer-gilfoyle, then security-reviewer
- **What:** Code review of the full branch diff. Security review is scoped to the removed webhook
  endpoint, the removed secrets and preflight checks, and confirming that no entitlement path got
  looser. Run the final `grep -rniI stripe . --exclude-dir={node_modules,.venv,.git,.next}` against
  §A.4.
- **Files / scope:** read-only.
- **Verification:** no blocking findings, or findings fixed by the owning executor and re-verified.
  Full backend suite, admin portal suite and mobile typecheck green on the branch head. The grep
  matches the allow-list exactly.
- **Status update:** `## STRIPE-REMOVAL — S9 review`

### [HUMAN_GATE SR4] — Merge
Isaac reviews the branch and the S9 results and says go. Then there's one controlled merge of
`feat/stripe-removal` into `dev`, no PR, with a conventional-commit merge message.

---

## Rollback

- **Before SR4:** abandon or reset `feat/stripe-removal`. `dev` is untouched.
- **After SR4:** `git revert -m 1 <merge sha>` restores everything, the `stripe` dependency
  included (re-run `uv sync --frozen`). There's no migration, so there's no DB rollback. Stripe was
  never configured live, so there's no external cleanup.
- **Per-step failure:** the executor halts and logs `HALTED: <reason>`. Each step is its own commit
  (`refactor:`/`chore:`/`docs:`), so a single step can be reverted without unwinding the others.
