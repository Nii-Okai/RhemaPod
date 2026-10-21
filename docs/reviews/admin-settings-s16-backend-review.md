# Admin Settings S16 — Backend code review (S3–S13)

Plan: `plans/plan-admin-settings.md`, step S16 (read-only review of the backend diff S3–S13
against §A). Scope: the three migrations, `ChurchSettings`/`AuditLog`/rollup models,
`record_progress`, `audit_service`, `settings_service`, `analytics_service` reports, the
`admin_audit`/`admin_settings`/`analytics` routers, the S7/S8 call sites and
`purge_audit_log.py`.

Reviewer note: S7–S13 were written by the agent doing this review; S3–S6 by an earlier session.
No independent `reviewer-gilfoyle` pass was run, so weigh it accordingly at `[HUMAN_GATE AS6]`.

## Verdict

**No open blocking findings.** One documentation error found and fixed (finding 1). The rest
are accepted, with reasons.

Full backend suite green against real Postgres and Redis (result in the S16 commit message);
admin portal lint, 794 unit tests and production build green; both TypeScript clients typecheck.

---

## 1. FIXED — docs claimed the purge refuses to run when retention is unset

DEPLOYMENT.md §5, ADR 0018 and the S9 review said `purge_audit_log` "refuses to run if either
value is unset". It doesn't: `audit_auth_retention_days` and `audit_network_retention_days`
default to the approved 365 and are `Field(ge=1)`, so a 0 or negative override stops the app at
startup. That is the behaviour `test_purge_halts_if_retention_values_unset` actually pins. All
three docs now say so.

## 2. Transaction boundaries vs §A.3 — match

| Event | Rule | Where it's enforced |
|---|---|---|
| staff mutations, password change/reset, `settings.updated` | same transaction | `audit_service.record` flushes on the caller's session before its own `commit`; each proved by a real Postgres insert failure rolling the mutation back |
| `auth.login`, `auth.logout` | fail-open | `record_detached`, own session, swallows and logs `audit_write_failed` |
| `auth.login_failed` | fail-open, after response | Starlette `BackgroundTask` on the 401 |
| `report.exported` | fail-closed | commit before the CSV is returned; proved |

Two accepted ordering costs, both pre-existing patterns rather than new risk:

- `change_role` revokes refresh tokens before its audit insert (revoke-before-commit is the
  plan's required ordering). A failed audit insert therefore leaves the target signed out with
  their role unchanged. That's a forced re-login, not a privilege issue, and is the same cost
  `change_role` already accepts for the last-admin 409.
- `reset_password` consumes the single-use token (Redis) before the audit insert. A failed insert
  leaves the password unchanged and the link spent; the user requests a new one.
  `change_password` flushes its audit row *before* revoking, so a failed insert there cuts no
  sessions.

## 3. Dialect handling — sound

Every new query runs on both dialects: the audit feed casts each enum column to `VARCHAR` per
`UNION` branch, builds legacy `details` in Python rather than with `json_build_object`, and has a
SQLite smoke test. Reports compute edges in Python and use only `CASE`, `SUM` and
`COUNT(DISTINCT CASE …)`, also with a SQLite smoke test. `record_progress` keeps both dialect
arms and its correctness is proved on Postgres. `_InetAsString` normalises INET to `str` on both
dialects, and `AuditCtx` never hands it a value INET would reject.

## 4. Correctness notes — accepted

- **Cache-aside race on `/settings/public`.** A read that loads the row just before a PATCH
  commits can write the old value back after the PATCH deletes the key, and serve it until the
  300 s TTL expires. This is inherent to cache-aside without versioned keys, and ADR 0017 already
  accepts up to 300 s of staleness through `max-age`. Not worth a versioned-key scheme for a
  rarely edited row.
- **Signups count current viewers.** `signups` counts accounts whose *current* role is viewer,
  so a viewer later promoted to staff drops out of past periods. This is documented on
  `ReportKpis`. Staff invites are deliberately not signups.
- **Legacy audit rows show the actor's current role and email,** not a snapshot (ADR 0018
  Consequences). `audit_log` rows snapshot both.
- **`record`'s `actor` is typed `User`** but `logout` passes the `CurrentUser` principal, which has
  the same `id`/`email`/`role`. A shared Protocol would need `audit_service` to import from
  `dependencies`, which is circular. Left as duck typing; the logout test covers it.
- **`watched_delta` is client-reported,** capped at 3,600 per ping by `ProgressUpdate`
  (pre-existing). Watch hours in reports inherit that trust level.

## 5. Scope vs §A — two flagged deviations, one out-of-plan fix

- `AuditEntry` adds `ip`/`user_agent` (NULL on legacy rows), which §A.5 didn't list (S10 commit,
  for AS6).
- `staff_only` drops `comment.self_delete` from the legacy rows, because §A.5 wrongly assumed
  legacy actors are always staff (S10 commit, for AS6).
- `authenticate`'s timing-oracle fix (`c37dd74`) is outside §A's file list but required by DoD
  bullet 5 (S9 review §1).

No column, endpoint or audit action outside §A was added. No DB VIEW and no native enum.

## 6. Abstractions without a second use — acceptable

`AuditFilters`/`AuditFeedRow` (one caller each) are parameter/result records for a function with
ten inputs, not extension points. `etag_for`/`etag_matches` exist so the weak-comparison rule is
unit-testable on its own. `SETTINGS_TEXT_FIELDS` drives both the validators and `changes()`. No
new base class, registry or plugin seam.
