# Plan: Self-service account deletion + Apple token revocation — clients, live verification, merge

**Part 2 of 2.** This plan covers steps D12–D16 and gates AD3–AD5. The binding design sections
(§A.1–§A.8: decisions, contract, behaviour, Apple seam, config/secrets, anchors, resolved inputs,
branch/merge) live in **`plans/plan-account-deletion-backend.md`**. They're referenced here as
"backend §A.x" and not duplicated. Changing any of them is a plan amendment.

Execution log: the append-only root `status.md`. It uses the same heading/line format and the
`ACCOUNT-DELETION` prefix as the backend plan. Step ids continue from it.

Branch: `feat/account-deletion`, continuing from the backend plan. Merge at `[HUMAN_GATE AD4]`
per backend §A.8.

Executors halt **only** at gates, and follow the backend plan's halt rules. No schema change is
expected. If one appears, it's a new gate. Halt.

---

## Preconditions

- **`plans/plan-account-deletion-backend.md` is complete:** D11 has passed with no open blocking
  findings, and its Definition of Done is fully checked in `status.md`. The Conductor verifies
  this before dispatching D12. If it isn't complete, nothing here runs.
- `[HUMAN_GATE AD0]`–`[HUMAN_GATE AD2]` are crossed. ADR 0020 is Accepted.
- The regenerated `mobile/lib/api/schema.d.ts` and `admin_portal/lib/api/schema.d.ts` (backend D10)
  are on the branch.
- The D3 UX notes and the D2 test matrix (backend plan) are in `status.md`. They're the inputs for
  D12/D13.

## Goal

A viewer can delete their account from the iOS app (Android paths built) against the real backend,
with Apple revocation proven on a device. Play users have a public web deletion page. The
supporting docs are updated, and the branch is merged into `dev`.

## Definition of Done

- [ ] Mobile: Me → Account → "Delete account" works end-to-end on iOS against a dev backend using a
      sandbox Apple ID. The Apple entry disappears from iOS Settings, and the next Apple sign-in is a
      first-time authorization (D15 checklist signed off by Isaac).
- [ ] Mobile handles every backend §A.2 status. A 403 never logs the user out. The fallback
      (`apple_unavailable: true`) is offered only after repeated 503s. A 204 wipes tokens, the
      Google session, the media cache and downloads, and per-user state.
- [ ] The web deletion page is live at `admin_portal/app/(public)/delete-account`, unauthenticated
      and static.
- [ ] The ADR 0018 addendum and ADR 0015 §6 pointer are written. ADR 0020 Consequences are updated.
      The privacy-policy disclosure text (30-day backups, 365-day pseudonymized audit, ≤90-day
      moderation snapshots) is delivered to Isaac. `plans/README.md` has a row covering both plan
      files.
- [ ] Backend `uv run pytest -q --tb=short`, portal `npm run verify`, mobile `npx tsc --noEmit` and
      `npx jest`, and `pre-commit run --all-files` are all green on the branch head.
- [ ] Merged into `dev` per backend §A.8.

---

## Phase 3 — Clients

### D12 — Mobile delete flow
- **Owner agent:** mobile-developer
- **What:** Implement backend D3:
  - the entry row in Me → Account;
  - Screen 1 (notice plus App Store / Play subscription deep links, always shown, because there's
    no IAP client — see backend §A.6);
  - Screen 2 with re-auth selection:
    - iOS + Apple linked → `expo-apple-authentication` with a fresh nonce, sending
      `identity_token`, `raw_nonce` and `authorization_code`;
    - else password;
    - else Google;
    - Android + Apple linked → password/Google + `apple_unavailable: true` + manual-revoke copy.
  - The 400 Apple → re-prompt; the 503 → retry copy, then the fallback offer after the second
    consecutive 503 (resubmits with a fresh non-Apple proof + `apple_unavailable: true`, and shows
    the manual-revoke copy).
  - On 204: clear secure-store tokens, `GoogleSignin.signOut()`, wipe the media cache and
    downloads (reuse the ADR 0014 sign-out wipe), clear per-user local and query state, and reset
    to `(auth)` with the deleted notice.
  - The client must not treat 403 from this route as a session failure. Confirm the 401
    interceptor isn't triggered.
- **Files / scope:**
  - `mobile/app/(tabs)/me.tsx` and `mobile/app/(tabs)/_me/*`
  - a new delete-account route/components
  - `mobile/lib/auth/appleSignIn.ts` (reuse; extend only if a nonce/code helper is missing)
  - an API hook in `mobile/lib/query/hooks/`
  - tests under `mobile/app/(tabs)/_me/__tests__/`
- **Verification:**
  - Jest covers re-auth selection for each `linked_providers` × platform combination; each
    status → UI state; the fallback offer only after repeated 503; 204 → every wipe function
    called and navigation reset; a 403 doesn't log the user out.
  - `npx tsc --noEmit` and `npx jest` are green.
  - The iOS simulator smoke against the dev backend on the **stub** client passes.
- **Commit:** `feat(mobile): in-app account deletion with Apple re-auth`
- **Status update:** `## ACCOUNT-DELETION — D12 mobile flow`

### D13 — Web deletion page
- **Owner agent:** senior-dev-frontend
- **What:** Build a static, unauthenticated `admin_portal/app/(public)/delete-account/page.tsx`
  with no data fetching, following the backend D3 outline:
  - in-app steps;
  - a `mailto:contact@rhemapod.com` request route (fulfilled by an admin via `delete_user`);
  - what is deleted and what is retained (backups ≤30 days, pseudonymized audit ≤365 days,
    moderation snapshots ≤90 days);
  - how Apple users revoke manually (iOS Settings → Apple ID → Sign in with Apple), since the admin
    path can't revoke.
- **Files / scope:** `admin_portal/app/(public)/delete-account/**` plus a Vitest render test.
- **Verification:** the page renders signed-out, isn't behind the portal auth middleware (test or
  middleware matcher check), and `npm run verify` is green.
- **Commit:** `feat(admin-portal): public account deletion page`
- **Status update:** `## ACCOUNT-DELETION — D13 web page`

## Phase 4 — Docs

### D14 — ADR addenda, privacy disclosure, plan index
- **Owner agent:** scribe
- **What:**
  - **ADR 0018 addendum:** audit_log is append-only *except* erasure of a deleted viewer's
    identifiers (`actor_email`, `target_label`), with staff rows untouched.
  - **ADR 0015 §6:** a one-line pointer from the deferred-revocation bullet (L195) to ADR 0020.
  - **ADR 0020 Consequences:** record the implementation notes that backend D8/D9 logged, with
    no contract change.
  - **Privacy-policy disclosure text** for Isaac to paste into his hosted policy, covering:
    - what deletion removes;
    - moderation snapshots kept ≤90 days;
    - backups kept ≤30 days;
    - pseudonymized audit rows kept ≤365 days;
    - Apple revocation;
    - how to revoke manually;
    - the web request route (the D13 URL).
  - **`plans/README.md`:** add **one** row for the initiative that names both
    `plan-account-deletion-backend.md` and `plan-account-deletion-clients.md` (gates AD0–AD5),
    with outcome "in progress" until AD4.
- **Files / scope:** `docs/adr/0018-system-audit-log.md`, `docs/adr/0015-social-sign-in.md`,
  `docs/adr/0020-self-service-account-deletion.md`, `plans/README.md`. The privacy text goes in
  the status entry, not the repo.
- **Verification:** the retention numbers match backend §A.7 (30 / 365 / 90), and no edit goes
  beyond these sections.
- **Commit:** `docs(adr): ADR 0018 erasure addendum, ADR 0015 pointer, plan index`
- **Status update:** `## ACCOUNT-DELETION — D14 docs + privacy text`

## Phase 5 — Live verification and close-out

### [HUMAN_GATE AD3] — First real Apple call (dev, sandbox Apple ID)
This gate sits here, not in the backend plan, because the first real `/auth/token` → `/auth/revoke`
call needs a fresh, single-use `authorization_code`. That code only comes from a device-side Apple
re-auth, which means D12. The alternative would be a throwaway harness, which is out of scope.

Preconditions: D12 green on the stub, and the AD2 key in the local env. Isaac approves switching
the **dev** backend to `APPLE_REVOCATION_BACKEND=http` with that key, using a dedicated sandbox
Apple ID: never his primary, never prod.

### D15 — On-device verification
- **Owner agent:** qa-strategist. Isaac executes on the device; mobile-developer is on call for
  fixes.
- **What:** Write and run the checklist:
  1. Sign in with Apple on a fresh install. The app appears in iOS Settings → Apple ID → Sign in
     with Apple.
  2. Delete in-app. The entry disappears, the DB rows and objects are gone, and the audit row has
     `apple_revoked: true`.
  3. Signing in again is a first-time authorization (the name/email sheet shows).
  4. The negative paths:
     - cancel at the Apple sheet (nothing deleted);
     - airplane mode (503, nothing deleted);
     - a stale code reused (400);
     - a wrong key id in dev env (`misconfigured` → 503, nothing deleted).
  5. The fallback: after repeated 503s, delete with password + `apple_unavailable`. The audit row
     has `apple_revoked: false` and `apple_skip_reason: "apple_unavailable"`, and the
     manual-revoke copy is shown.
  6. Delete the password-based App Review demo account via the password path.
- **Files / scope:** none. Results go in the status entry.
- **Verification:** every item is passed and signed off by Isaac in chat. A failure → fix
  commit(s) under the owning step's scope, then re-run.
- **Commit:** fixes only.
- **Status update:** `## ACCOUNT-DELETION — D15 on-device verification`

### D16 — Final review
- **Owner agent:** reviewer-gilfoyle, then security-reviewer, then qa-strategist
- **What:**
  - Gilfoyle reviews the client diff (D12, D13).
  - Security-reviewer covers the full branch, focused on the token handling path end to end
    (device → backend → Apple), redaction in real dev logs from D15, and the web page (no data
    exposure).
  - Qa-strategist runs a coverage-gap assessment against the backend D2 matrix.
- **Files / scope:** read-only.
- **Verification:** no blocking findings. Backend suite, portal `npm run verify`, mobile tsc +
  jest and `pre-commit run --all-files` are green on the branch head.
- **Commit:** fixes only.
- **Status update:** `## ACCOUNT-DELETION — D16 final review`

### [HUMAN_GATE AD4] — Merge
Isaac reviews the branch and the D11/D15/D16 results. The merge then follows backend §A.8: first
`feat/apple-sign-in`, then `feat/account-deletion` into `dev`. No PR. Push to origin after each
merge. `plans/README.md` outcome is updated to shipped in the merge follow-up.

### [HUMAN_GATE AD5] — First enablement beyond dev (irreversible)
This is after the merge and outside executor scope. Before any non-dev environment runs with
`oauth_apple_enabled` and the HTTP client, or before an App Store submission that relies on it,
Isaac:
- creates the Secrets Manager entry (backend §A.5);
- confirms preflight passes in that environment;
- publishes the privacy text and enters the D13 page URL in Play Console;
- approves.

Deletions there are real and unrecoverable.

---

## Rollback

- **Before AD4:** reset `feat/account-deletion` to the backend plan's D11 head (clients work
  only), or abandon the branch. `dev` and `feat/apple-sign-in` are untouched.
- **After AD4:** `git revert -m 1 <merge sha>` on `dev`. There is no migration, so there's nothing
  to downgrade. The `UserPublic` fields are additive, so older clients are unaffected.
- **Kill switch without a revert:** set `APPLE_REVOCATION_BACKEND=stub` in dev only. Prod preflight
  forbids it, so in prod the switch is a revert. Deletions already performed **cannot be rolled
  back** except from backups (30 days), which is why AD5 exists.
- **Per-step failure:** the executor halts and logs `HALTED: <reason>`. Each step is its own
  conventional commit, so it can be reverted alone.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| C1 | Mobile 401 interceptor logs the user out on a wrong password | Wrong password is 403 by contract; D12 test |
| C2 | Users skip Apple revocation via the fallback when Apple was actually reachable | Offered only after repeated 503s or on Android; manual-revoke copy is always shown; audited as `apple_unavailable` |
| C3 | First live Apple call mis-handles real responses that MockTransport didn't model | AD3 is in dev with a sandbox ID; D15 negative paths; nothing is deleted on any non-200 |
| C4 | App Review can't find deletion | Entry ≤2 taps from Me (D3/D12); demo account path tested in D15 |
| C5 | Web page drifts from the actual retention numbers | D13/D14 both pinned to backend §A.7 (30 / 365 / 90) |
