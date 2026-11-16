# Plan: Self-service account deletion + Apple token revocation — backend

**Part 1 of 2.** This plan covers the backend: steps D0–D11 and gates AD0–AD2. The mobile flow,
the web page, docs, on-device verification, merge and enablement (D12–D16, gates AD3–AD5) are in
`plans/plan-account-deletion-clients.md`. That plan starts only when this one is complete.

The source of truth is the council's decided design: skeptic, architect, security-reviewer and
qa-strategist converged, and Isaac resolved the remaining splits on 2026-10-28. The design text is
in the session scratchpad (`deletion-design-decided.md`, `deletion-facts.md`), not in the repo. Its
load-bearing parts are restated in §A, which is binding **for both plans**. The clients plan
references §A here and doesn't duplicate it. **The design is closed.** Changing any §A row is a
plan amendment, not an executor's call.

Execution log: the append-only root `status.md`, never this file. Every step appends a heading
`## ACCOUNT-DELETION — <step id> <short title>`, then the line
`[ACCOUNT-DELETION — <step id> <short title>] <agent: …> <ISO-8601 UTC timestamp>`, then the body.
Both plans share the prefix, and step ids are unique across them.

Branch: `feat/account-deletion`, cut from `feat/apple-sign-in` @ `3752680`. That branch is 3
commits ahead of `dev` and not merged yet, and revocation is the other half of the same App Store
blocker. This plan doesn't merge. The branch carries on into the clients plan, which merges at its
`[HUMAN_GATE AD4]` per §A.8.

Executors halt **only** at gates. Between gates they run each step to its verification. The
executor stops, writes `HALTED: <reason>` in its status entry, and lets the Conductor decide on an
amendment when:
- an anchor has moved;
- a step seems to need a migration, a new column, a new `AuditAction` value or an endpoint not in §A;
- a test can only pass by mocking the DB session;
- a `details` payload turns out to hold a viewer email (see D0).

**No schema change is expected. If one appears, it's a new gate. Halt.**

---

## Goal (both plans)

A signed-in viewer can permanently delete their own RhemaPod account from the mobile app after one
fresh re-auth. If Apple is linked, their Sign in with Apple grant is revoked at Apple before
anything is deleted. A public web page tells Play users how to request deletion. Apple guideline
5.1.1(v) and the Google Play deletion requirement are both met.

**This plan's goal:** the backend endpoint, the Apple revocation seam, config, preflight and
shared erasure are all built, stub-verified, regenerated into client types and reviewed.

## Scope

- **In (this plan):**
  - `POST /auth/me/delete` and its discriminated request DTO; the additive `UserPublic` fields;
  - the `app/core/apple_revocation.py` seam (HTTP + stub), Apple settings, production preflight and
    log redaction;
  - a per-route limiter fail mode;
  - `_erase_user` extracted and shared with admin `delete_user`, viewer audit pseudonymization, and
    the CWE-532 log fix;
  - post-commit cleanup: sessions, objects, notice email;
  - contract regen for `admin_portal` and `mobile`;
  - ADR 0020 and the DEPLOYMENT.md key runbook.
- **In (clients plan):** the mobile flow, the web page, the ADR 0018 addendum, the ADR 0015 §6
  pointer, the privacy text, on-device verification, merge and enablement.
- **Out (both plans). This is a hard boundary.**
  - No grace period and no scheduled purge. No anonymisation of comments.
  - No storing of Apple refresh tokens (fork 1b: store nothing).
  - No exchange of `authorization_code` at sign-in.
  - No Apple revocation from admin `delete_user`.
  - No HMAC or keyed hash of identifiers. No new `AuditAction` value and no CHECK-constraint
    migration.
  - No IAP integration. No server-side subscription cancel.
  - No change to `/auth/login` or the OAuth routes' fail-open limiter behaviour.
  - No staff self-deletion.
  - No new Redis state for distinguishing skip reasons.

## Definition of Done (this plan)

- [ ] `POST /api/v1/auth/me/delete` returns 204 for a viewer with a valid fresh proof. All rows
      linked to the user are gone (by cascade) or nulled (SET NULL), on real Postgres, including one
      run against `pg_migrated_db`.
- [ ] Every error in §A.2 is reachable, with the specified status, and is proven by a test. A wrong
      password is **403, never 401**. RESTRICT history is **409, never 500**.
- [ ] Any staff role gets 403 "Staff accounts are removed by an administrator" (role-parametrised
      test).
- [ ] Apple method, against the stub and the MockTransport wire test:
      - the code exchange runs before anything is deleted;
      - `invalid_grant` gives 400 and 5xx/timeout gives 503, with nothing deleted in either case;
      - at most 2 `/auth/revoke` calls and 0 exchange retries;
      - the audit row says `apple_revoked: true` only when Apple returned 200.
- [ ] `apple_unavailable` semantics hold (§A.3). Every skip writes
      `apple_skip_reason: "apple_unavailable"`. The Apple-only account + flag case returns 409
      (support path).
- [ ] Rate limiting:
      - The delete limiter (per user, 5/hour) fails closed: 503 when Redis is down.
      - `/auth/login` and both OAuth routes still fail open (asserted).
      - Password attempts on delete also consume the existing login key for that IP + email.
- [ ] Erasure does all of the following:
      - Viewer audit rows are pseudonymized in the same transaction. Staff rows are not.
      - The self-delete row and the `user_deleted` log carry no email (caplog).
      - Avatar and all playlist cover objects are deleted, or logged as `orphaned_object` on
        failure.
      - Redis sessions are revoked.
      - The deleted user's still-valid access token gets 401, and refresh fails.
      - The notice email goes out after commit, and an SMTP failure does not roll back.
- [ ] A meta-test over `Base.metadata` fails if any FK to `users` isn't classified CASCADE /
      SET NULL / RESTRICT in the test's table.
- [ ] Production preflight refuses `APPLE_REVOCATION_BACKEND=stub`, a missing key id or key, or a
      key that isn't an EC P-256 PEM, whenever `oauth_apple_enabled`. Boot makes no live Apple call.
- [ ] `openapi.json`, `admin_portal/lib/api/schema.d.ts` and `mobile/lib/api/schema.d.ts` are
      regenerated. The diff contains only §A.2 additions.
- [ ] D11 review has no open blocking findings. Backend `uv run pytest -q --tb=short` is green,
      portal `npm run verify` and mobile `npx tsc --noEmit` are green after the regen, and
      `pre-commit run --all-files` is green.
- [ ] ADR 0020 is Accepted, and the DEPLOYMENT.md key runbook is written.

---

## A.1 Locked decisions (council + Isaac, 2026-10-28)

| # | Decision |
|---|---|
| L1 | One endpoint, `POST /auth/me/delete` → 204, for viewers only. One fresh factor goes in the same request. There is no two-step delete token. |
| L2 | Apple revocation fork **1b**: store nothing. The fresh `authorization_code` from a deletion-time Apple re-auth is exchanged and revoked immediately. |
| L3 | Revoke-failure semantics: `invalid_grant` → 400, 5xx/timeout → 503. Nothing is deleted in either case. Retry `/auth/revoke` once and **never** retry `/auth/token`. A user-chosen fallback (`apple_unavailable`) skips revocation only. |
| L4 | Hard delete through existing cascades. Comments are flat, so there is no anonymisation. |
| L5 | The admin path gets the shared `_erase_user` too, along with viewer audit pseudonymization. Admin authz and the deactivated-first precondition are unchanged. |
| L6 | The delete endpoint has its own per-user limiter, which **fails closed** (a deliberate divergence recorded in ADR 0020) and is the real per-account cap. Password proofs also consume the existing login key (§A.3). |
| L7 | Reuse `AuditAction.USER_DELETED`. Pseudonymize by UPDATE. No migration. |
| L8 | Mobile is iOS first. Android paths are built but not release-blocking. |
| L9 | A static web page covers Play's web-deletion requirement. Admin fulfils requests via `delete_user`. |

## A.2 Contract (approved at `[HUMAN_GATE AD1]` via ADR 0020)

**Route:** `POST /api/v1/auth/me/delete`. It takes bearer auth and returns 204 with no body.

**Body `AccountDeletionRequest`** is a Pydantic v2 discriminated union on `method`, plus a shared
`apple_unavailable: bool = False`:
- `{"method": "password", "password": str}`
- `{"method": "google", "id_token": str}`
- `{"method": "apple", "identity_token": str, "raw_nonce": str, "authorization_code": str}`

**Additive `UserPublic` fields:** `has_password: bool` and `linked_providers: list[AuthProvider]`.
Nothing else in `UserPublic` changes.

**Errors.** Each one is a `ContentError` raised by the service and mapped by the router, so the
body shape is the existing `{detail, correlation_id}`.

| Status | When |
|---|---|
| 403 | Staff role (any): "Staff accounts are removed by an administrator" |
| 403 | Re-auth failed. **Generic message for every cause:** wrong password; password on a password-less account; Google token on an account without Google; Apple on an account without Apple; `sub` ≠ linked `provider_subject`; stale `iat`; nonce mismatch; replayed token. |
| 409 | Apple is linked, method ≠ `apple`, and `apple_unavailable` is false: "Apple re-auth required" |
| 409 | Apple-only account (no password, no Google) with `apple_unavailable: true`: support path |
| 409 | RESTRICT-bound history (demoted ex-staff). Precheck, plus an `IntegrityError` backstop. Never 500. |
| 400 | Apple `/auth/token` returned `invalid_grant`. The client re-prompts Apple. |
| 503 | Apple unavailable (exchange or revoke 5xx/timeout/network) |
| 503 | Rate-limit store unavailable (delete limiter fails closed) |
| 429 | Delete limiter or shared login key exceeded |
| 422 | Malformed body. **Planner call, confirm at AD1:** `method: "apple"` with `apple_unavailable: true` is a request-shape error (model validator) because the flag is only meaningful with a non-Apple proof. |

## A.3 Behaviour (binding)

**Re-auth**
- Google proofs go through `verify_google_id_token` (`app/core/oauth.py` L314). Apple proofs go
  through `verify_apple_identity_token` (L331), with the nonce check as at sign-in.
- Every OAuth proof then runs through `_claim_oauth_token_once` (`app/api/auth.py` L412).
- `sub` must equal this user's `UserIdentity.provider_subject` for that provider.
- `iat` must be within `account_deletion_reauth_max_age_seconds` (new setting, default 300).
- Password proofs use pwdlib/argon2 verify.

**Rate limiting**
- **Per-user limiter.** Key `account_delete:{user_id}`, 5 attempts per 3600 s, `fail_open=False`
  (Redis down → 503). This is the real per-account cap on deletion attempts.
- **Shared login key.** Password-method attempts also consume the existing `/auth/login` key,
  `login:{client_ip}:{email}`, the same way `/auth/login` does (every attempt counts).
  - That key is **per client IP + email, not per account.** An attacker rotating IPs gets a fresh
    login budget per IP. The per-user limiter above is what bounds them.
  - Sharing the key means delete-path guesses and login-path guesses from the same IP draw down one
    counter.
  - The login key keeps its existing fail-open behaviour. On this route, Redis-down is already
    caught by the per-user limiter first.

**Sequencing inside `delete_own_account`**
1. Bearer auth → role == viewer (else 403).
2. Per-user delete limiter (fail closed).
3. For the password method only: consume the shared login key.
4. Verify the proof (router).
5. RESTRICT precheck (409).
6. Snapshot `email`, `avatar_key`, every playlist `cover_key`, and the linked providers.
7. For the apple method only: `revoke_authorization(code)`.
8. **One transaction:** pseudonymize the viewer's audit rows, write the `USER_DELETED` row, and
   delete the user. Cascades run here.
9. Commit.
10. Best-effort post-commit work that never raises to the client:
    - `token_store.revoke_refresh`;
    - storage `delete_object` per snapshot key via `asyncio.to_thread` (log `orphaned_object` with
      the key, never the email, on failure);
    - notice email to the snapshot address via the email seam.

**`apple_unavailable`**
- Accepted only with a non-Apple linked-factor proof. It skips revocation and never skips re-auth.
- On an Apple-only account the flag → 409.
- On an account without Apple it is ignored.
- **Audit value (Isaac, AD0):** every skip writes the single value
  `apple_skip_reason: "apple_unavailable"`. This covers both the user-chosen fallback after
  repeated 503s and a client that can't do Apple re-auth (Android). Nothing reads the difference,
  so no server state tracks it.

**Audit**
- Self-delete row:
  - `actor_id = target_id = user.id`, with `actor_email` and `target_label` **NULL**;
  - `details = {self_service: true, role, providers, apple_revoked: true|false|null}`, plus
    `apple_skip_reason: "apple_unavailable"` when revocation was skipped;
  - `apple_revoked` is `null` when Apple isn't linked.
- Pseudonymization (viewer targets only, any initiator), in the same transaction:
  - `UPDATE audit_log SET actor_email = NULL WHERE actor_id = :uid`;
  - `UPDATE audit_log SET target_label = NULL WHERE target_id = :uid AND target_type = 'user'`.
- **Planner reading, stated in ADR 0020:** for a viewer, the admin-initiated `USER_DELETED` row also
  carries no email, which keeps it consistent with the pseudonymization in the same transaction.
  Staff targets keep today's snapshot label (ADR 0018 accountability).

**Admin `delete_user`** cannot revoke Apple (it has no code). ADR 0020 documents this, and the web
page tells users how to revoke manually.

## A.4 Apple revocation seam (binding)

- **Protocol and errors.** `AppleRevocationClient` is a Protocol with
  `async revoke_authorization(authorization_code: str) -> None`. It raises
  `AppleRevocationError(reason: Literal["invalid_grant", "unavailable", "misconfigured"])`.
- **`HttpAppleRevocationClient`:**
  - `httpx.AsyncClient` with a 5 s timeout, base URL fixed to `https://appleid.apple.com`.
  - `POST /auth/token` (`grant_type=authorization_code`) is never retried.
  - That is followed by `POST /auth/revoke` (`token=<refresh_token>`,
    `token_type_hint=refresh_token`), retried once on 5xx/timeout.
  - `invalid_client` → `misconfigured`, which the router maps to 503 and logs at error level.
  - A 200 from revoke counts as success, including for an already-revoked token.
- **`client_secret`.** An ES256 JWT:
  - header `kid=APPLE_KEY_ID`;
  - claims `iss=APPLE_TEAM_ID`, `sub=APPLE_CLIENT_ID`, `aud=https://appleid.apple.com`, and
    `iat`/`exp` with a lifetime ≤ 5 min;
  - minted per call, in memory only, never persisted or logged.
- **`StubAppleRevocationClient`** records calls and can be scripted per outcome.
- **Resolution.** The client is resolved once at startup from `APPLE_REVOCATION_BACKEND`
  (`http|stub`, default `stub`), following the `get_storage()` pattern (`app/core/storage.py`
  L500). It's injected as a FastAPI dependency so tests can override it.
- **Dependencies.** `pyjwt[crypto]` and `httpx` are already present. No new dependency.

## A.5 Config, preflight, secrets (approved at `[HUMAN_GATE AD2]`)

- **New settings** (`app/core/config.py`):
  - `apple_team_id` (default `FAND2W5VMM`);
  - `apple_key_id`;
  - `apple_private_key: SecretStr` (PEM contents, not a path);
  - `apple_client_id` (default `apple_oauth_audiences[0]`, L308);
  - `apple_revocation_backend`;
  - `account_deletion_reauth_max_age_seconds` (300);
  - `account_delete_rate_limit` (5) / `account_delete_rate_window_seconds` (3600).
- **Production preflight** (`production_preflight`, L482), when `oauth_apple_enabled`:
  - refuse the stub backend;
  - require the key id and key;
  - load the PEM and assert EC P-256.
  - It makes no network call.
- **Log redaction.** A new structlog processor in `app/core/logging.py` (none exists today) redacts
  these keys at any depth: `client_secret`, `authorization_code`, `identity_token`, `id_token`,
  `refresh_token`, `access_token`, `apple_private_key`, `password`.
- **Secret handling.**
  - Locally: `.env` / `docker-compose.override.yml` (both gitignored, verified).
  - `.env.example` / `.env.docker.example`: placeholders only.
  - Deployed: an AWS Secrets Manager entry, created at the clients plan's AD5 since no deployed
    backend exists yet. AD2 approves its name and shape.

## A.6 Verified anchors (planner, on `feat/apple-sign-in` @ `3752680`; D0 re-verifies)

| Area | Anchor / finding |
|---|---|
| Admin delete | `app/services/auth_service.py` `delete_user` L851. It requires `not target.is_active`, commits at ~L904, logs `user_deleted … email=` at **L912 (CWE-532)**, then `revoke_refresh`. Router: `app/api/admin_auth.py` L203. |
| OAuth verify | `app/core/oauth.py` L314 / L331; claim-once at `app/api/auth.py` L412. `token_store` raises `TokenStoreUnavailable` (L72, raised L238/260/273), so OAuth proofs already fail closed. |
| DTOs | `AppleSignInRequest` `app/models/schemas.py` L87; `UserPublic` L118; `AuthProvider` `app/models/models.py` L63. |
| Limiter | `app/core/rate_limit.check_rate_limit` L35 fails **open** unconditionally (`return True` in `except`). The `/auth/login` key is `login:{client_ip}:{email}` (`auth.py` L185): per IP + email, not per account (§A.3 Rate limiting). |
| Audit | `AuditLog` columns `actor_id`, `actor_email`, `actor_role`, `target_type`, `target_id`, `target_label`, `ip`, `user_agent`, `details` (`models.py` ~L922–975). `USER_DELETED = "user.deleted"` L866. `audit_service.record` L76–104 snapshots `actor.email`. The feed UNION (L298–357) joins legacy logs to `users.email`, so those labels go NULL naturally after deletion. |
| Current user | `app/core/dependencies.get_current_user` L37 → `auth_service.get_user_by_id` (`db.get`, **uncached**) → 401 on missing user. Expect a deleted user's access token to fail already. D9 pins it with a test. |
| Storage | `Storage.delete_object(bucket, key)` (protocol L151+). `users.avatar_key` L98; playlist `cover_key` L1336. D0 confirms which bucket each key lives in. |
| Config | `production_preflight` L482; `audit_auth_retention_days` L255 (default 365, kept per AD0); `apple_oauth_audiences` L308; `oauth_apple_enabled` L312. |
| Logging | `app/core/logging.py` has no redaction processor today. |
| Tests | `pg_engine` / `pg_client` `tests/conftest.py` L128/L158. `pg_migrated_db` is in `tests/comments_pg.py` L153. `FakeRedis` is in `tests/fake_redis.py`. `_SpyStorage` precedent is in `tests/test_oauth.py`. |
| Mobile | `mobile/app/(tabs)/me.tsx` + `_me/`; auth stack `mobile/app/(auth)/`; Apple via `mobile/lib/auth/appleSignIn.ts`. `gen:api` exists in both `mobile/` and `admin_portal/` `package.json`. **Finding:** there is no IAP client (ADR 0016), so the app can't detect an active store subscription. Screen 1 always shows the "cancel in App Store / Play" notice with deep links. |
| Admin portal | `admin_portal/app/(public)/` already hosts unauthenticated routes (`login`, `forgot-password`, `set-password`). The deletion page goes there (AD0). |
| Docs | ADR 0015 §6 "What's deliberately deferred" is L186 (revocation bullet L195). ADR 0018 `## Decision` is L28. The next ADR number is **0020**. `DEPLOYMENT.md` is at the repo root. |

## A.7 Inputs resolved at `[HUMAN_GATE AD0]` (Isaac, 2026-10-28)

| # | Input | Resolution |
|---|---|---|
| 1 | Backup retention | **30 days.** Used in ADR 0020, the privacy disclosure, Screen 1 copy and the web page. |
| 2 | Web deletion page hosting | **admin_portal**, public route `admin_portal/app/(public)/delete-account`. Clients D13 is owned by senior-dev-frontend. Isaac enters the final URL in Play Console (clients AD5). |
| 3 | Viewer audit retention | **365 days**, the existing `audit_auth_retention_days`. No config change. |
| 4 | Branch base and merge order | As in §A.8. |
| 5 | Login key shape | Keep the existing `login:{client_ip}:{email}` (per IP + email). The per-user delete limiter is the per-account cap (§A.3). |
| 6 | `apple_skip_reason` | **Single value `"apple_unavailable"`**, with no Redis marker and no distinguishing state (§A.3). |
| 7 | Delete limiter | 5 attempts / 3600 s per user, fail closed. |
| 8 | Support email | `contact@rhemapod.com`, the existing `CONTACT_EMAIL` in `mobile/lib/content/commentsCompliance.ts`. |

## A.8 Branch and merge

`feat/account-deletion` is cut from `feat/apple-sign-in` (D0) and carries both plans. At the
clients plan's AD4 the merge goes in this order: first `feat/apple-sign-in` → `dev`, then
`feat/account-deletion` → `dev`. Each is a controlled merge with a conventional-commit message.
Sign in with Apple must not reach `dev` without revocation unless Isaac says otherwise.

---

### [HUMAN_GATE AD0] — Plan approval and open inputs — **PASSED 2026-10-28 (Isaac, in chat)**
Isaac approved the plan. He resolved §A.7 items 1–3, confirmed items 4, 5, 7 and 8, and changed
item 6 to a single skip value. The plan was then split into this backend plan and the clients plan.

## Phase 0 — Preconditions, ADR, test strategy, UX

### D0 — Preconditions and branch
- **Owner agent:** senior-dev-backend
- **What:**
  - Confirm a clean `git status` on `feat/apple-sign-in`. Halt if it isn't clean, and never
    stash, commit or discard.
  - Cut `feat/account-deletion`.
  - Re-verify every §A.6 anchor.
  - Inventory every `audit_service.record*` call site whose `details` could hold an email, and
    HALT if any does.
  - Confirm the buckets for `avatar_key` and `cover_key`.
  - Record the baselines: backend `uv run pytest -q --tb=line | tail -5`, `npm run verify` in
    `admin_portal/`, and `npx tsc --noEmit && npx jest` in `mobile/`.
- **Files / scope:** none modified.
- **Verification:** the branch exists, the baseline is green or pre-existing failures are listed,
  and the anchor table and details inventory are in the status entry.
- **Commit:** none.
- **Status update:** `## ACCOUNT-DELETION — D0 preconditions + branch`

### D1 — ADR 0020 draft (Proposed)
- **Owner agent:** scribe
- **What:** Write `docs/adr/0020-self-service-account-deletion.md` with status **Proposed**. It
  covers:
  - context (5.1.1(v), Play, ADR 0015 §6);
  - the §A.2 contract verbatim, including the 422 planner call;
  - the §A.3 sequencing, rate-limit and audit rules, including the single
    `apple_skip_reason: "apple_unavailable"`;
  - the login key being per IP + email, with the per-user limiter as the per-account cap;
  - fork 1b with its rejected alternatives (store refresh tokens, async retry, delete-and-log);
  - the fail-closed limiter divergence;
  - viewer-only pseudonymization (and why staff rows keep emails);
  - the admin path not revoking Apple;
  - backups retained for 30 days and pseudonymized viewer audit rows for 365 days;
  - consequences, including that hard delete lowers report totals (ADR 0019).
- **Files / scope:** `docs/adr/0020-self-service-account-deletion.md` only.
- **Verification:** every §A.2 row and §A.3 rule appears. No content exceeds §A. The Conductor
  checks it before AD1.
- **Commit:** `docs(adr): propose ADR 0020 self-service account deletion`
- **Status update:** `## ACCOUNT-DELETION — D1 ADR 0020 draft`

### D2 — Test strategy (both plans)
- **Owner agent:** qa-strategist (runs in parallel with D1)
- **What:** Map every DoD bullet in **both** plans and every design test item to named cases,
  layers and fixtures.
  - **Rules:**
    - Testcontainers Postgres via `pg_client` for everything that touches erasure.
    - At least one full-erasure run on `pg_migrated_db`.
    - `FakeRedis` / `FakeRedis.failing()` for limiter and session cases.
    - `StubAppleRevocationClient` via dependency override.
    - One `httpx.MockTransport` wire test of the real client.
    - No ORM or session mocking.
    - Jest for mobile; Vitest for the portal page.
  - **The matrix must name:**
    - the kitchen-sink viewer fixture seeding **every** user-linked table;
    - the FK classification meta-test;
    - each §A.2 status;
    - the ordering pin (revoke before delete, nothing deleted on 400/503, ≤2 revoke calls,
      0 exchange retries);
    - flag semantics (accepted only with a non-Apple proof; Apple-only + flag → 409; ignored
      without Apple; audit `apple_skip_reason: "apple_unavailable"`);
    - replay (identity token, code), stale `iat`, `sub` mismatch;
    - the role-parametrised staff 403;
    - limiter: per-user 5/hour → 429, fail-closed → 503, shared login key decremented on password
      attempts, login/OAuth still fail open;
    - sequential and concurrent (`asyncio.gather`) idempotency (exactly one `USER_DELETED`
      row, no 500);
    - email-after-commit and SMTP failure;
    - caplog no-email;
    - access token → 401 and refresh failure after deletion.
- **Files / scope:** none modified. Named test files:
  - `tests/test_apple_revocation.py`
  - `tests/test_account_deletion.py`
  - `tests/test_account_deletion_pg_migrated.py`
  - `tests/test_user_fk_classification.py`
  - `tests/test_rate_limit_fail_mode.py`
  - `tests/test_admin_delete_user.py` (extend if it exists)
  - mobile `app/(tabs)/_me/__tests__/DeleteAccount*.test.tsx`
  - portal `app/(public)/delete-account` Vitest test
- **Verification:** every DoD bullet in both plans maps to ≥1 case. The Conductor checks this
  before D4.
- **Commit:** none. The matrix lives in the status body.
- **Status update:** `## ACCOUNT-DELETION — D2 test strategy`

### D3 — UX for the mobile flow and web page
- **Owner agent:** ui-designer (runs in parallel with D1/D2). This is the design input for the
  clients plan's D12/D13.
- **What:** Use existing mobile primitives only.
  - The entry row under Me → Account, reachable in at most 2 taps from the Me tab (App Review).
  - **Screen 1:** what is removed and what is retained (moderation snapshots ≤90 days, backups
    ≤30 days, pseudonymized audit ≤365 days), plus the store-subscription notice with deep links.
  - **Screen 2:** the re-auth control chosen from `linked_providers` / `has_password` per §A.3,
    with a red "Delete permanently" button.
  - The states: in-flight, 400 Apple re-prompt, 503 "try again shortly", the fallback offer after
    repeated 503s with manual-revoke copy, and the post-delete "Your account was deleted" on the
    auth stack.
  - The Android Apple-linked copy.
  - Web page (`admin_portal` public route): the section outline (in-app steps, email request route
    via `contact@rhemapod.com`, deleted/retained, manual Apple revoke).
- **Files / scope:** notes go in the status entry. Mockups go under `docs/design_mobile_app/` /
  `docs/design_admin_portal/` only if the repo convention calls for them.
- **Verification:** every §A.2 error has a UI state, and no new primitive is added without a
  second use.
- **Commit:** `docs(design): account deletion flow` (only if files are added).
- **Status update:** `## ACCOUNT-DELETION — D3 UX`

### [HUMAN_GATE AD1] — ADR 0020 and public API contract
Isaac reviews ADR 0020 and §A.2 (route, body union, `UserPublic` fields, error table including the
422 call). On approval, scribe flips ADR 0020 to **Accepted** in one commit
(`docs(adr): accept ADR 0020`). **No implementation step runs before this gate.**

## Phase 1 — Apple seam and secrets (stub only)

### D4 — Apple revocation seam
- **Owner agent:** senior-dev-backend
- **What:** Implement `app/core/apple_revocation.py` per §A.4: the Protocol, the error type,
  `HttpAppleRevocationClient` (constructor takes team id, key id, key, client id and an optional
  `httpx` transport for tests), the `client_secret` minting, and `StubAppleRevocationClient`. No
  settings wiring yet (that's D5).
- **Files / scope:** `app/core/apple_revocation.py`, `tests/test_apple_revocation.py`.
- **Verification:**
  - One `MockTransport` case each for: success; exchange `invalid_grant` → `invalid_grant`;
    revoke 5xx twice → `unavailable` with exactly 2 revoke calls; revoke 5xx then 200 → success;
    network error and timeout → `unavailable` with 0 exchange retries; already-revoked 200 →
    success; `invalid_client` → `misconfigured`.
  - Requests go only to `appleid.apple.com`.
  - The `client_secret` JWT verifies with the test public key and has the right
    header/claims/`exp` ≤ 5 min.
  - The stub records calls and replays its scripted failures.
  - `uv run pytest -q --tb=short tests/test_apple_revocation.py` is green, and so is the full
    suite.
- **Commit:** `feat(auth): add Apple token revocation seam with HTTP and stub clients`
- **Status update:** `## ACCOUNT-DELETION — D4 Apple revocation seam`

### D5 — Settings, startup resolution, preflight, log redaction
- **Owner agent:** senior-dev-backend
- **What:**
  - Add the §A.5 settings.
  - Add `get_apple_revocation_client()`, resolved at startup and injected as a dependency.
  - Add the preflight rules.
  - Add the structlog redaction processor.
  - Add placeholders to `.env.example` and `.env.docker.example`.
  - No real key anywhere. Tests generate an ephemeral P-256 key.
- **Files / scope:** `app/core/config.py`, `app/core/apple_revocation.py`,
  `app/core/logging.py`, `app/scripts/preflight.py` (if it enumerates checks),
  `.env.example`, `.env.docker.example`, `tests/test_apple_revocation.py`,
  `tests/test_preflight*.py` (extend the existing one).
- **Verification:**
  - Preflight with `oauth_apple_enabled` refuses stub, missing key id, missing key, an RSA PEM and
    garbage, and passes with an ephemeral P-256 key. No network call happens (the transport
    asserts it was never used).
  - The redaction test: logging each sensitive key (nested too) emits `"[REDACTED]"`.
  - The default dev boot resolves the stub with a `live=False` warning, the same as storage.
  - The full suite is green.
- **Commit:** `feat(config): Apple revocation settings, preflight and secret-key log redaction`
- **Status update:** `## ACCOUNT-DELETION — D5 config + preflight + redaction`

### D6 — Apple key runbook
- **Owner agent:** scribe
- **What:** Add a `DEPLOYMENT.md` section covering:
  - creating the `.p8` (Sign in with Apple capability only, primary App ID `com.niitech.rhemapod`,
    team `FAND2W5VMM`);
  - local placement (`.env` / override, PEM contents);
  - the Secrets Manager secret name and JSON shape;
  - preflight behaviour;
  - rotation (create new key → deploy with new id/key → verify → revoke old key; Apple allows
    overlap);
  - "never commit, never log".
- **Files / scope:** `DEPLOYMENT.md` only.
- **Verification:** each §A.5 setting is documented, and the runbook steps are executable as
  written.
- **Commit:** `docs(deploy): Apple revocation key provisioning and rotation runbook`
- **Status update:** `## ACCOUNT-DELETION — D6 key runbook`

### [HUMAN_GATE AD2] — Secrets
Isaac reviews the D5 diff and the D6 runbook, then does these himself:
- creates the `.p8` per the runbook;
- places it in his local gitignored `.env` / override;
- approves the Secrets Manager secret name and shape.

Creating the deployed secret waits for the clients plan's AD5. The backend stays on
`APPLE_REVOCATION_BACKEND=stub` until the clients plan's AD3.

## Phase 2 — Deletion backend

### D7 — Per-route limiter fail mode
- **Owner agent:** senior-dev-backend
- **What:** Give `check_rate_limit` a keyword `fail_open: bool = True`. Default behaviour is
  byte-for-byte unchanged. With `fail_open=False`, Redis failure raises `RateLimitUnavailable`
  (typed, in `app/core/rate_limit.py`), which the delete router maps to 503. No call site other
  than the new route passes `False`.
- **Files / scope:** `app/core/rate_limit.py`, `tests/test_rate_limit_fail_mode.py`.
- **Verification:**
  - With `FakeRedis.failing()`, `fail_open=False` raises.
  - With `FakeRedis.failing()`, `/auth/login`, `/auth/oauth/google` and `/auth/oauth/apple` still
    behave as today (limiter allows, and downstream behaviour is unchanged). This is asserted
    explicitly.
  - The full suite is green.
- **Commit:** `feat(rate-limit): per-call fail mode, default fail-open unchanged`
- **Status update:** `## ACCOUNT-DELETION — D7 limiter fail mode`

### D8 — Shared `_erase_user`, viewer pseudonymization, CWE-532 fix
- **Owner agent:** senior-dev-backend
- **What:**
  - Extract `_erase_user(db, target, actor, ctx, details)` from `auth_service.delete_user`. It
    takes the snapshot, pseudonymizes if the target is a viewer, writes the audit row
    (email-free for viewers), deletes, commits, and runs the post-commit best-effort work (§A.3
    steps 8–10).
  - Admin `delete_user` keeps its authz, its deactivated-first precondition and its RESTRICT 409,
    and now calls `_erase_user`. This means the admin path also deletes avatar and cover objects
    and sends no notice email. **Planner call:** the admin path's notice email is out of scope; it
    can be added later.
  - Fix L912 to log `user_id` only.
  - Add the kitchen-sink viewer fixture and the FK classification meta-test.
- **Files / scope:** `app/services/auth_service.py`, the shared fixture module (`tests/`, next
  to `comments_pg.py` or a new `tests/kitchen_sink.py`), `tests/test_user_fk_classification.py`,
  `tests/test_admin_delete_user.py`.
- **Verification** (on `pg_client`):
  - An admin deleting a kitchen-sink viewer removes all linked rows. The viewer's prior audit rows
    have NULL `actor_email` / `target_label`, and the new row has no email.
  - Admin deleting a **staff** user leaves the staff audit rows' emails intact.
  - `_SpyStorage` sees `delete_object` for the avatar and every cover key. The cases covered:
    storage raising (logs `orphaned_object`, still 204), key missing, key NULL.
  - With `FakeRedis.failing()`, revocation is deferred and logged, as today.
  - caplog shows no email in `user_deleted`.
  - The meta-test fails when a dummy `users` FK is added unclassified (proven once, then removed).
  - The existing admin delete tests pass unchanged, except the email-label assertion for viewers
    (called out in the status entry).
- **Commit:** `refactor(auth): extract _erase_user; pseudonymize viewer audit rows; stop logging deleted user email`
  (or split into `refactor:` + `fix:` if the diff reads better).
- **Status update:** `## ACCOUNT-DELETION — D8 shared erasure`

### D9 — `delete_own_account` and `POST /auth/me/delete`
- **Owner agent:** senior-dev-backend
- **What:**
  - Add the `AccountDeletionRequest` union and the `UserPublic.has_password` / `linked_providers`
    fields (populated wherever `UserPublic` is built).
  - Add `auth_service.delete_own_account` (or a new `account_deletion_service.py` if
    `auth_service` passes ~1,000 lines; executor's call, logged).
  - Add the router in `app/api/auth.py` with the full §A.3 sequence, both limiters, the `iat`
    window, and the §A.2 error mapping.
- **Files / scope:** `app/models/schemas.py`, `app/services/auth_service.py` (or the new service
  module), `app/api/auth.py`, `tests/test_account_deletion.py`,
  `tests/test_account_deletion_pg_migrated.py`.
- **Verification** (all on `pg_client` + stub client + `FakeRedis`, per the D2 matrix):
  - The happy path for each method: password, Google, Apple, and Apple-linked + password +
    flag (audit `apple_revoked: false`, `apple_skip_reason: "apple_unavailable"`).
  - Every §A.2 status, including a stolen access token with no proof (422/403), wrong password →
    403 (not 401), `sub` mismatch, replayed identity token, replayed code, stale `iat`, an
    unsatisfiable proof type, the staff 403 parametrised over every staff role, RESTRICT 409
    (demoted ex-staff with an authored sermon), and an `IntegrityError` backstop → 409.
  - The ordering pin: on stub `invalid_grant` / `unavailable`, every row is still present and the
    status is 400 / 503.
  - Rate limiting:
    - the 6th attempt within an hour → 429 from the per-user limiter, even when the requests come
      from different client IPs;
    - a password attempt on delete increments `login:{client_ip}:{email}`;
    - with `FakeRedis.failing()`, delete returns 503 while login still works.
  - After 204: the access token gets 401 on `/auth/me`, refresh fails, the notice email was sent
    after commit, and SMTP raising still gives 204 with the rows gone.
  - Idempotency: a sequential repeat gets 401. Concurrent `gather` gives {204, 401/409} with
    exactly one `USER_DELETED` row and no 500.
  - The `pg_migrated_db` full-erasure run passes.
  - The full suite is green.
- **Commit:** `feat(auth): self-service account deletion endpoint with Apple revocation`
- **Status update:** `## ACCOUNT-DELETION — D9 delete endpoint`

### D10 — Regenerate the contract
- **Owner agent:** noob-dev
- **What:** `uv run python -m app.scripts.dump_openapi`, then `npm run gen:api` in `admin_portal/`
  and `mobile/`.
- **Files / scope:** `openapi.json`, `admin_portal/lib/api/schema.d.ts`,
  `mobile/lib/api/schema.d.ts`.
- **Verification:** the diff contains only the new route, `AccountDeletionRequest` variants and
  the two `UserPublic` fields. Portal `npm run verify` and mobile `npx tsc --noEmit` are green.
- **Commit:** `chore(api): regenerate OpenAPI and client types for account deletion`
- **Status update:** `## ACCOUNT-DELETION — D10 contract regen`

### D11 — Backend review (end of this plan)
- **Owner agent:** reviewer-gilfoyle, then security-reviewer
- **What:**
  - Gilfoyle reviews D4–D9 for correctness, layering (api → services → models, seam behind
    `app/core`) and exception discipline.
  - Security-reviewer covers:
    - the re-auth bypass surface (proof/account mismatch, replay, `iat`, nonce);
    - the generic 403 (no account-state oracle);
    - `client_secret` handling and redaction;
    - host pinning to `appleid.apple.com`;
    - the fail-closed per-user limiter, and the IP-rotation exposure of the shared login key;
    - email leakage in logs, audit and errors;
    - the ordering guarantees;
    - the concurrent double-submit.
- **Files / scope:** read-only.
- **Verification:** no blocking findings, or the findings are fixed in follow-up commits on this
  branch and re-verified. Every DoD bullet of this plan is checked. The full suite is green.
- **Commit:** fixes only (`fix(auth): …`).
- **Status update:** `## ACCOUNT-DELETION — D11 backend review (backend plan complete)`

D11 passing completes this plan and satisfies the precondition of
`plans/plan-account-deletion-clients.md`. There's no separate gate here: Isaac's next stop is the
clients plan's AD3. The Conductor reports the D11 result to him when dispatching D12.

---

## Rollback

- **Mid-plan:** abandon or reset `feat/account-deletion`. `dev` and `feat/apple-sign-in` are
  untouched.
- **No migration**, so there's nothing to downgrade. The `UserPublic` fields are additive.
- **Per-step failure:** the executor halts and logs `HALTED: <reason>`. Each step is its own
  conventional commit, so it can be reverted alone. D8 is a refactor of the admin path: reverting
  it requires reverting D9 first. D10 must be re-run after any revert touching the contract.
- Post-merge rollback and the dev kill switch are in the clients plan.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| K1 | Re-auth bypass: proof for one account accepted for another | `sub` = linked `provider_subject`, claim-once, `iat`, nonce; D9 negatives; D11 security review |
| K2 | Data deleted but Apple grant left live | Revoke strictly before the transaction; ordering pin test (D9); `apple_revoked` true only on a 200 |
| K3 | Single-use code burned by a retry | Exchange is never retried (D4 test asserts 0 retries) |
| K4 | `.p8` or `client_secret` leaks via logs or the repo | Redaction processor (D5), gitignore verified (§A.5), D11 review |
| K5 | Limiter change regresses login availability | `fail_open` defaults to True; explicit login/OAuth regression tests (D7) |
| K6 | A new FK to `users` silently breaks deletion later | FK classification meta-test (D8) |
| K7 | Password guessing via IP rotation (the login key is per IP + email) | The per-user delete limiter (5/hour, fail closed) is the per-account cap; D9 test from multiple IPs |
| K8 | Orphaned objects in R2 | Snapshot before delete; `orphaned_object` log for sweep; spy tests (D8) |
