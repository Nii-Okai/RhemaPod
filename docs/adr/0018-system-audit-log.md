# ADR 0018 — System audit log: a bounded catalog, three transaction rules, one read feed

- **Status:** Proposed (flips to Accepted at `[HUMAN_GATE AS7]` merge to `dev`).
- **Date:** 2026-10-20
- **Scope:** Backend — the `audit_log` table (migration `8c596c67f0ae`), `AuditAction`/
  `AuditOutcome`, `app/services/audit_service.py` (writers and the read feed), the call sites in
  `auth_service`, `oauth_service`, `app/api/auth.py`, `app/api/admin_auth.py`,
  `settings_service` and the report export, `GET /admin/audit`, `AuditCtx`
  (`app/core/dependencies.py`) and `app/scripts/purge_audit_log.py`. Admin portal — the
  User-Agent forward (`lib/auth/user-agent.ts`) and the `/settings/audit` screen (S17).
- **Deciders:** Isaac (+ planner, architect, senior-dev-backend, security review)
- **Relates to:** `plans/plan-admin-settings.md` §A.1 (D5, D6, D8, D9), §A.3, §A.4.2, §A.7;
  `docs/reviews/admin-settings-s9-security-review.md`; ADR 0017, ADR 0019.

> Admins see one audit trail covering logins, staff changes, settings edits and report exports,
> alongside the sermon, announcement and comment-moderation history the app already kept.

---

## Context

Three domain logs already existed (`approval_log`, `announcement_approval_log`,
`comment_moderation_log`), each with its own shape and actor FK rules. Nothing recorded sign-ins,
role changes, deactivations or settings edits. A new log had to answer "who did what, when, from
where" without slowing or weakening the paths it watches: login latency must not reveal whether
an account exists, and a broken audit table must not lock everyone out.

## Decision

### 1. A bounded v1 catalog (§A.3)

`auth.login` (password, Google, Apple), `auth.login_failed`, `auth.logout`,
`auth.password_changed`, `auth.password_reset`, `user.staff_invited`, `user.invite_resent`,
`user.role_changed`, `user.deactivated`, `user.reactivated`, `settings.updated`,
`report.exported`. Stored as varchar with a CHECK constraint, never a native Postgres enum (D8).
Refresh rotation, registration and profile edits are not audited in v1. Adding an action is a
migration plus a catalog change, on purpose.

### 2. Three transaction rules

- **Atomic** — staff mutations, password change/reset, settings updates: `record()` adds and
  flushes on the caller's session and never commits. A failed audit insert rolls the mutation
  back (no account, no invite email, no role change, no settings change).
- **Fail-open** — `auth.login`, `auth.logout`: `record_detached()` commits in its own session and
  swallows any error after logging `audit_write_failed`. Tokens are already issued; the audit
  table must not be able to lock people out.
- **Fail-closed** — `report.exported`: the row is committed before the CSV is returned. No row,
  no file.

`auth.login_failed` is written only for an email that matches an account, by a background task
attached to the 401, so the lookup happens after the response. The request path does identical
DB work for known and unknown emails (a test records every statement), and `authenticate` now
always runs its dummy Argon2 verify (it didn't before; see the S9 review).

### 3. Snapshots instead of foreign keys

`actor_id` has no FK. `actor_email` and `actor_role` are snapshotted at write time, so rows
survive account erasure and never block it. Targets are a generic `target_type`/`target_id`/
`target_label` triple. The id is a UUID so the table unions with the three older logs.

### 4. One read feed, built at query time (D9)

`GET /admin/audit` (admin only, D7; view-only, no export, D5) is a `UNION ALL` of `audit_log`
and the three domain logs, normalised in `audit_service.list_entries`. There is no DB VIEW and
the older tables are untouched. Legacy rows map to `sermon.status_changed`,
`announcement.status_changed` and `comment.<action>`, take their actor label from the current
account ("Deleted account" when gone, "System" for auto-hides), and never include the
moderated comment body. Filters cover actor, action, category, outcome, target and a half-open
date range, with `staff_only` on by default (D6). It excludes viewer sign-ins and a viewer
deleting their own comment. Each row has a server-built summary sentence.

### 5. IP and User-Agent capture

`AuditCtx` builds each row's network context: the trusted-proxy-aware client IP (NULL if it
isn't a storable address), the User-Agent with control characters stripped and cut to 512, and
the correlation id cut to 64 (it is client-settable). The admin portal BFF forwards the browser's
User-Agent on login, logout, set-password and every proxied call. Its real IP needs
`CLIENT_IP_HEADER` on the portal and `TRUSTED_PROXIES` on the backend (DEPLOYMENT.md §13).
Verified end to end: with both set, rows carry the browser's IP and UA and a spoofed
`X-Forwarded-For` is ignored.

### 6. Retention (§A.7, approved by Isaac at AS0)

`purge_audit_log.py`, run daily: `auth.*` rows are deleted after 365 days
(`AUDIT_AUTH_RETENTION_DAYS`); every other row keeps its who/what/when but has `ip` and
`user_agent` nulled after 365 days (`AUDIT_NETWORK_RETENTION_DAYS`). The script refuses to run
if either value is unset.

## Consequences

- **Positive:** one place to answer "who changed this?" across the whole app; mutations and
  their audit rows can't disagree; login stays available and indistinguishable for unknown
  emails.
- **Negative / accepted:** login IPs and User-Agents are personal data. **The privacy policy Isaac
  hosts (ADR 0017) should disclose their capture and the 365-day retention, and the app-store
  privacy declarations may need the same.** A broken audit table silently stops recording
  logins; the `audit_write_failed` log volume is the alert signal. An attacker who knows a valid
  email can add one `auth.login_failed` row per attempt, bounded by the login rate limit.
  Legacy rows show the actor's current email and role, not a snapshot.
- **Follow-ups:** S17 (portal screen); adding `auth.*` events for refresh or profile edits would
  be a catalog change and a new ADR note.

## Alternatives considered

- **A Postgres VIEW over the four logs:** rejected (D9). It would need its own migrations every
  time a log changes and can't run on the SQLite test suite.
- **Migrating the three older logs into `audit_log`:** rejected. It would rewrite history tables
  that other features own, for no gain the read-time union doesn't already give.
- **Fail-closed logins:** rejected. An audit outage would become a login outage for every user.
- **Writing `auth.login_failed` inline:** rejected. The account lookup would make failed logins
  for real accounts measurably slower, which reveals whether an email is registered.
- **Native Postgres enums for `action`/`outcome`:** rejected (D8), per migration `f3a9c7d2b4e1`.
