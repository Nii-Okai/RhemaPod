# ADR 0015 — Social sign-in: a separate identity table, hand-rolled async JWKS verification, auto-link closes a takeover hole

- **Status:** Accepted (2026-10-28). All three conditions below now hold:
  migration `c9b3e7a1f2d4` is applied on the dev DB (since superseded as
  head), Google sign-in has been exercised end-to-end on a physical device
  (an identity linked 2026-10-16), and Apple sign-in was enabled and
  exercised on a physical iPhone on 2026-10-28 — see "Update 2026-10-28"
  at the end. The account-deletion / Apple token-revocation gap in §6 is
  still open and is tracked as its own plan, not part of this ADR.
- **Date:** 2026-10-15
- **Scope:** Backend only — `app/core/oauth.py`, `app/services/oauth_service.py`,
  the two new routes in `app/api/auth.py` (`POST /auth/oauth/google`,
  `POST /auth/oauth/apple`), `app/models/models.py`'s `AuthProvider`/
  `UserIdentity` and `User.password_hash` becoming nullable, migration
  `c9b3e7a1f2d4_add_user_identities_and_nullable_password.py`. The mobile
  client (`mobile/lib/auth/googleSignIn.ts`, `appleSignIn.ts`, the
  `sign-in.tsx`/`register.tsx` screens) was built in parallel against this
  exact contract (`status.md` "[Step: mobile Sign in with Google/Apple]") and
  consumes it, but its own implementation choices are not this ADR's subject.
- **Deciders:** Isaac (+ architect, senior-dev-backend, mobile-developer)
- **Relates to:** `status.md` "[Step: backend Sign in with Google/Apple]"
  (2026-10-15 23:18 UTC) and "[Step: mobile Sign in with Google/Apple]"
  (2026-10-15 22:43 UTC); `tests/test_oauth.py` (13 tests); migration
  `c9b3e7a1f2d4`.

> Password sign-in is unchanged and stays the only path for staff. Viewer
> accounts additionally get "Sign in with Google" / "Sign in with Apple".
> Identities live in a new `user_identities` table, not inline columns on
> `users`. Provider tokens are verified by a small hand-rolled async JWKS
> fetch/cache in `app/core/oauth.py` — deliberately not `pyjwt`'s
> `PyJWKClient` (blocking `urllib`) and not the `google-auth` library (a new
> dependency, also synchronous). A verified-email sign-in that matches an
> existing password account auto-links it and, in the same transaction,
> clears that password and revokes every session — closing a pre-registration
> account-takeover hole. Apple is fully built but gated off
> (`oauth_apple_enabled=False`) until Isaac completes Apple Developer Program
> enrollment; Apple's own server-side token revocation (App Store
> account-deletion compliance) is a known, accepted phase-2 gap.

---

## Context

Mobile's sign-in and registration screens needed a lower-friction alternative
to typing an email and password, and the two obvious options on a FastAPI +
Expo stack are "Sign in with Google" and "Sign in with Apple". This is
additive, not a replacement: every existing password-based account, and every
staff account of any kind, keeps working exactly as before. The only new
surface is two endpoints a viewer-role client can call instead of
`/auth/login`.

Three design questions had to be settled before any code, each with a real
wrong answer:

1. **Where does a provider identity live?** Bolting `google_sub`/`apple_sub`
   columns directly onto `users` is the obvious shortcut, but this app
   already has concrete reasons to expect more than one provider per user
   over time (Google now, Apple next, something else later) and to support
   unlinking a provider without touching the account itself.
2. **How is a provider's ID token actually verified**, given this stack's
   hard "async all the way down, no blocking I/O on an async path" rule
   (`CLAUDE.md`) and its stated reluctance to add a dependency without
   flagging the tradeoff?
3. **What happens when a Google/Apple sign-in's email matches an account
   that already has a password?** This is not a cosmetic UX question — get
   it wrong and it is a standing account-takeover vector (see §4 below).

## Decision

### 1. Additive, viewer-only — staff never touch this path

OAuth sign-in exists alongside password auth, never instead of it. Both new
routes resolve to `oauth_service.sign_in_with_identity`, which is a strict
superset of what already exists: fresh account, existing account, or
auto-link. Nothing about `/auth/login`, `/auth/register`, or staff invite
flow changed.

### 2. Schema: a `user_identities` table, not inline columns on `users`

`app/models/models.py` adds `AuthProvider` (`google` | `apple`) and
`UserIdentity` — one row per `(user, provider)` link, migration
`c9b3e7a1f2d4`. The real lookup key is `(provider, provider_subject)`
(unique), where `provider_subject` is the provider's stable `sub` claim,
**never** the email — an OAuth email can drift (a changed Google address, a
rotated Apple relay address); `sub` doesn't. A second unique constraint,
`(user_id, provider)`, caps it to at most one Google and one Apple identity
per user. `email_at_link` is audit-only, never queried against, so a later
email change on either side can't silently break the link. The FK is
`ON DELETE CASCADE` — deleting a user can't leave an orphaned identity row.

Rejected the inline-columns shortcut for the reason the migration's own
docstring and the model's docstring both give: a dedicated table is what
makes "unlink Google, keep the account", "add a third provider later without
a new users column each time", and "one user, one Google identity, one Apple
identity, enforced by the DB" all cheap. Inline columns would have made
every one of those a future migration instead of an already-solved shape.
This is a real second-use-case justification (Apple ships in the same PR,
not hypothetically), not abstraction for its own sake.

The same migration makes `users.password_hash` nullable — a viewer who
signs in only via Google/Apple never sets a password until they explicitly
use Forgot Password. `security.verify_password(plain, None)` already runs a
dummy verify for exactly this case (pre-existing code, unchanged here).

### 3. Token verification: hand-rolled async JWKS, not `PyJWKClient`, not `google-auth`

`app/core/oauth.py` implements its own minimal "fetch the provider's JWKS
over HTTPS, cache it per-process, verify the RS256 signature against the
right `kid`" flow using `httpx.AsyncClient` (the same library
`app/core/stream.py` already uses for outbound calls) plus `pyjwt`'s
low-level `jwt.decode`/`jwt.get_unverified_header`. One generic verifier
(`_verify_token` + `ProviderConfig`) is shared by Google and Apple, which
differ only in issuer, audience source, and Apple's extra nonce check.

Two libraries were deliberately **not** used, both for the same underlying
reason:

- **`pyjwt`'s own `PyJWKClient`** — fetches keys via blocking `urllib`,
  which would stall the event loop on every cache miss. This stack's rule is
  "async all the way down... no blocking I/O on an async path"; a
  JWKS fetch is exactly the kind of I/O that rule exists for.
- **The `google-auth` library** — the conventional way to verify a Google ID
  token, but it is (a) a new dependency for a single function's worth of
  value, and (b) also synchronous under the hood. Taking on a dependency
  that still has to be wrapped in `run_in_executor` to avoid blocking would
  have bought nothing over not adding it at all.

The cache honours the response's own `Cache-Control: max-age` when present,
else `oauth_jwks_default_ttl_seconds` (1 hour default); an unknown `kid`
against an otherwise-fresh cache forces exactly one cooldown-gated re-fetch
(60s), so a flood of bad/replayed tokens carrying random `kid`s can't force a
re-fetch on every request. Both the routine and unknown-`kid` re-fetch paths
are single-flighted behind an `asyncio.Lock`. A JWKS fetch that fails with
nothing already cached fails closed (`OAuthTokenError(reason="unavailable")`,
mapped to 503) — never a false accept; a fetch that fails with a stale cache
already present falls back to serving the stale cache rather than hard
failing a live request over a transient provider blip.

Replay protection is a separate, already-existing primitive: `app/api/auth.py`
claims the token's SHA-256 digest once via `token_store.claim_once` (new),
sized to the token's own remaining `exp` (floored at 60s), after verification
succeeds — the single-use guard, not the signature check, is what stops a
captured valid token being replayed.

### 4. Auto-link-with-password-clear — the security-critical decision

This is the decision this ADR exists to record. When a verified-email
OAuth sign-in matches an existing **password-based** account by email,
`oauth_service.sign_in_with_identity` auto-links it — and, in the exact same
transaction as the new `UserIdentity` row, **clears that account's password
to NULL and revokes every refresh session** (`token_store.revoke_refresh`),
then sends a best-effort "sign-in method linked" email
(`app/core/email.py`'s `send_sign_in_method_linked`).

The reason this is more than a UX nicety: **auto-linking by itself, without
the password-clear and session-revoke, is a standing pre-registration
account-takeover hole.** An attacker who registers the victim's real email
address with a password first, before the victim ever tries Google/Apple
sign-in, would otherwise retain a working password on that account forever —
the victim's later "Sign in with Google" would silently start sharing an
account the attacker can still log into. Clearing the password and revoking
every session the moment the real owner's verified identity links closes
that window completely: the attacker's password stops working and any
session they were holding is killed in the same instant the legitimate owner
successfully authenticates with a provider that has already verified their
email. This was chosen deliberately over the simpler "just auto-link,
leave the password alone" design specifically because that simpler version
leaves the takeover window open indefinitely.

A second identity row for the same `(user, provider)` pair is treated as an
explicit 409 ("already linked to a different Google/Apple account"), never
silently overwritten — the auto-link path only fires on the very first link
for that provider.

### 5. Staff exclusion, checked on every sign-in, not just at link time

Only `role == VIEWER` accounts may ever acquire or use an OAuth identity.
This is enforced twice, deliberately redundantly: once when an existing
password account is found as a link candidate (`role != VIEWER` → 403
before anything is written), and again on every subsequent sign-in through
an already-linked identity. The second check matters on its own — a viewer
promoted to staff after linking Google loses OAuth sign-in on their very
next attempt, not retroactively, and not only at the point of promotion.
Staff always sign in via `/auth/login`.

### 6. What's deliberately deferred

- **Apple is built end-to-end but gated off.** `oauth_apple_enabled`
  defaults to `False` (`app/core/config.py`) — the route exists, returns
  verified-token 404 behavior when disabled (not "unregistered route", an
  in-handler check, so the flag can be exercised both ways in tests without
  rebuilding the FastAPI app). Flipping it to `True` is Isaac's own decision,
  gated behind a real cost: completing enrollment in the Apple Developer
  Program ($99/yr), on his own timeline, not a technical blocker.
- **Apple server-side token revocation is out of scope for this phase.**
  (Since delivered by ADR 0020: revoked at account deletion, with no stored token.)
  Apple's App Store account-deletion requirement (guideline 5.1.1(v)) expects
  an app that lets a user delete their account in-app to also revoke that
  user's Apple grant server-side, which requires a stored, encrypted Apple
  private key (a `.p8` file) that does not exist in this project yet. This
  is an accepted gap for phase 2, not an oversight — it has no workaround
  that doesn't involve generating and securely storing that key first, and
  doing so is pointless before Apple sign-in is even enabled.
- **Mobile's on-device verification pass is still outstanding** (`status.md`
  "[Step: mobile Sign in with Google/Apple]" ran entirely against mocked
  native modules in Jest) — this is part of why Status above is Proposed,
  not Accepted.

## Consequences

- **Positive:** staff accounts are categorically unreachable through this
  surface, by construction, checked on every sign-in rather than relied on
  at registration time. The pre-registration takeover hole is closed, not
  merely narrowed — an attacker's pre-registered password stops working the
  moment the real owner links. No new runtime dependency was added for
  token verification (`httpx` and `pyjwt` were already in use). The identity
  table makes "add a third provider" or "let a user unlink Google" ordinary
  future work instead of a new migration touching `users` again.
- **Negative:** `app/core/oauth.py` re-implements JWKS fetch/cache logic that
  a library would otherwise own — more code for this project to maintain
  than calling `PyJWKClient` or `google-auth` would have been, accepted in
  exchange for not blocking the event loop and not adding a dependency.
  Apple sign-in ships in code but is inert for users until Isaac pays for
  and completes Developer Program enrollment — real, if deferred, product
  value sitting unused. The auto-link's password-clear is a one-way door
  per account: once it fires, the only way back to password sign-in on that
  account is Forgot Password, not the old password (working as intended,
  but worth knowing before support gets the first confused ticket about it).
- **Neutral:** `openapi.json` gained two routes and two schemas
  (`GoogleSignInRequest`, `AppleSignInRequest`); migration `c9b3e7a1f2d4` is
  purely additive (new table, one column relaxed to nullable) with a
  deliberately non-automatic downgrade — reversing the nullable change would
  500 on any row a release has already let go password-less, so the
  migration's `downgrade()` does not attempt to backfill or delete those
  rows itself.

## Alternatives considered

- **Inline `google_sub`/`apple_sub` columns on `users`:** rejected. Cheaper
  for exactly one provider and never touching it again; this project ships
  Apple in the same change and already names unlinking as a near-term need,
  so the extensibility a dedicated table buys was worth its one extra join.
- **Just auto-link, don't clear the password or revoke sessions:** rejected.
  This is the design that leaves the pre-registration takeover window open
  — see §4. Isaac's call was explicit and binding: the stronger, strictly
  safer version was chosen over the simpler one.
- **`pyjwt`'s `PyJWKClient`:** rejected — blocking `urllib` under the hood,
  which would stall the event loop on cache misses, violating this stack's
  async-all-the-way-down rule.
- **The `google-auth` library:** rejected — a new dependency for what this
  module implements directly, and still synchronous underneath, so it would
  not even have solved the blocking-I/O problem without additional wrapping.
- **Enabling Apple sign-in now:** rejected. No `.p8` key exists yet, and
  Isaac has not completed Apple Developer Program enrollment — flipping
  `oauth_apple_enabled` ahead of that would ship a button that works in
  tests and fails for every real user.

## Update 2026-10-28 — Apple enabled in dev; auto-link notice corrected

- **Enrollment done, Apple on.** Isaac enrolled in the Apple Developer
  Program (team `FAND2W5VMM`). `mobile/app.json` now pins
  `ios.appleTeamId` and re-lists the `expo-apple-authentication` config
  plugin (removed earlier because the free Personal Team cannot provision
  the `com.apple.developer.applesignin` entitlement). Dev sets
  `OAUTH_APPLE_ENABLED=true`; `APPLE_OAUTH_AUDIENCES` keeps its default
  (`com.niitech.rhemapod`). Commit `d64882a`.
- **Verified on device.** A real Apple identity token was accepted by
  `POST /auth/oauth/apple` and auto-linked (§4) to an existing Google-first
  viewer on the same verified email — the account now holds both a GOOGLE
  and an APPLE `user_identities` row. Not yet exercised on device: the
  fresh-account path with name prefill (needs an Apple ID with no matching
  account; Apple's `sub` is stable per team, so revoking and re-authorizing
  the same Apple ID resolves back to the linked account).
- **Auto-link notice fix.** `send_sign_in_method_linked` always claimed
  "your previous password was removed", which is false for an account that
  never had one (the Google-first case above). The service now records
  whether a password existed before clearing it and passes
  `password_removed`; the email only mentions a password when one was
  actually removed. Commit `ac8f2a0`, covered in `tests/test_oauth.py`.
- **Still deferred (§6):** in-app account deletion and Apple server-side
  token revocation (guideline 5.1.1(v)). This blocks App Store submission,
  not dev use, and gets its own ADR and plan.

## Addendum 2026-11 — Android server auth code

- **Status of this addendum:** Proposed (accepted at `[HUMAN_GATE GC3]` of
  [`plans/plan-android-google-auth-code.md`](../../plans/plan-android-google-auth-code.md)).
- **Date:** 2026-11-01. **Deciders:** Isaac (GC0 passed 2026-11-01).
- Android sign-in accepts a one-time Google server auth code as an alternative to the
  ID token. iOS and the ID-token contract are unchanged.

### Problem

On Android, `@react-native-google-signin/google-signin` 16.1.5 returns Play Services' *cached*
Google ID token for its ~1h lifetime, even after `revokeAccess()`. The single-use replay guard
(`_claim_oauth_token_once`, §3) then rejects it as `replayed`. Effects: Android Google sign-in
fails on any re-sign-in within the hour, and Google re-auth for account deletion on Android
breaks too (`iat` <= 300 s plus claim-once, ADR 0020). iOS is unaffected. Two client-side
workarounds failed: `6b8ee1e` (pre-sign-in revoke) and `0b0421a` (revoke after use).

### Decision

Android sends a `server_auth_code`. The backend exchanges it at Google's token endpoint for a
freshly minted ID token, then runs that token through the **unchanged** path:
`verify_google_id_token` (JWKS, aud, iss, exp), then (deletion only) `iat` freshness, then
`_claim_oauth_token_once`. The replay guard and the 300 s window keep their meaning because the
exchanged token's `iat` is the exchange time.

### Contract (public API)

- `POST /auth/oauth/google` and the `method: "google"` proof on `POST /auth/me/delete` each accept
  **exactly one** of `id_token` (1-4096 chars) | `server_auth_code` (1-2048 chars). Both or
  neither returns 422 naming both fields.
- The `id_token`-only request is byte-for-byte backward compatible. Response shapes and error
  details are unchanged.
- One route, one rate-limit key (`oauth:google:{client}`), one error table. No separate
  `/auth/oauth/google/code` endpoint.

### Exchange

- `exchange_google_server_auth_code(code) -> str` in `app/core/oauth.py` returns the raw
  `id_token`.
- Form POST to the module-constant `https://oauth2.googleapis.com/token` (host pinned, never
  config-driven) via `httpx.AsyncClient(timeout=10, follow_redirects=False)`. Params: `code`,
  `client_id` (the web client), `client_secret`, `grant_type=authorization_code`,
  `redirect_uri=""` (the Android offline-access convention).
- Only `id_token` is read from the response. Google access and refresh tokens are never
  persisted, logged or returned.

### Error mapping

| Google outcome | Reason | Sign-in | Deletion |
|---|---|---|---|
| 400 `invalid_grant` (bad, expired or reused code) | `invalid` | 401 "Invalid or expired sign-in token" | 403 generic re-auth message |
| 400 `invalid_client` / `unauthorized_client` / `redirect_uri_mismatch` / other 4xx | `unavailable` + `log.error` (our misconfig) | 503 | 503 |
| 5xx, timeout, connect error, redirect, non-JSON, 200 without `id_token` | `unavailable` | 503 | 503 |
| `id_token` fails verification | as §3 (`invalid` / `audience_mismatch`) | as today | 403 |
| Code path disabled | `unavailable` | 503 | 503 |

503 carries "Sign-in temporarily unavailable". Exchange logs carry only Google's `error` code and
the HTTP status, never the body.

### Config

- `OAUTH_GOOGLE_AUTH_CODE_ENABLED` (bool, default false), `GOOGLE_OAUTH_WEB_CLIENT_ID`,
  `GOOGLE_OAUTH_CLIENT_SECRET` (`SecretStr`, redacted in logs).
- The web client id must be a member of `GOOGLE_OAUTH_CLIENT_IDS`, so the exchanged token's
  `aud` passes the existing check.
- Preflight refuses to boot when the flag is true and the secret or web id is missing, or the web
  id is not in the list. It runs in **every** environment, Render dev included (mirrors
  `_check_apple_revocation`), plus in `production_preflight`.
- `server_auth_code`, `google_oauth_client_secret` and `client_secret` are added to the log
  redaction key set.

### Why no server-side revoke

The grant covers only `openid email profile` and the refresh token lives in one request's memory.
Revoking would bring back the consent and account picker on every sign-in, the UX this removes.
Account deletion already revokes client-side (`finishAccountDeletion`), and users can revoke at
myaccount.google.com.

### Why no stub backend

A stub that mints identities is an auth bypass. Dev and test without the secret have the code
path off (503); tests inject `httpx.MockTransport`.

### Consequences

- Positive: Android re-sign-in and deletion re-auth work at any interval. No schema change, no new
  dependency. Rollback is a flag flip (`OAUTH_GOOGLE_AUTH_CODE_ENABLED=false`).
- Negative: one extra Google round trip (10 s timeout) on Android sign-in and deletion. A new
  secret to hold and rotate. A one-time "offline access" consent screen on Android. Merging
  before the secret is on Render takes Render dev's API down (preflight).
- Mobile: Android configures `offlineAccess: true`; both revoke workarounds are removed from the
  sign-in path on both platforms. Sign-out calls `signOut()` only.

### Risks

- **Legacy GSI.** The library's Android API is Google Sign-In for Android, which Google marks "no
  longer supported". Moving to Credential Manager is a separate follow-up.
- **Fresh code per sign-in is assumed, not documented.** A reused code yields `invalid_grant`
  (401), which fails safe; device checklist steps 2-3 detect it.
- **`redirect_uri=""` is from Google's legacy doc.** If Google rejects it, it shows as a 503 with
  `redirect_uri_mismatch` in logs and the exchange is amended.

### Alternatives considered

- **Keep sending the ID token, add more client-side revokes:** rejected. Two attempts failed; Play
  Services serves the cached token regardless.
- **Separate `/auth/oauth/google/code` route:** rejected. Duplicates rate limiting, audit wiring
  and the deletion union for no gain.
- **Server-side revoke after exchange:** rejected, see above.
- **Stub exchange backend for dev:** rejected, auth bypass.
- **Drop claim-once for exchanged tokens:** rejected. The guard stays identical across both paths.
- **Move Android to Credential Manager now:** deferred. Larger change, separate decision.
