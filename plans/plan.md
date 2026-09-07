# Plan: Remediate findings 1–4 of the API-authentication review

Source of truth for the defects: `docs/reviews/api-auth-review.md` (Gilfoyle, 2026-09-07).
Findings 5–9 and the Nits section are **explicitly out of scope for this stream**.

## Goal

Close the CRITICAL config-loading defect, make reset/invite tokens single-use, stop
`/auth/forgot-password` logging a live credential, and replace the accidental Redis
failure behaviour on the auth path with a deliberate, documented, correctly-typed one.

## Definition of Done

- [ ] Finding 1 closed — the runtime no longer reads `.env.example`; a missing or weak
      `SECRET_KEY` fails the boot; the secret-key assertion and the environment check run
      regardless of whether any env file was found.
- [ ] Finding 4 closed — the Redis failure posture is explicit per path, documented next to
      the code, and an unreachable Redis on the auth path returns **503**, never a naked 500.
- [ ] Finding 2 closed — a RESET/INVITE token is consumable exactly once; a replay inside
      the TTL is rejected. Invite tokens carry their own type marker.
- [ ] Finding 3 closed — no reset or invite token reaches the logs outside an explicitly
      `settings.debug`-gated, clearly-marked dev affordance.
- [ ] `uv run pytest` green (whole suite, not just the auth files).
- [ ] A new regression test exists **per finding**, and each fails against the pre-fix code.
- [ ] `reviewer-gilfoyle` re-reviews the diff against the original review file and confirms
      1–4 are closed with no new CONFIRMED findings left open in the touched code.
- [ ] **No scope creep.** Findings 5–9, the Nits, and anything outside the auth surface are
      untouched. If a fix appears to require crossing that line, the executor halts and the
      Conductor decides.

## Constraints / Assumptions

- Stack conventions per `~/.claude/CLAUDE.md`: async all the way down, typed domain errors
  raised in services and translated to HTTP at the router boundary, Pydantic v2 settings,
  `uv run` for everything.
- The review's own fix directions are the accepted approach. Where this plan deviates
  (see Step 4 on the debug gate) the deviation is stated in the step.
- No new runtime dependencies. Test-env plumbing must not add one either — `tests/conftest.py`
  already patches module singletons before app import and is the right place for env setup.
- `create_staff` invite delivery is transactional (`auth_service.create_staff:169-223`); the
  invite ledger write must not break that atomicity.
- The test suite runs on in-memory SQLite + `tests/fake_redis.FakeRedis`. That is the existing
  reality; **do not** migrate the auth tests to Testcontainers as part of this stream.
- Pre-existing condition, not this plan's business to fix: the repo has zero commits and sits
  on `master`, against the `main`-is-trunk convention. Flagged at the gate; the executor does
  not rename or re-init anything.

---

## [HUMAN_GATE] — Approve before ANY implementation begins

**Position:** after this plan is written, before Step 1.

The entire batch is secrets, config, and authentication behaviour. Isaac approves once, here.

**Crossing this gate authorizes Steps 1–4 to run autonomously to completion.** No further
gate sits between them. After Step 4, execution **stops** and hands to Step 5
(`reviewer-gilfoyle`); it does not merge, does not deploy, does not proceed to findings 5–9.

What Isaac is approving, specifically:

1. Changing the settings source from `.env.example` to `.env`. **Every environment's boot
   path changes.** Any environment currently relying on the fallback (local dev machines
   included — there is no `.env` in this working tree today) stops booting until a real
   `.env` or real env vars exist. Step 1 covers the dev path and the test path; deployed
   environments are Isaac's to verify.
2. Rejecting a weak/placeholder `SECRET_KEY` and an unrecognised `ENVIRONMENT` at import
   time, in all environments, not just production.
3. Scrubbing `.env.example` to placeholders. It currently contains what look like live AWS
   keys (`***REMOVED-AWS-ACCESS-KEY***` + secret). The file is untracked, so scrubbing prevents the
   commit-time leak — but **if that key pair is real, rotate it in AWS regardless.** That
   rotation is Isaac's action, outside this plan.
4. Making the auth path return 503 on a Redis outage where it currently 500s, including on
   revocation failures during logout / change-password / role-change. This is a
   client-visible response-contract change on `/auth/*`.
5. Adding an `invite` token type and a Redis single-use ledger to the reset/invite flow —
   **admin onboarding runs through this path.** A defect here bricks staff activation.

---

## Steps

### Step 1 — Stop loading the committed example file; harden the secret and environment guards
- **Owner agent:** senior-dev
- **Closes:** Finding 1 (CRITICAL)
- **Files / scope:** `app/core/config.py`, `.env.example`, `tests/conftest.py`,
  `tests/test_production_hardening.py`, `README.md` and `DEPLOYMENT.md` (env-setup lines only).
- **What:**
  - Point `SettingsConfigDict.env_file` at `.env`. Keep OS env vars taking precedence.
  - Leave `secret_key` without a default and keep `min_length=32`; replace the
    `secret_not_default` substring check with a validator that rejects the known placeholder
    shipped in `.env.example`, the `change-me` family, and obviously low-entropy values
    (e.g. too few distinct characters). Reject, do not warn.
  - Make the secret-key assertion independent of `is_production` — it must run in every
    environment, and must not depend on whether an env file was found. `production_preflight`
    (`config.py:120-167`) is currently returned-early for non-production; the secret check
    belongs outside that early return, either as the field validator or as an ungated
    model validator. Confirm against the existing preflight body before moving anything, and
    leave the existing production-only assertions (Stripe, S3, SMTP, debug, origins,
    frontend URL, database URL) exactly where they are.
  - Validate `environment` against a known set (development / test / staging / production);
    an unrecognised value raises rather than silently landing on non-production, which is
    what disables the preflight and exposes `/docs`.
  - Scrub `.env.example` to placeholders only — no AWS keys, no values that would pass the
    new secret validator. It is documentation of the required variable names, nothing else.
  - `tests/conftest.py` must set the required variables (`SECRET_KEY`, `DATABASE_URL`,
    `REDIS_URL`, `ENVIRONMENT`) in `os.environ` **before** any app module import, alongside
    the existing pre-import Redis/storage patching. No new test dependency.
  - README/DEPLOYMENT: one line each — copy `.env.example` to `.env` and fill it; in deployed
    environments inject real env vars / Secrets Manager, never a file.
- **Verification:** `uv run pytest tests/test_production_hardening.py` plus `uv run pytest`.
  New tests in `test_production_hardening.py`, each of which must fail on the pre-fix code:
  the `.env.example` placeholder secret is rejected; a sub-32-char and a low-entropy secret
  are rejected; the secret check fires in `development`, not just `production`; an
  unrecognised `ENVIRONMENT` raises; `Settings` no longer sources values from `.env.example`
  (assert a required field is unsatisfied when neither env vars nor `.env` supply it).
- **Status update:** append to `status.md` as `[Step 1] <result>`.

### Step 2 — Make the Redis failure posture explicit, documented, and correctly typed
- **Owner agent:** senior-dev
- **Closes:** Finding 4 (MEDIUM). **Ordered before Steps 3 and 4 — it defines the
  Redis-down contract their fixes must honour.**
- **Files / scope:** `app/core/token_store.py`, `app/core/rate_limit.py`, `main.py`
  (exception handler only), `tests/fake_redis.py`, `tests/test_auth.py`, `DEPLOYMENT.md`.
- **What:**
  - Introduce a typed domain error in `token_store.py` (e.g. `TokenStoreUnavailable`) and wrap
    the Redis calls in `store_refresh_jti`, `is_current_refresh_jti`, and `revoke_refresh` so
    an unreachable Redis raises it instead of leaking a driver exception into the catch-all
    handler at `main.py:130-150`.
  - Map it to **503** with a clear, non-leaky message via a dedicated exception handler in
    `main.py`, following the existing handler pattern. One seam, not a try/except at every
    call site — `logout`, `change_password`, `reset_password`, `change_role`, `login`, and
    `refresh` all reach the store.
  - Write the policy down next to the code, the way `rate_limit.py:1-5` already does:
    token/credential paths **fail closed** (no token issued, no session claimed revoked, 503);
    the login rate limiter **stays fail-open** (availability over throttling, and Redis-down
    is not itself an attack signal). State explicitly that a failed *revocation* also fails
    closed — returning 200 after a password change whose session-revocation silently failed
    would be a lie to the client.
  - Add the same policy as a short section in `DEPLOYMENT.md` under operational behaviour.
  - `tests/fake_redis.py` gains a failure-injection switch that makes its operations raise,
    so Redis-down paths are testable. Adding capability to the fake is in scope; replacing it
    is not.
  - Deliberately **not** in this step: finding 6's non-atomic check-then-set rotation. Leave it.
- **Verification:** `uv run pytest tests/test_auth.py` plus `uv run pytest`. New tests:
  with Redis failing, `/auth/login` (post-authenticate) and `/auth/refresh` return **503, not
  500**, and the body still carries `correlation_id`; `/auth/logout` returns 503 rather than a
  false success; `check_rate_limit` still returns allow-through on a Redis failure, with the
  fail-open behaviour asserted directly so it can't be regressed silently.
- **Status update:** append to `status.md` as `[Step 2] <result>`.

### Step 3 — Make reset and invite tokens single-use, and give invites their own type
- **Owner agent:** senior-dev
- **Closes:** Finding 2 (HIGH). **Depends on Step 2's error type and 503 mapping.**
- **Files / scope:** `app/core/security.py`, `app/core/token_store.py`,
  `app/services/auth_service.py`, `app/api/auth.py`, `tests/fake_redis.py`,
  `tests/test_auth.py`, `tests/test_user_management.py`.
- **What:**
  - Add a single-use ledger to `token_store.py` in the same idiom as the existing refresh-jti
    store: register a jti under its own key namespace with the token's TTL at mint, and
    consume it atomically on use (`GETDEL`), returning whether it was present. `FakeRedis`
    needs the matching method. Redis-down behaviour follows Step 2: fail closed — a mint that
    cannot record its jti must fail rather than issue an unrevocable token, and a consume that
    cannot reach Redis rejects with 503 rather than silently allowing the reset.
  - `security.py`: `create_reset_token` and `create_invite_token` must surface the jti to the
    caller so it can be registered (mirror `create_refresh_token`'s `(token, jti)` shape).
    Give the invite its own `type` marker instead of reusing `"reset"`, so the two classes are
    distinguishable in logs and audit. `decode_token` needs to accept a set of acceptable types
    for the reset endpoint, without changing the single-type behaviour its other callers rely
    on (the type-confusion guard at `security.py:151-158` must keep working — an access or
    refresh token still must not be accepted anywhere it isn't expected).
  - `auth_service.reset_password` (`:125-138`) consumes the jti **before** applying the new
    hash; absent jti → the existing `AuthError("Invalid or expired reset token")` → 400.
    Keep the existing refresh-revocation on success.
  - `auth_service.create_staff` registers the invite jti inside the existing pre-commit
    sequence so a rollback leaves nothing usable behind; a ledger entry orphaned by a rollback
    expires on its own TTL.
  - `/auth/forgot-password` registers the jti of the token it mints.
  - Do **not** add a `password_changed_at` column. The review offers it as an alternative; the
    Redis ledger is the chosen one, and a migration would need its own gate.
- **Verification:** `uv run pytest tests/test_auth.py tests/test_user_management.py` plus
  `uv run pytest`. New tests: a reset token succeeds once and returns 400 on replay
  (extend `test_password_reset_flow`); an invite token activates a staff account once and is
  rejected on replay (extend `test_admin_creates_editor_and_invite_activates`, which is the
  admin-onboarding regression guard); the invite token carries the invite type and is still
  accepted by `/auth/reset-password`; an access token and a refresh token are both still
  rejected there; with Redis failing, a reset attempt returns 503 and the password is
  **unchanged**.
- **Status update:** append to `status.md` as `[Step 3] <result>`.

### Step 4 — Stop `/auth/forgot-password` writing a live token to the logs
- **Owner agent:** senior-dev
- **Closes:** Finding 3 (HIGH). **Depends on Step 3** (the mint site now also registers a jti).
- **Files / scope:** `app/api/auth.py` (`forgot_password`, `:112-122`), `tests/test_auth.py`.
- **What:**
  - Remove `reset_token` from the `password_reset_requested` log line. The line keeps
    `user_id` and the correlation ID; the credential never enters the log pipeline.
  - Deliver via the existing seam instead: `app/core/email.send_password_reset` already builds
    the link and, with the console backend, logs it in dev — that affordance already exists and
    does not need reinventing.
  - Per Isaac's direction, any remaining direct-token affordance is gated on `settings.debug`
    (the review suggested `not settings.is_production`; `debug` is the tighter gate, and after
    Step 1 the preflight already refuses `debug` in production, so the affordance is
    structurally unreachable there). If included, name the log event so it is unmistakably
    dev-only.
  - The endpoint is unauthenticated and returns a deliberately generic response
    (`test_forgot_password_is_generic`). A send failure must not change the status code or the
    body — otherwise the failure mode becomes the enumeration oracle the generic response
    exists to prevent. Swallow-and-log the send failure, return the same 200.
  - Out of scope, noted not fixed: the `email._reset_link` private-helper reach-in at
    `admin_auth.py:72` (a Nit, not a finding).
- **Verification:** `uv run pytest tests/test_auth.py` plus `uv run pytest`. New tests:
  capture emitted log records for a `/auth/forgot-password` call with `debug` false and assert
  no JWT-shaped value appears in any field; the reset email seam is invoked for a known address
  and not for an unknown one; a raising email backend still yields the same 200 body as the
  unknown-address case (`test_forgot_password_is_generic` must stay green).
- **Status update:** append to `status.md` as `[Step 4] <result>`.

### Step 5 — Re-review
- **Owner agent:** reviewer-gilfoyle
- **What:** Review the full diff from Steps 1–4 against `docs/reviews/api-auth-review.md`.
  Confirm findings 1, 2, 3, and 4 are actually closed — not merely moved — and specifically
  check: the preflight/secret guard cannot be bypassed by an absent env file; the single-use
  ledger has no window between consume and password write; the 503 mapping covers every
  token_store call site including revocations; no token value survives anywhere in the logging
  path. Flag any new defect introduced in the touched code, and any scope creep into findings
  5–9. Findings already known and deliberately deferred (5–9, Nits) are not re-litigated here.
- **Verification:** a written verdict. Any **new CONFIRMED** finding in code this stream touched
  is fixed by senior-dev — under this plan, no new gate — and re-verified by
  `uv run pytest` before the stream closes. New findings in code this stream did **not** touch
  are recorded for a later stream, not fixed here.
- **Status update:** append to `status.md` as `[Step 5] <result>`.

---

## Risks

- **The Step 1 config change alters every environment's boot path.** Today no `.env` exists in
  this working tree, so `.env.example` is the only thing supplying `DATABASE_URL` and
  `SECRET_KEY`; `get_settings()` runs at import in many modules. The moment `env_file` moves,
  a machine without a real `.env` or real env vars fails at import, not at request time. Step 1
  handles the test path (conftest) and documents the dev path; **deployed environments must be
  verified by Isaac before deploy** — that verification is not something an executor can do.
- **Step 3 touches the invite flow that admin onboarding depends on.** A regression there means
  no new staff account can be activated, and the failure is silent until someone clicks a link.
  `test_admin_creates_editor_and_invite_activates` is the guard and must be extended, never
  weakened, to accommodate the new token type.
- **The new fail-closed 503 policy widens Redis's blast radius in an outage** — logout and
  password change now surface an error instead of a false success. That is the intended
  trade-off (a lie about revocation is worse than a 503), but it is a real behaviour change
  for clients and belongs in the gate decision.
- **`.env.example` currently contains apparently-live AWS credentials.** Scrubbing the file
  does not rotate the key. Rotation is Isaac's out-of-band action.

## Rollback

- One feature branch for the whole stream, one commit per step, conventional-commit messages
  (`fix:` for 1–4). Any single step reverts with a single `git revert` of its commit.
- Step order is dependency order (1 independent; 4-then-2-then-3 for the Redis-dependent
  fixes), so a revert of a later step never leaves an earlier one inconsistent. Reverting
  Step 2 requires reverting Steps 3 and 4 first — they consume its error type.
- Fast operational rollback for Step 1 if a deployed environment fails to boot: inject the
  correct env vars rather than reverting the guard. Reverting to `.env.example` restores the
  CRITICAL defect and is a last resort only.
- Nothing in this plan is a migration, a schema change, or a deploy. Nothing here is
  irreversible.
