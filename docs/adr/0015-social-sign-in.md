# ADR 0015 — Social sign-in: a separate identity table, hand-rolled async JWKS verification, auto-link closes a takeover hole

- **Status:** Proposed. Not Accepted: this has not been through a device /
  on-device verification pass (mobile's own unit tests mock the native
  Google/Apple modules — `status.md` "[Step: mobile Sign in with
  Google/Apple]", 2026-10-15 22:43 UTC), the migration (`c9b3e7a1f2d4`) has
  been written and verified (`alembic heads` resolves to it as the sole head)
  but **never run** against any real database, and `oauth_apple_enabled`
  is left at its spec'd default of `False`. To flip to Accepted, at minimum:
  (1) the migration applied to the real dev DB, (2) Isaac's Google Cloud
  Console client IDs wired into `GOOGLE_OAUTH_CLIENT_IDS` and a real
  end-to-end Google sign-in exercised on a physical device, not just the
  mocked Jest suite.
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
