# Plan: Android Google sign-in via one-time server auth code

On Android, `@react-native-google-signin/google-signin` 16.1.5 returns Play Services' cached Google
ID token for its ~1h lifetime, even after `revokeAccess()`. The backend's single-use replay guard
(`_claim_oauth_token_once`, ADR 0015) then rejects it as `replayed`. The effects:

- Android Google sign-in fails on any re-sign-in within the hour.
- Google re-auth for account deletion on Android is broken (`iat` ≤ 300 s plus claim-once,
  ADR 0020).
- iOS works.

Two client-side workarounds didn't fix it: 6b8ee1e (pre-sign-in revoke) and 0b0421a (revoke after
use). The evidence is in `status.md` under "Android Google sign-in — decision (Isaac, chat)
2026-11-01".

**Isaac's decision (2026-11-01):** Android sends a one-time server auth code. The backend exchanges
it at Google's token endpoint for a freshly minted ID token, then verifies and claims that token
exactly as today. iOS keeps sending the ID token.

Execution is logged in the append-only root `status.md`, one `## GOOGLE-AUTH-CODE — <step> <agent: …>
<date>` heading per step. Executors halt **only** at gates. If something diverges from this plan,
they halt and the Conductor decides whether to amend. There is **no schema change**. If one shows
up, it's a new gate: halt.

---

## Goal

A user can sign in with Google on Android any number of times, at any interval (including straight
after sign-out or a cold restart). They can also re-auth with Google to delete their account on
Android. iOS behaviour and the ID-token contract stay unchanged.

## Definition of Done

- [ ] `POST /auth/oauth/google` and the `method: "google"` deletion proof on `POST /auth/me/delete`
      each accept **exactly one** of `id_token` | `server_auth_code` (422 otherwise). The
      `id_token`-only request is byte-for-byte backward compatible.
- [ ] A code is exchanged server-side at `https://oauth2.googleapis.com/token` and the returned
      `id_token` goes through the unchanged path: `verify_google_id_token` (JWKS, aud, iss, exp),
      then `iat` freshness for deletion, then `_claim_oauth_token_once`. Google access/refresh
      tokens are never persisted, never logged, never returned.
- [ ] Error mapping (§D.3) is covered by tests. `invalid_grant` gives the same 401 "Invalid or
      expired sign-in token" at sign-in, and the generic 403 in the deletion path, as today.
      Network failures and Google 5xx give 503 "Sign-in temporarily unavailable".
- [ ] `GOOGLE_OAUTH_CLIENT_SECRET` is a `SecretStr`, redacted in logs, never committed. The start
      preflight refuses to boot when `OAUTH_GOOGLE_AUTH_CODE_ENABLED=true` and the secret is unset.
      This applies on Render dev as well as production.
- [ ] Android sends `server_auth_code` for sign-in, register and deletion. iOS sends `id_token`.
      The revoke workarounds are removed from the sign-in path (§D.5).
- [ ] ADR 0015 addendum and ADR 0020 note are Accepted (`[HUMAN_GATE GC3]`).
- [ ] The on-device checklist (§D.6) passes on a new android-internal APK and a TestFlight build
      (`[HUMAN_GATE GC4]`).
- [ ] Green on the branch head:
      - backend `uv run pytest -q --tb=short` (with the env-blanking prefix)
      - mobile `npx tsc --noEmit && npx jest`
      - portal `npm run verify` (types regen only)
      - `pre-commit run --all-files`

## Constraints / Assumptions

- **Branch and merges.**
  - Trunk is `dev`. Branch `fix/android-google-auth-code` off `dev`.
  - No PRs. Conventional commits. Push after each commit.
  - Merging into `dev` deploys Render dev, and `scripts/render-start.sh` runs
    `python -m app.scripts.preflight` on every start. **The secret must be on Render before the
    merge, or the API refuses to boot** (that's why GC2 comes before GC3).
- **No new dependencies.** `httpx` is already used by `HttpJwksProvider`. Mobile already has the
  library, and `offlineAccess` is a configure option. If any step thinks it needs a dependency,
  halt.
- **Tests:** real Postgres via Testcontainers, with no mocked session. Google's token endpoint is
  faked with `httpx.MockTransport`, using the same injection pattern as `tests/test_oauth_jwks.py`.
  Backend command:
  `OBJECT_STORE_ACCESS_KEY_ID= OBJECT_STORE_SECRET_ACCESS_KEY= ARCHIVE_STORE_ACCESS_KEY_ID= ARCHIVE_STORE_SECRET_ACCESS_KEY= uv run pytest -q --tb=short`
- **Mobile is CNG with no OTA.** Every JS change ships only in a new binary, and both platforms
  change (§D.5), so both need builds.
- **Library facts, verified 2026-11-01 in `node_modules`, v16.1.5:**
  - `ConfigureParams.offlineAccess` requires `webClientId`, and JS throws otherwise
    (`GoogleSignin.ts:24`).
  - Android maps it to `GoogleSignInOptions.requestServerAuthCode(webClientId,
    forceCodeForRefreshToken)` (`Utils.java:67-68`).
  - `User.serverAuthCode: string | null` is non-null only with a valid `webClientId` and
    `offlineAccess: true` (`types.ts:121-124`).
  - `forceCodeForRefreshToken` is Android-only and stays `false`.
  - The Android side is the **legacy** Google Sign-In API, which Google marks "outdated and no
    longer supported" (see Risks).
- **Google facts, verified 2026-11-01:**
  - Token exchange is `POST https://oauth2.googleapis.com/token` (form-encoded) with `code`,
    `client_id`, `client_secret`, `grant_type=authorization_code` and `redirect_uri`.
  - For an Android server auth code with no web redirect flow, `redirect_uri` is the **empty
    string** (developer.android.com/identity/legacy/gsi/offline-access).
  - The response carries `id_token` when identity scopes were granted.
  - A `refresh_token` comes back only on the **first** exchange for a user/client. Later codes
    yield only an access token.
  - Failures return 400 with an `error` field, e.g. `invalid_grant`.
- **The web client is `827558560538-jfpd1k7eq6bej6q481ohb2co70t56h9r`.** It is already in
  `GOOGLE_OAUTH_CLIENT_IDS`, so the exchanged token's `aud` passes today's check unchanged.
- **Not in scope:**
  - moving iOS to auth codes;
  - migrating Android off legacy GSI (Credential Manager);
  - storing or using Google API access;
  - any change to Apple.

---

## Design (binding)

### D.1 Contract (public API — `[HUMAN_GATE GC1]`)
- `GoogleSignInRequest`:
  - `id_token: str | None` (1–4096 chars);
  - `server_auth_code: str | None` (1–2048 chars);
  - a `model_validator` requires exactly one. A violation returns a 422 that names both fields.
- `GoogleDeletionRequest` gets the same pair and the same validator. `method: "google"` and
  `apple_unavailable` are unchanged.
- **Chosen: extend the existing payloads, not a new endpoint.** One route, one rate-limit key
  (`oauth:google:{client}`), one error table, and an additive change for existing clients. A
  separate `/auth/oauth/google/code` route would duplicate rate limiting, audit wiring and the
  deletion union for no gain.
- Response shapes and error details are unchanged.

### D.2 Backend exchange (`app/core/oauth.py`)
- **Function:** `exchange_google_server_auth_code(code: str) -> str` returns the raw `id_token`.
  Callers then run `verify_google_id_token(id_token)` and `_claim_oauth_token_once(id_token)`
  exactly as the ID-token path does. Deletion adds its `iat` and subject checks in between. The
  exchanged token's `iat` is the exchange time, so the 300 s window holds.
- **Request:**
  - A `httpx.AsyncClient(timeout=10, follow_redirects=False)` sends a form POST to the
    module-constant URL `https://oauth2.googleapis.com/token`. The URL is never config-driven
    (host pinned).
  - `client_id` is the web client id from the new setting `GOOGLE_OAUTH_WEB_CLIENT_ID`. Preflight
    requires it to be a member of `GOOGLE_OAUTH_CLIENT_IDS`.
  - `client_secret` is `GOOGLE_OAUTH_CLIENT_SECRET.get_secret_value()` and `redirect_uri` is `""`.
- **What's kept:** only `id_token` is read from the response. `access_token`/`refresh_token` are
  dropped on the floor.
- **No server-side revoke.**
  - The grant covers only `openid email profile`.
  - The refresh token lives only in one request's memory.
  - Revoking the grant would bring back the consent and account picker on every sign-in, which is
    the UX we're removing.
  - Account deletion already revokes the grant client-side (`finishAccountDeletion` →
    `forgetGoogleAccount`, kept, §D.5).
  - The user can also revoke at myaccount.google.com.
- **No stub backend.** A stub that mints identities would be an auth bypass. Dev and test without
  the secret simply have the code path off (§D.4). Tests inject `httpx.MockTransport`.
- **Log redaction:** add `server_auth_code`, `google_oauth_client_secret` and `client_secret` to
  the key set in `app/core/logging.py`. Exchange logs carry only Google's `error` code and the
  HTTP status, never the body.

### D.3 Error mapping (reuses `OAuthTokenError` reasons → existing tables)
| Google outcome | reason | Sign-in | Deletion |
|---|---|---|---|
| 400 `invalid_grant` (bad, expired or reused code) | `invalid` | 401 "Invalid or expired sign-in token" | 403 generic re-auth message |
| 400 `invalid_client` / `unauthorized_client` / `redirect_uri_mismatch` / other 4xx | `unavailable` + `log.error` (our misconfig, not the user's) | 503 | 503 |
| 5xx, timeout, connect error, redirect, non-JSON, 200 without `id_token` | `unavailable` | 503 | 503 |
| `id_token` fails verification | as today (`invalid` / `audience_mismatch`) | as today | 403 |
| code path disabled (§D.4) | `unavailable` | 503 | 503 |

### D.4 Config and preflight
- **New settings:**
  - `oauth_google_auth_code_enabled: bool = False`;
  - `google_oauth_web_client_id: str | None`;
  - `google_oauth_client_secret: SecretStr | None`.
- **Problems check:** a shared `_google_auth_code_problems()` returns problems when the flag is
  true and either value is missing, or when the web client id is not in
  `GOOGLE_OAUTH_CLIENT_IDS`. Config only, no network.
  - `production_preflight` calls it.
  - A new `_check_google_auth_code` in `app/scripts/preflight.py` calls it in **every**
    environment, mirroring `_check_apple_revocation`, so Render dev (`ENVIRONMENT=development`)
    also refuses to boot.
- **`render.yaml`:**
  - `OAUTH_GOOGLE_AUTH_CODE_ENABLED: "true"`;
  - `GOOGLE_OAUTH_WEB_CLIENT_ID: 827558560538-jfpd1k7eq6bej6q481ohb2co70t56h9r.apps.googleusercontent.com` (an identifier,
    not a secret);
  - `GOOGLE_OAUTH_CLIENT_SECRET` with `sync: false`.
- **`.env.example`:** placeholders only, with the flag left false.

### D.5 Mobile (`mobile/lib/auth/googleSignIn.ts` + callers)
- **`configureGoogleSignIn`:** on `Platform.OS === 'android'` it adds `offlineAccess: true,
  forceCodeForRefreshToken: false`. iOS config is unchanged.
- **`performGoogleSignIn` return type:** returns `GoogleCredential | null`, where `GoogleCredential
  = { kind: 'id_token'; idToken } | { kind: 'server_auth_code'; code }`.
  - Android reads `response.data.serverAuthCode`. If it's null, it throws, like the existing
    missing-idToken error.
  - iOS reads `idToken`.
- **Callers:** `authClient.oauthGoogle` and `session.signInWithGoogle` take the credential and send
  `{ id_token }` or `{ server_auth_code }`. The callers are `sign-in.tsx`, `register.tsx` and
  `delete-account.tsx` (`buildBody`).
- **Workarounds — recommendation:**
  - **Revert 0b0421a (revoke after use): required.** Revoking the grant before the server
    exchanges the code risks Google invalidating the code (`invalid_grant`). It also forces the
    picker every time.
  - **Remove the pre-sign-in `dropGoogleGrant()` call from `performGoogleSignIn` (6b8ee1e).** It
    revokes the grant, which forces re-consent on every Android sign-in now that offline access
    is requested. It isn't needed, because codes are single-use by Google's design.
  - **Keep `forgetGoogleAccount`, but split it:**
    - our sign-out calls `GoogleSignin.signOut()` only, so the picker shows next time and
      account switching works;
    - `finishAccountDeletion` keeps the restore → `revokeAccess` → `signOut` sequence (grant
      cleanup for a departing user).
  - These changes apply to both platforms, because iOS worked before either workaround. iOS
    regression is checked in §D.6.

### D.6 On-device checklist (APK + TestFlight; qa-strategist may add lines in S5)
1. Android: fresh install → Google sign-in → signed in.
2. Android: sign out → Google sign-in **immediately** (< 1 min) → signed in. This is the
   regression that motivated the plan.
3. Android: force-stop, cold start, sign out → Google sign-in → signed in. Repeat 3 times within
   10 minutes.
4. Android: register screen → Google → signed in. Record whether a consent screen appears, and
   its wording (open question 1).
5. Android: Google-linked account → Delete account → Google re-auth → 204 → signed out. Next
   Google sign-in creates a new account.
6. Android: Render logs show the exchange succeeded, with no `reason=replayed`, no
   `redirect_uri_mismatch` and no code or secret in the log lines.
7. iOS: steps 1, 2 and 5 pass on TestFlight. The Apple sign-in smoke still passes.

---

## [HUMAN_GATE GC0] — Plan approval
Isaac approves this plan, including §D.1 (extend payloads), §D.2 (no server-side revoke) and §D.5
(workaround recommendation). He answers the open questions or defers them.

## Steps

### S1 — ADR 0015 addendum + ADR 0020 note (Proposed)
- **Owner agent:** scribe
- **What:**
  - **ADR 0015** gets "Addendum 2026-11 — Android server auth code": the problem, the exchange,
    the contract (§D.1), the error mapping (§D.3), the no-revoke and no-stub rationale, the new
    config, and the legacy-GSI risk.
  - **ADR 0020** gets a note that the Google proof may be a `server_auth_code`. The freshness
    (`iat` of the exchanged token) and claim-once rules are unchanged.
  - **`DEPLOYMENT-RENDER.md`:** the new env vars and the secret-before-merge rule.
- **Files / scope:** `docs/adr/0015-social-sign-in.md`, `docs/adr/0020-self-service-account-deletion.md`,
  `DEPLOYMENT-RENDER.md`
- **Verification:** `pre-commit run --files <changed>` is green.
- **Commit:** `docs(adr): ADR 0015 addendum — Android Google server auth code`
- **Status update:** `[S1] <files>`

### S2 — Backend: config, exchange, contract, preflight, tests
- **Owner agent:** senior-dev-backend
- **What:** Implement §D.1–§D.4 (schemas, exchange function, both route paths, settings, both
  preflight hooks, redaction keys, `render.yaml`, `.env.example`).
- **Tests:** `tests/test_oauth_auth_code.py` (new) and additions to `tests/test_account_deletion.py`
  and `tests/test_preflight_google.py` (new). Real Postgres, with a MockTransport for Google.
  - **Request shape:** the MockTransport asserts the exact URL, form params (including
    `redirect_uri=""` and the web client id) and the absence of redirect following.
  - **Sign-in:** a code creates a user / returns the same user.
  - **Errors:** each §D.3 row is covered.
  - **Replay:** the mock returns the same `id_token` twice, and the second call gets 401.
  - **Validation:** both fields or neither gives 422. `id_token`-only regression passes (the
    existing suites unchanged).
  - **Deletion:** a code proof gives 204 and erasure. A stale-`iat` exchanged token gives 403, a
    subject mismatch gives 403, `invalid_grant` gives 403, and unavailable gives 503.
  - **Flag:** flag off gives 503.
  - **Preflight:** problems are reported for a missing secret, a missing web id, and a web id not
    in the list, in development as well as production.
  - **Logs:** captured output contains neither the secret, the code nor the refresh/access tokens
    from the mock response.
- **Files / scope:** `app/core/oauth.py`, `app/core/config.py`, `app/core/logging.py`,
  `app/api/auth.py`, `app/models/schemas.py`, `app/scripts/preflight.py`, `render.yaml`,
  `.env.example`, `tests/test_oauth_auth_code.py`, `tests/test_preflight_google.py`,
  `tests/test_account_deletion.py`
- **Verification:** the full backend suite is green with the env-blanking prefix, and pre-commit
  is green.
- **Commit:** `feat(auth): accept Google server auth code and exchange it server-side`
- **Status update:** `[S2] <files, test counts>`

### S3 — OpenAPI dump + client types regen
- **Owner agent:** noob-dev
- **What:** Run `uv run python -m app.scripts.dump_openapi`. Then run `npm run gen:api` in
  `mobile/` and `admin_portal/`.
- **Files / scope:** `openapi.json`, `mobile/lib/api/schema.d.ts`, `admin_portal/lib/api/schema.d.ts`
- **Verification:**
  - The `openapi.json` diff touches only `GoogleSignInRequest` and `GoogleDeletionRequest`.
  - `tests/test_openapi_dump*` is green.
  - Portal `npm run verify` is green. Mobile `npx tsc --noEmit` is green, or shows only the
    expected `id_token` optionality errors, which are fixed in S4.
- **Commit:** `chore(api): regenerate OpenAPI and client types for Google auth code`
- **Status update:** `[S3] <diff summary>`

### [HUMAN_GATE GC1] — Public API contract
Isaac reviews the `openapi.json` diff against §D.1 and the S2 error-mapping tests.

### S4 — Mobile: Android auth-code path + workaround cleanup
- **Owner agent:** mobile-developer
- **What:** Implement §D.5.
- **Tests (jest):**
  - **Android:** configure gets `offlineAccess: true, forceCodeForRefreshToken: false` and
    `webClientId`. Sign-in returns a `server_auth_code` credential. **No `revokeAccess` or
    `signOut`** happens during sign-in. A null `serverAuthCode` throws.
  - **iOS:** configure has no `offlineAccess` and sign-in returns `id_token`.
  - **Request bodies:** `authClient` posts the right body per kind, and `delete-account` builds
    `{ method: 'google', server_auth_code }` on Android.
  - **Sign-out vs deletion:** sign-out calls only `signOut`. `finishAccountDeletion` calls revoke
    then `signOut`.
  - Existing sign-in, register, delete and AuthContext tests are updated.
- **Files / scope:** `mobile/lib/auth/googleSignIn.ts`, `mobile/lib/auth/session.ts`,
  `mobile/lib/auth/AuthContext.tsx`, `mobile/lib/api/authClient.ts`, `mobile/app/(auth)/sign-in.tsx`,
  `mobile/app/(auth)/register.tsx`, `mobile/app/delete-account.tsx`, related `__tests__/`
- **Verification:** `npx tsc --noEmit`, eslint and the full `npx jest` are green in `mobile/`.
- **Commit:** `fix(mobile): Android Google sign-in sends a one-time server auth code`
- **Status update:** `[S4] <files, test counts>`

### S5 — Reviews + fixes
- **Owner agent:** security-reviewer and reviewer-gilfoyle in parallel; qa-strategist finalises
  §D.6; fixes go to senior-dev-backend / mobile-developer.
- **What:**
  - **Security review:**
    - host pinning and redirect refusal;
    - secret handling (SecretStr, redaction, never in responses or errors);
    - the code never logged;
    - no token persistence;
    - error-oracle uniformity on deletion;
    - the rate limit still applies to code requests;
    - preflight coverage.
  - **Gilfoyle:** correctness and idiom of S2 and S4.
  - CRIT/HIGH and should-fix findings are fixed in this step. Deferrals are listed in `status.md`.
- **Files / scope:** as touched by the fixes
- **Verification:** both verdicts are approve or pass. Suites are re-run green after the fixes.
- **Commit:** `fix(auth): Google auth code review fixes` (only if there are changes)
- **Status update:** `[S5] <verdicts, fixes, deferrals, final checklist>`

### [HUMAN_GATE GC2] — Secret: GOOGLE_OAUTH_CLIENT_SECRET (Isaac only)
1. In Google Cloud Console, open the **web** client `827558560538-jfpd1k7eq6bej6q481ohb2co70t56h9r`
   and copy its client secret, or add a new secret.
2. Set it in local `.env` along with `OAUTH_GOOGLE_AUTH_CODE_ENABLED=true` and
   `GOOGLE_OAUTH_WEB_CLIENT_ID`.
3. Set `GOOGLE_OAUTH_CLIENT_SECRET` on the Render dev API service. It's `sync:false`, so it's set
   in the dashboard.

Nothing is committed and no agent ever sees the value.

### S6 — Local secret smoke
- **Owner agent:** senior-dev-backend (Isaac runs the command if the agent has no `.env` access)
- **What:** Against the local API with the real secret, `POST /auth/oauth/google
  {"server_auth_code":"4/bogus"}`:
  - **Expect 401** with a log line `google_error=invalid_grant`, which proves the client id and
    secret are accepted.
  - **503** with `invalid_client` means the secret is wrong: back to GC2.
  - The run also checks that the start preflight passes with the flag on and fails with the
    secret removed.
- **Files / scope:** none
- **Verification:** the observed status and log reason are recorded, with no secret in the output.
- **Status update:** `[S6] <status, reason>`

### [HUMAN_GATE GC3] — Accept ADRs; merge to `dev`; builds (deploy + cost)
Precondition: GC2 is done, because Render's preflight refuses to boot without the secret. Isaac
approves:

- the ADR 0015 addendum and the ADR 0020 note, Proposed → Accepted;
- the S5 verdicts;
- the merge into `dev`;
- `eas build -p android --profile android-internal` and `eas build -p ios --profile testflight`.

### S7 — Render smoke + on-device verification
- **Owner agent:** qa-strategist (drives); Isaac executes on the devices; mobile-developer and
  senior-dev-backend are on call
- **What:**
  - Render: the boot log shows the preflight passing, and the S6 bogus-code probe returns 401 on
    Render.
  - Then run the §D.6 checklist on the APK and the TestFlight build.
- **Files / scope:** none (devices and Render logs)
- **Verification:** each line is pass/fail, with build numbers. A `redirect_uri_mismatch` in the
  logs means halt and amend §D.2. Any other fail goes back to the owning step, then a new build
  (GC3 again).
- **Status update:** `[S7] <build ids, per-line results, log excerpts with no secrets>`

### S8 — Close-out
- **Owner agent:** scribe
- **What:** Mark the ADR addenda Accepted. Update the `plans/README.md` row outcome. Record any
  S7 facts (consent screen wording, Google error codes seen) in ADR 0015's addendum.
- **Files / scope:** `docs/adr/0015-social-sign-in.md`, `docs/adr/0020-self-service-account-deletion.md`,
  `plans/README.md`
- **Verification:** pre-commit is green.
- **Commit:** `docs: Android Google auth code close-out`
- **Status update:** `[S8] <files>`

### [HUMAN_GATE GC4] — Final sign-off
Isaac accepts the S7 results. Android Google sign-in is closed. S15 of plan-share-links resumes on
Android.

## Rollback
- **Mobile:** revert S4 and ship new builds. The backend keeps accepting `id_token`, so old and
  reverted binaries work as before, broken Android re-sign-in included. There's no OTA.
- **Backend:**
  - Set `OAUTH_GOOGLE_AUTH_CODE_ENABLED=false` on Render. Code requests then get 503, and the
    `id_token` path is untouched.
  - Or revert S2/S3. Do that only after the mobile revert ships, because Android builds from this
    plan depend on the code path.
- **Secret:** delete the client secret in Google Cloud Console and remove it from Render and
  `.env`. Then the flag must be false, or preflight blocks boot.
- **No migration**, so there's nothing to downgrade.

## Risks
- **Legacy GSI.** The library's free "Original" Android API is built on Google Sign-In for
  Android, which Google lists as no longer supported. A future Play Services change could break
  it. The migration (Credential Manager, or the library's Universal module) is a separate
  decision.
- **Fresh code per sign-in is assumed, not documented.** If Play Services ever returns a reused
  code, Google answers `invalid_grant` (401) rather than letting a replay through. That fails safe,
  and S7 steps 2–3 detect it.
- **`redirect_uri=""` comes from Google's legacy doc.** If Google rejects it, S7 surfaces it as a
  503 with `redirect_uri_mismatch` in the logs, and we amend §D.2.
- **Secret-before-merge.** Merging before GC2 takes Render dev's API down until the secret is set.
- **Extra latency.** One extra Google round trip (≤ 10 s timeout) on Android sign-in and deletion.

---

## [HUMAN_GATE GC0] — PASSED 2026-11-01 (Isaac, chat: "GC0 approved")
Open questions resolved with the recommendations (no overrides): (1) accept a one-time Android "offline access" consent screen; (2) try `redirect_uri=""`, halt and amend if Google rejects it on-device; (3) migrating Android off Google's legacy sign-in API (Credential Manager) is a separate follow-up; (4) remove both revoke workarounds on both platforms (new TestFlight + APK at GC3); (5) create a NEW dedicated client secret on the web client for this, so it can be rotated independently.
