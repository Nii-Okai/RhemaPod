# ADR 0020: Self-service account deletion and Apple token revocation

- Status: Accepted (2026-10-28, Isaac at `[HUMAN_GATE AD1]`)
- Date: 2026-10-28
- Deciders: Isaac (+ planner, architect, skeptic, security-reviewer, qa-strategist, scribe)
- Plans: `plans/plan-account-deletion-backend.md` (§A.1-A.5, §A.7), `plans/plan-account-deletion-clients.md`
- Relates to: ADR 0015 §6 (the deferred gap this closes), ADR 0018 (audit log), ADR 0019 (reports)

> A viewer can delete their own account with one fresh re-auth. If Apple is linked, the Apple grant is revoked at Apple before anything is deleted.

## Context

- Apple guideline 5.1.1(v): an app with account creation must offer in-app deletion, and for Sign in with Apple must revoke the user's token at Apple.
- Google Play requires in-app deletion plus a web path to request it.
- ADR 0015 §6 deferred both because no Apple `.p8` key existed. Apple sign-in is now enabled in dev (team FAND2W5VMM), so the gap blocks App Store submission.
- Today only an admin can delete a user (`delete_user`, deactivated-first). It has no re-auth, no Apple revocation, and it logs the user's email (CWE-532).
- Apple refresh tokens are not stored anywhere today.

## Decision

`POST /api/v1/auth/me/delete` hard-deletes a viewer's account in one request carrying one fresh proof. Apple revocation uses fork 1b: store nothing; exchange the fresh `authorization_code` from a deletion-time Apple re-auth and revoke it immediately. Revocation runs strictly before the delete transaction. Details below are binding.

### 1. Contract

**Route:** `POST /api/v1/auth/me/delete`. Bearer auth, 204, no body. Viewers only. No two-step delete token.

**Body `AccountDeletionRequest`:** Pydantic v2 discriminated union on `method`, plus a shared `apple_unavailable: bool = False`:
- `{"method": "password", "password": str}`
- `{"method": "google", "id_token": str}`
- `{"method": "apple", "identity_token": str, "raw_nonce": str, "authorization_code": str}`

**Additive `UserPublic` fields:** `has_password: bool` and `linked_providers: list[AuthProvider]`. Nothing else in `UserPublic` changes.

**Errors.** Each is a `ContentError` raised by the service and mapped by the router. Body shape is the existing `{detail, correlation_id}`.

| Status | When |
|---|---|
| 403 | Staff role (any): "Staff accounts are removed by an administrator" |
| 403 | Re-auth failed. **One generic message for every cause:** wrong password; password on a password-less account; Google token on an account without Google; Apple on an account without Apple; `sub` != linked `provider_subject`; stale `iat`; nonce mismatch; replayed token |
| 409 | Apple is linked, method != `apple`, and `apple_unavailable` is false: "Apple re-auth required" |
| 409 | Apple-only account (no password, no Google) with `apple_unavailable: true`: support path |
| 409 | RESTRICT-bound history (demoted ex-staff). Precheck plus an `IntegrityError` backstop. Never 500 |
| 400 | Apple `/auth/token` returned `invalid_grant`. Client re-prompts Apple |
| 503 | Apple unavailable (exchange or revoke 5xx/timeout/network) |
| 503 | Rate-limit store unavailable (delete limiter fails closed) |
| 429 | Delete limiter or shared login key exceeded |
| 422 | Malformed body. **Planner call, confirm at AD1:** `method: "apple"` with `apple_unavailable: true` is a request-shape error (model validator), because the flag only means something alongside a non-Apple proof |

The generic 403 is deliberate: it does not reveal which providers an account has or why a proof failed.

### 2. Behaviour

**Re-auth**
- Google proofs: `verify_google_id_token` (`app/core/oauth.py`). Apple proofs: `verify_apple_identity_token`, nonce checked as at sign-in.
- Every OAuth proof then goes through `_claim_oauth_token_once` (`app/api/auth.py`).
- `sub` must equal this user's `UserIdentity.provider_subject` for that provider.
- `iat` within `account_deletion_reauth_max_age_seconds` (new setting, default 300).
- Password proofs: pwdlib/argon2 verify.

**Sequencing inside `delete_own_account`**
1. Bearer auth, role == viewer (else 403).
2. Per-user delete limiter (fail closed).
3. Password method only: consume the shared login key.
4. Verify the proof (router).
5. RESTRICT precheck (409).
6. Snapshot `email`, `avatar_key`, every playlist `cover_key`, linked providers.
7. Apple method only: `revoke_authorization(code)`.
8. One transaction: pseudonymize the viewer's audit rows, write the `USER_DELETED` row, delete the user. Cascades run here.
9. Commit.
10. Best-effort post-commit work that never raises to the client: `token_store.revoke_refresh`; storage `delete_object` per snapshot key via `asyncio.to_thread` (on failure log `orphaned_object` with the key, never the email); notice email to the snapshot address via the email seam.

**Rate limiting**
- Per-user limiter: key `account_delete:{user_id}`, 5 attempts per 3600 s, `fail_open=False` (Redis down gives 503). This is the real per-account cap.
- Password-method attempts also consume the existing `/auth/login` key `login:{client_ip}:{email}`, the same way `/auth/login` does (every attempt counts).
- That key is **per client IP + email, not per account.** An attacker rotating IPs gets a fresh login budget per IP; the per-user limiter is what bounds them. Sharing the key means delete-path and login-path guesses from one IP draw down one counter.
- The login key keeps its fail-open behaviour. On this route, Redis-down is caught first by the per-user limiter.

**`apple_unavailable`**
- Accepted only with a non-Apple linked-factor proof. It skips revocation and never skips re-auth.
- Apple-only account: the flag gives 409. Account without Apple: the flag is ignored.
- Every skip writes the single value `apple_skip_reason: "apple_unavailable"`. This covers the user-chosen fallback after repeated 503s and a client that cannot do Apple re-auth (Android). Nothing reads the difference, so no server state tracks it.

**Revocation failure (fork 1b)**
- `invalid_grant` gives 400; 5xx/timeout gives 503. Nothing is deleted in either case.
- `/auth/revoke` is retried once; `/auth/token` is never retried (the code is single-use).
- `apple_revoked` is `true` only on a 200 from revoke.

### 3. Apple revocation seam

- `AppleRevocationClient` Protocol: `async revoke_authorization(authorization_code: str) -> None`, raising `AppleRevocationError(reason: "invalid_grant" | "unavailable" | "misconfigured")`.
- `HttpAppleRevocationClient`: `httpx.AsyncClient`, 5 s timeout, base URL fixed to `https://appleid.apple.com`. `POST /auth/token` (`grant_type=authorization_code`), then `POST /auth/revoke` (`token_type_hint=refresh_token`). `invalid_client` maps to `misconfigured` (router: 503, logged at error). A 200 from revoke is success, including for an already-revoked token.
- `client_secret`: ES256 JWT, `kid=APPLE_KEY_ID`, `iss=APPLE_TEAM_ID`, `sub=APPLE_CLIENT_ID`, `aud=https://appleid.apple.com`, lifetime <= 5 min. Minted per call, in memory only, never persisted or logged.
- `StubAppleRevocationClient` records calls and is scriptable per outcome.
- Resolved once at startup from `APPLE_REVOCATION_BACKEND` (`http|stub`, default `stub`), following the `get_storage()` pattern, and injected as a FastAPI dependency. Production preflight refuses to boot on the stub. No new dependency (`pyjwt[crypto]`, `httpx` present).

### 4. Fail-closed limiter divergence

The per-route limiter gets a `fail_open` parameter (default `True`, so login and the OAuth routes are unchanged). The delete endpoint passes `False`: when Redis is down the request gets 503 instead of proceeding. This diverges deliberately from the project's fail-open limiter default, because here the limiter is the only per-account cap on password guessing against an irreversible action, and availability of deletion is the cheaper loss.

### 5. Audit and erasure scope

**Self-delete row:** reuses `AuditAction.USER_DELETED` (no new enum value, no migration).
- `actor_id = target_id = user.id`; `actor_email` and `target_label` NULL.
- `details = {self_service: true, role, providers, apple_revoked: true|false|null}`, plus `apple_skip_reason: "apple_unavailable"` when revocation was skipped. `apple_revoked` is `null` when Apple isn't linked.

**Viewer-only pseudonymization** (any initiator, same transaction, by UPDATE):
- `UPDATE audit_log SET actor_email = NULL WHERE actor_id = :uid`
- `UPDATE audit_log SET target_label = NULL WHERE target_id = :uid AND target_type = 'user'`

For a viewer, the admin-initiated `USER_DELETED` row also carries no email, consistent with the pseudonymization in the same transaction. This is a planner reading, confirm at AD1.

**Why staff rows keep emails:** ADR 0018 accountability. Staff actions need an attributable actor; staff cannot self-delete, and the admin path keeps today's snapshot label for staff targets.

**What the audit rows can still hold (D0 inventory):**
- No audit `details` contain a viewer email. Emails appear only in `target_label` and `actor_email`, which are pseudonymized.
- `SETTINGS_UPDATED` `details` before/after can include the church `contact_email`. This is an admin-actor row about church settings, not a viewer's data, and is out of scope for viewer erasure.

### 6. Admin path

Admin `delete_user` now uses the same shared `_erase_user` (cascades, audit pseudonymization for viewer targets, post-commit cleanup, CWE-532 log fix). Admin authz and the deactivated-first precondition are unchanged. **It cannot revoke Apple** because it has no `authorization_code`. The public web deletion page tells users how to revoke the app's access manually in Apple ID settings.

### 7. Retention

- **Backups:** 30 days. Deleted data can persist in backups for up to 30 days.
- **Pseudonymized viewer audit rows:** 365 days (existing `audit_auth_retention_days`, no config change).

### 8. Deletion semantics

Hard delete through existing cascades. Comments are flat, so there is no anonymisation. No grace period, no scheduled purge.

## Consequences

- Positive: meets 5.1.1(v) and Play requirements; no migration; no stored Apple secrets per user; admin and self-service share one erasure path.
- Positive: audit trail survives deletion without viewer emails.
- Negative: hard delete lowers historical report totals (ADR 0019), and deleted users cannot be recovered.
- Negative: password guessing against delete is bounded per account (5/hour) rather than per IP; the shared login key is per IP + email only. A user can lock themselves out of deletion for an hour.
- Negative: delete availability now depends on Redis (fail closed) and, for Apple users, on Apple being reachable. `apple_unavailable` is the escape hatch for accounts with another factor; Apple-only accounts must go through support.
- Negative: admin-initiated deletion leaves any Apple grant live until the user revokes it manually.
- Negative: R2 object cleanup is best-effort; failures leave orphans (logged as `orphaned_object` for a sweep).
- Neutral: `UserPublic` gains two additive fields, so the OpenAPI contract and generated types for `admin_portal` and `mobile` are regenerated.
- Neutral: new settings and secrets (`APPLE_KEY_ID`, `APPLE_TEAM_ID`, `APPLE_CLIENT_ID`, the `.p8`, `APPLE_REVOCATION_BACKEND`, `account_deletion_reauth_max_age_seconds`) with a preflight and a key runbook in DEPLOYMENT.md.

## Alternatives considered

- **Fork 1a, store Apple refresh tokens at sign-in:** rejected. Needs an encrypted per-user secret store and a migration, exchanges the code at sign-in (out of scope), and holds a long-lived credential for every Apple user to serve a rare action.
- **Async retry of revocation after delete:** rejected. Needs a queue or sweeper and durable state, and the single-use `authorization_code` cannot be replayed, so a retry has nothing to retry with.
- **Delete-and-log (delete first, best-effort revoke):** rejected. Leaves the Apple grant live on any failure, which is the exact gap 5.1.1(v) closes.
- **Two-step delete token:** rejected. One fresh factor in the same request is enough and avoids another token type to store and expire.
- **Distinguishing skip reasons (Redis marker or second audit value):** rejected. Nothing reads the difference.
- **HMAC or keyed hash of identifiers instead of NULLing:** rejected. Adds key management for rows that need no linkability.
- **New `AuditAction` value:** rejected. Needs a CHECK-constraint migration; `USER_DELETED` plus `details.self_service` is enough.
- **Fail-open delete limiter (project default):** rejected, see §4.
- **Staff self-deletion:** out of scope; staff are removed by an administrator.
- **Per-account login key:** not changed. Re-keying `/auth/login` is out of scope; the per-user delete limiter covers the delete path.
