# Plan: Admin portal Settings — church profile, audit trail, usage reports

Design source of truth is the `architect` design for the Settings page (three sections), as amended
by Isaac's three decisions in §A.1 (D1–D3). The architect's text was not saved to a file. Its
load-bearing claims were re-verified against `dev` @ `edad174` while this plan was written, and §A.6
records where the design was wrong or has drifted. §A is binding. Changing any row is a plan
amendment, not an executor's call.

Execution log: the append-only root `status.md`, never this file. Every step appends a heading
`## ADMIN-SETTINGS — <step id> <short title>`, then the line
`[ADMIN-SETTINGS — <step id> <short title>] <agent: …> <ISO-8601 UTC timestamp>`, then the body.
Nothing is logged until `[HUMAN_GATE AS0]` is crossed.

Branch: `feat/admin-settings` off `dev` (S0). One controlled merge back into `dev` at
`[HUMAN_GATE AS7]`, the same way every prior plan in `plans/` has landed. Isaac can redirect the
target at AS0.

Executors halt **only** at gates. Between gates they run to the step's verification. If reality
diverges from this plan (an anchor has moved, a step seems to need a column, endpoint or event not
listed in §A, or a test can only pass by mocking the DB session), the executor stops, writes
`HALTED: <reason>` in its status entry, and the Conductor decides whether to amend.

---

## Goal

Managers and admins can edit the church profile and the content the mobile app shows, and the
mobile app reads it with an offline fallback. Admins can see one unified audit trail that includes
logins. Managers can view period-based usage reports. Only admins can export them to CSV.

## Scope

- **In:** three additive migrations (`sermon_play_daily` + `listener_day`, `audit_log`,
  `church_settings`); rollup writes inside `record_progress`; `audit_service` and the §A.3 event
  catalog; the read-time `UNION ALL` audit feed; the audit retention purge script; six endpoints
  (§A.5); the `/settings/{profile,audit,reports}` admin portal screens; mobile `useChurchSettings()`
  plus Terms-of-use/Privacy-policy link rows; contract regen; three ADRs.
- **Out. This is a hard boundary.** No scheduled or emailed reports. No audit export. No
  re-acceptance of comment guidelines (D3). No in-app rendering of legal documents (D2). No mobile UI
  for `about`/`tagline`/`contact_phone`/`website_url`/`address`: the public endpoint returns these
  fields, but no screen renders them in v1. No backfill of rollups (not possible, see §A.2). No
  change to `ApprovalLog`, `AnnouncementApprovalLog` or `CommentModerationLog`. No audit event that
  isn't in §A.3. No Postgres VIEW and no native Postgres enum. If a step seems to need any of these,
  it is out of scope. Halt.

## Definition of Done

- [ ] `GET /api/v1/settings/public` returns 200 without auth, carries a weak `ETag` from `version`,
      and returns 304 on a matching `If-None-Match`. It is served from Redis cache-aside and still
      answers 200 when Redis is down.
- [ ] `PATCH /api/v1/admin/settings` with a stale `version` returns 409. A successful PATCH writes
      a `settings.updated` audit row (changed field names plus before/after in `details`) in the
      **same transaction**. If the audit insert is forced to fail, the settings change rolls back
      (proven on real Postgres). The public cache key is invalidated after commit.
- [ ] An editor gets 403 from every `/admin/settings`, `/admin/audit` and
      `/admin/analytics/report*` route. A manager gets 403 from `/admin/audit` and
      `/admin/analytics/report/export`, and 200 from `/admin/analytics/report`.
- [ ] Every §A.3 event is written at its call site. Privileged mutations are atomic with their
      audit row. Login events are fail-open: a broken audit insert still returns tokens and emits an
      `audit_write_failed` structlog error.
- [ ] `auth.login_failed` is written only for an email that matches an existing account. Response
      body, status **and latency** for unknown vs known-but-wrong-password emails stay
      indistinguishable (the S8 test asserts no audit DB work happens on the request path).
- [ ] `GET /api/v1/admin/audit` returns `Page[AuditEntry]` merging `audit_log` with the three
      existing domain logs. Every filter in §A.5 works, and each row carries a server-built
      `summary`.
- [ ] A progress ping writes the correct deltas to `sermon_play_daily` and `listener_day` in the
      same transaction as the `playback_sessions` upsert. Plays, completions and listener-days are
      counted exactly once under concurrent pings (real Postgres test, ≥2 concurrent sessions).
      Existing `tests/test_analytics.py` passes with no assertion changes.
- [ ] `GET /admin/analytics/report` returns `period`, `data_available_from`, `kpis`, `series` and
      `top_sermons` for `[from, to)` in UTC, capped at 366 days, with `granularity=day|week|month`.
      The CSV export is UTF-8 with BOM, guards every text cell against formula injection, and
      writes `report.exported`.
- [ ] Client IPs recorded for staff logins through the admin portal BFF are the browser's IP, not
      the BFF's, in the docker-compose topology with `CLIENT_IP_HEADER` + `trusted_proxies` set.
      Without them, the documented fallback applies. The user agent recorded is the browser's.
- [ ] `alembic upgrade head` → `downgrade` past all three → `upgrade head` round-trips cleanly.
      `alembic check` reports no drift.
- [ ] `openapi.json`, `admin_portal/lib/api/schema.d.ts` and `mobile/lib/api/schema.d.ts` are
      regenerated. The diff contains only §A.5's additions.
- [ ] Admin portal `/settings` redirects to `/settings/profile`. Each sub-route enforces its own
      `requireRole` (404 below the bar). The export control only renders for admins.
- [ ] Mobile reads contact email and comment guidelines from the server, using the
      `commentsCompliance.ts` constants as fallback (offline, error, or first launch), and shows
      Terms/Privacy rows only when the URL is set.
- [ ] Backend `pytest -q --tb=short` green. Admin portal `npm run verify` green. Mobile `tsc` and
      jest green. `pre-commit run --all-files` green.
- [ ] ADRs 0017–0019 written. `plans/README.md` has a row for this plan.

---

## A.1 Locked decisions

| # | Decision | Source |
|---|---|---|
| D1 | Managers **view** `/admin/analytics/report`. CSV export is **admin-only**. | Isaac |
| D2 | Privacy policy is hosted by Isaac elsewhere: `church_settings.privacy_policy_url`, no text field, no in-app rendering. | Isaac |
| D2a | **Assumption (confirm at AS0):** terms of use is treated the same way (`terms_of_use_url`). Isaac's answer named the privacy policy only. Two legal documents handled two different ways would be the odd case, and a URL field costs nothing to change later. Comment guidelines stay **inline text**, because the viewer accepts them in-app before first post (`comments_service.py` L305). | Planner |
| D3 | Editing comment guidelines does **not** force re-acceptance. Existing `users.comments_terms_accepted_at` (`models.py` L116) stands. `audit_log` is the only record of what changed when. | Isaac |
| D4 | Reports are on-demand presets. No scheduled or emailed delivery. | Architect default |
| D5 | Audit trail is view-only in v1. No export. | Architect default |
| D6 | All logins (viewer and staff) are audited. The UI defaults to a staff-only filter, which is a filter, not a restriction. | Architect default |
| D7 | Profile and legal-content fields are editable by managers and above. Audit is admin-only. | Architect default |
| D8 | Enums are Python `StrEnum`s stored as varchar (`native_enum=False`, `values_callable`, like `models.py` L886–895), with a CHECK constraint listing the values. No native Postgres enum (the receipt is migration `f3a9c7d2b4e1`). | Architect, verified |
| D9 | The audit read model is a query-time `UNION ALL` in `app/services/audit_service.py`. No DB VIEW. The three existing log tables are not migrated or altered. | Architect |
| D10 | One branch for all three sections. **Assumption (confirm at AS0):** no deployed backend is serving real listeners yet (`plan-mobile-app.md` M10/M11 are still open), so landing the rollups early would gain no data. If that's wrong, Isaac can tell the Conductor at AS2 to merge Phase 1 to `dev` on its own. | Planner |
| D11 | Three ADRs, numbered after `0016` (the `0011` gap stays): `0017` church settings + public settings contract, `0018` system audit log (capture, retention, IP/UA), `0019` usage rollups + reports. | Planner, verified |

## A.2 Accepted consequences (shown to Isaac at AS0)

- **Rollups are forward-only.** Plays, completions and watch time per period exist only from the
  day S4 deploys. `PlaybackSession` keeps one cumulative row per user and sermon, so no history
  exists to rebuild them from. Reports show "Data available from <date>", where the date is the
  earliest `day` in `sermon_play_daily`. If the first deployed days had zero plays, that marker
  is late by those days. **Signups** (`users.created_at`) and **new listeners**
  (`MIN(playback_sessions.first_played_at)`) stay accurate for any historical period.
- **Personal data.** `audit_log.ip`/`user_agent` and `listener_day` (per-user daily activity) are
  personal data. The privacy policy Isaac hosts (D2) should disclose login IP/user-agent capture and
  its retention, and the app-store privacy declarations may need the same. That's Isaac's action,
  outside this plan, and it's flagged here so it isn't missed.
- **No re-acceptance (D3):** a viewer who accepted v1 guidelines is never shown later edits unless
  they reopen the sheet.
- **Hard deletes propagate.** `sermon_play_daily.sermon_id` and `listener_day.user_id` are FK
  `ON DELETE CASCADE`, which matches `playback_sessions` (`models.py` L711–722). Erasing a user or
  hard-deleting a sermon therefore lowers past report totals. Planner's choice: it's consistent
  with today's analytics and errs toward erasure.

## A.3 Audit event catalog (v1, bounded)

| Action | Where written (verified anchor, `dev` @ `edad174`) | Txn |
|---|---|---|
| `auth.login` `{method: password\|google\|apple, new_account?}` | `app/api/auth.py` `login` L71–94, after `issue_token_pair` L91; `_finish_oauth_sign_in` L246–252 (covers both OAuth routes L269/L287). `new_account` comes from `oauth_service.sign_in_with_identity` L245 (`oauth_account_created` log L295). | fail-open, own commit |
| `auth.login_failed` `{method: password, reason: bad_password\|inactive}` | `auth.py` L86 `except AuthError`. **Only** when the email matches an account, resolved in a `BackgroundTasks` job **after** the response so that `authenticate`'s equal-cost guarantee (`auth_service.py` L213–219) isn't undone. OAuth verification failures are not logged (no verified identity). | fail-open, background |
| `auth.logout` | `auth.py` `logout` L114–121 | fail-open |
| `auth.password_changed` | `auth_service.change_password` L358 (log L396) | same txn |
| `auth.password_reset` `{token_type}` | `auth_service.reset_password` L326 (log L355); covers invite set-password | same txn |
| `user.staff_invited` `{role}` | `auth_service.create_staff` L399 (log L474) | same txn |
| `user.invite_resent` | `auth_service.resend_invite` L670 (log L758) | same txn |
| `user.role_changed` `{from, to}` | `auth_service.change_role` L524, before `db.commit()` L563 | same txn |
| `user.deactivated` / `user.reactivated` `{revocation_deferred}` | `auth_service.set_active` L575, before commits L612/L647. `revocation_deferred` is only known after commit, so it's written to structlog and not to the row. | same txn |
| `settings.updated` `{changed: [...], before, after}` | new `settings_service.update` | same txn |
| `report.exported` `{kind, from, to, granularity}` | new export endpoint | own commit, **fail-closed** (no row, no file) |

Every row also carries `correlation_id` (from the `app/core/logging.py` L8 contextvar), `ip`
(`app/core/net.client_ip`) and `user_agent` (truncated to 512). Routers build these into an
`AuditContext` and pass it into the service. Services never read `Request`.
Refresh rotation, registration and profile edits are **not** audited in v1.

## A.4 Schema (three migrations, chained from head `c9b3e7a1f2d4`)

All three are additive. Each has a working `downgrade`. The SQLite suite (`tests/conftest.py` L48,
`create_all` over all of `Base.metadata`) must still boot, so Postgres-only types go through
`with_variant` (`JSON().with_variant(JSONB, "postgresql")`, `String(45).with_variant(INET,
"postgresql")`). No such column exists in `models.py` yet, so S3/S6 set the precedent.

1. **Rollups** (S3): `sermon_play_daily(day date, sermon_id uuid FK CASCADE, plays int, completions
   int, watched_seconds bigint, PK(day, sermon_id))`; `listener_day(day date, user_id uuid FK
   CASCADE, PK(day, user_id))`, plus an index on `(user_id)` for the cascade.
2. **Audit** (S6): `audit_log(id uuid PK default uuid4, created_at timestamptz default now(),
   action varchar(40) CHECK, outcome varchar(10) CHECK in (success, failure), actor_id uuid NULL
   **no FK**, actor_email varchar(320), actor_role varchar(20), target_type varchar(30), target_id
   uuid NULL, target_label varchar(200), ip inet NULL, user_agent varchar(512), correlation_id
   varchar(64), details jsonb NOT NULL default '{}')`. Indexes: `(created_at DESC, id)`,
   `(actor_id, created_at)`, `(action, created_at)`. The id is a UUID (not serial) so it unions with
   the three UUID-keyed logs. No FK on the actor, so rows survive account erasure. (The architect
   said `CommentModerationLog` already works this way. It doesn't: its `actor_id` is FK
   `SET NULL`, L883. The snapshot columns make the FK unnecessary here.)
3. **Church settings** (S11): `church_settings(id smallint PK CHECK (id = 1), church_name, app_display_name,
   tagline, about, contact_email NOT NULL, contact_phone, website_url, address, comment_guidelines
   text NOT NULL, terms_of_use_url, privacy_policy_url, copyright_notice, version int NOT NULL
   default 1, updated_at, updated_by_id uuid NULL no FK)`. Seed row: `church_name='Watered Garden
   Church'`, `app_display_name='RhemaPod'`, `contact_email='contact@rhemapod.com'`,
   `comment_guidelines` = **byte-for-byte** `COMMENTS_TERMS_TEXT` from
   `mobile/lib/content/commentsCompliance.ts` L16–28 (first line is the title; `TermsSheet`
   relies on the title/body split). Both URLs are NULL. Other fields are NULL.

## A.5 API (contract approved at `[HUMAN_GATE AS6]`)

| Method / path (under `/api/v1`) | Guard | Notes |
|---|---|---|
| `GET /settings/public` | none | Public DTO: no `updated_by_id`. Includes `version`. Cache-aside key `settings:public:v1` via `app/core/redis.cache_aside` (L38), TTL 300s. `ETag: W/"<version>"`, `Cache-Control: public, max-age=300`. 304 on match. First weak-ETag use in the app (no precedent exists). |
| `GET /admin/settings` | ManagerPlus | Full DTO, including `version`, `updated_at`, `updated_by` (resolved label). |
| `PATCH /admin/settings` | ManagerPlus | Partial update + required `version`. 409 on mismatch (`UPDATE … WHERE version = :v`, rowcount 0 → `ContentError(409)`). URLs: `https` only, ≤ 2048. `contact_email`: `EmailStr`. `comment_guidelines` 1–10,000 chars. Invalidation copies `content_service.invalidate_catalog_cache` (L643): delete after commit, log on failure, TTL bounds staleness. |
| `GET /admin/audit` | AdminOnly | `actor_id`, `action` (repeatable), `category` (auth\|users\|settings\|reports\|sermons\|announcements\|moderation), `staff_only` (bool, UI default true), `target_type`+`target_id`, `outcome`, `from`/`to` (UTC, half-open), `limit` ≤ 100, `offset`. Returns `Page[AuditEntry]` (`content_schemas.py` L928). Legacy rows are mapped to `sermon.status_changed`, `announcement.status_changed` and `comment.<ModerationAction>`. Their actor labels come from a `LEFT JOIN users` (NULL → "Deleted account"). Uses `ReadDbDep`. |
| `GET /admin/analytics/report` | ManagerPlus | `from`, `to` (dates, half-open, `to - from` ≤ 366 days, else 422), `granularity`. KPIs: plays, completions, watch hours, distinct listeners (from `listener_day`, never a sum of per-bucket counts), new listeners, signups. Bucketing is computed **in Python from edges**, as `week_start_boundaries` (`analytics_service.py` L57) does. No `date_trunc`: the suite runs SQLite. Weeks are ISO Mondays. Months are calendar months. Ghana is UTC+0 with no DST, so UTC days are local days and v1 has no `tz` parameter. |
| `GET /admin/analytics/report/export` | AdminOnly | Same params + `kind=timeseries\|top_sermons`. `text/csv; charset=utf-8`, leading BOM, `Content-Disposition: attachment`. Every text cell goes through an OWASP formula guard matching the admin portal's (`components/subscriptions/subscriptions-csv.ts` L39–55: leading `= + - @ \t \r` → prefix `'`), then RFC 4180 quoting. **Implementers must not skip this.** Sermon titles are editor-controlled. |

Routers: new `app/api/admin_settings.py` (both settings paths, or a public router file if cleaner)
and `app/api/admin_audit.py`. The report endpoints go into the existing `app/api/analytics.py`
(L112–139, already ManagerPlus). Register them in `main.py` L181–201.

## A.6 Verified anchors and corrections to the design (S0 re-verifies)

| Area | Anchor / finding |
|---|---|
| Alembic head | `c9b3e7a1f2d4` (`add_user_identities_and_nullable_password`). |
| `record_progress` | `app/services/analytics_service.py` L88–181. The upsert is L130–171 and `db.commit()` is L172. Restart (`is_restart`, L150) and completion OR (L167) are decided **SQL-side in `on_conflict_do_update`**, and there's no `RETURNING`: the row is re-read at L176. There are two dialect arms (pg/sqlite, L130). Mobile flushes every **20s per active player** (`mobile/app/player/_player/useProgressFlush.ts` L16). |
| Analytics API | `app/api/analytics.py`: `/admin/analytics/overview` L112, `/top-sermons` L117, new-listeners L125, all `ManagerPlus` (L27). Progress POST L44. |
| Auth call sites | §A.3 table. `oauth_sign_in`/`oauth_account_created` live in `oauth_service.py` L250/L295, as the architect corrected. `authenticate` (L211) has no request context, so login events are written in the router. |
| Staff mutations | `app/api/admin_auth.py` (prefix `/users`, ManagerPlus L33): create L91, role L128, active L144, resend L171. All four services commit internally, so the audit insert goes before each `db.commit()`. |
| Client IP | `app/core/net.client_ip` trusts XFF only from `settings.trusted_proxies` (`config.py` L275, default `[]`). The BFF (`admin_portal/lib/auth/client-ip.ts`) forwards a validated XFF **only when `CLIENT_IP_HEADER` is set**. Unset (plain dev) → backend records the BFF's IP plus a `client_ip_fallback` warning. **New finding:** nothing in `admin_portal/lib/auth/{proxy,upstream}.ts` forwards the browser `User-Agent`, so staff logins would record Node's UA. S8 fixes this. |
| Domain logs | `ApprovalLog` L391 (actor FK RESTRICT), `AnnouncementApprovalLog` L660 (actor FK RESTRICT), `CommentModerationLog` L872 (actor FK SET NULL, nullable). All UUID PKs with `created_at`, none with actor snapshots. |
| `Page[T]` | `app/models/content_schemas.py` L928 (`items/total/limit/offset`). |
| Unauthenticated reads | The precedent is `get_optional_user` (`app/core/dependencies.py` L70) used by `catalog.py` and `categories.py`. **Correction:** `plans/plan-nonauth.md` is "non-auth *code-review findings*", not unauthenticated browsing, so don't cite it. |
| Cache | `app/core/redis.cache_aside` L38 is fail-open. The invalidation precedent is `content_service.invalidate_catalog_cache` L643. |
| Test DB | Default `engine` is SQLite in-memory (`conftest.py` L48, L87–105). Real Postgres is `pg_engine`/`pg_client` (Testcontainers `postgres:17`, L108–159). The migration round-trip harness is `tests/test_migration_roundtrip.py` (`throwaway_db` L109). |
| Mobile | `CONTACT_EMAIL = 'contact@rhemapod.com'` L14 and `COMMENTS_TERMS_TEXT` L16–28 in `mobile/lib/content/commentsCompliance.ts`. The consumers are `app/(tabs)/me.tsx` L11/L69/L160–165 and `app/player/_comments/{TermsSheet,CommentsPanel}.tsx`. TanStack Query v5 + `PersistQueryClientProvider` (`lib/query/QueryProvider.tsx`, `persister.ts`) are already present. Hooks live in `lib/query/hooks/`. `Linking.openURL` is already used, so no new dependency. |
| Admin portal | `app/(portal)/settings/page.tsx` already exists as a manager+ placeholder (`requireRole("manager")`). Nav: `components/portal/nav-config.ts` L86 (Account → Settings, hidden from editors). `lib/auth/require-role.ts` exposes `requireRole("manager"\|"admin")` → `notFound()`. Precedent pages: `/review`, `/users`, `/subscriptions`. Charts primitives: `components/charts/`. Gen script: `npm run gen:api`. |
| Contract regen | `app/scripts/dump_openapi.py`, then `npm run gen:api` in `admin_portal/` and `mobile/` (Stripe-removal S2 precedent, `d2242f5`). |

## A.7 Retention (decided by Isaac at AS0; planner proposes, does not default)

Storing login IPs and user agents is a policy call, not an engineering default, so this plan
**doesn't ship a number Isaac hasn't approved**. Proposal for him to accept or change at AS0:

- `auth.*` rows: deleted after **12 months**.
- All other `audit_log` rows: kept indefinitely, but `ip` and `user_agent` are nulled after **12
  months** (the who/what/when of a role change stays and the network identifier goes).
- `listener_day`: kept as long as reports need it (distinct-listener counts depend on it).
  Isaac may cap this too.

S6 implements `app/scripts/purge_audit_log.py` with the approved values as `Settings` fields
(`audit_auth_retention_days`, `audit_network_retention_days`) and the same shape as
`purge_comment_snapshots.py`. Scheduling it is a deploy concern, recorded in `DEPLOYMENT.md` by S14.

---

### [HUMAN_GATE AS0] — Plan approval

Isaac approves this plan, D1–D11, the §A.2 consequences, and **decides §A.7 retention**. He
confirms D2a (terms of use as a URL) and D10 (no live listeners yet → single branch). He also
confirms the merge target is `dev`.

## Phase 0 — Preconditions and design

### S0 — Preconditions and branch
- **Owner agent:** senior-dev-backend
- **What:** Confirm `git status` is clean on `dev`. If it isn't, halt; never stash, commit or
  discard someone else's work. Cut `feat/admin-settings`. Re-verify every §A.6 anchor and record any
  drift. Record the baseline: `uv run pytest -q --tb=line | tail -5`, `npm run verify` in
  `admin_portal/`, `npx tsc --noEmit` and `npx jest` in `mobile/`.
- **Files / scope:** none modified.
- **Verification:** the branch exists, the baseline is green (or pre-existing failures are
  listed), and the anchor table is confirmed in the status entry.
- **Status update:** `## ADMIN-SETTINGS — S0 preconditions + branch`

### S1 — Test strategy
- **Owner agent:** qa-strategist
- **What:** Write the test matrix for every step and map each DoD bullet to named cases. Rules:
  real Postgres (`pg_client`) for anything dialect- or concurrency-dependent, the SQLite `client`
  only where behaviour is dialect-neutral, no ORM/session mocking, real Redis where cache/ETag
  behaviour is asserted, Vitest+MSW for the admin portal, Jest for mobile. **Must cover:**
  concurrent `record_progress` pings (first-play race, a restart racing a forward ping, a
  completion transition hit by two pings) asserting exactly-once rollup deltas; audit/mutation
  atomicity (inject an audit insert failure → mutation rolled back); login fail-open; the
  no-request-path-work check for `auth.login_failed`; PATCH 409 race; cache invalidation and 304;
  the role matrix per endpoint; 366-day cap and half-open boundaries; distinct listeners across
  week/month buckets; CSV BOM and formula guard; UNION filter correctness per category; all three
  migration round-trips; mobile fallback when offline, on error and on first launch.
- **Files / scope:** none modified. Named test files: `tests/test_usage_rollups.py`,
  `tests/test_audit_log.py`, `tests/test_audit_auth_events.py`, `tests/test_admin_audit.py`,
  `tests/test_church_settings.py`, `tests/test_analytics_report.py`,
  `tests/test_migrations_admin_settings.py`.
- **Verification:** every DoD bullet maps to at least one case. The Conductor checks this before
  dispatching S3.
- **Status update:** `## ADMIN-SETTINGS — S1 test strategy` (the full matrix goes in the body).

### S2 — Visual design for the three Settings screens and the mobile legal rows
- **Owner agent:** ui-designer
- **What:** Using existing `components/portal` and `components/charts` primitives only, design
  the shared `/settings` layout (sub-nav, with tabs hidden per role), the profile form (sections,
  `version` conflict banner, dirty-state guard), the audit table (filter bar with the staff-only
  default, row summary, details drawer) and the reports screen (preset ranges, granularity
  control, KPI tiles, series chart, top-sermons table, the "Data available from" notice, and an
  export menu for admins only). Mobile: two `me.tsx` rows that open in the browser. Can run in
  parallel with Phase 1.
- **Files / scope:** design notes in the status entry. Mockups go only under
  `docs/design_admin_portal/` if the repo convention calls for them.
- **Verification:** every §A.5 field has a home on a screen, and no new component primitive is
  introduced without a named second use.
- **Status update:** `## ADMIN-SETTINGS — S2 visual design`

## Phase 1 — Usage rollups (earliest, because they start counting at deploy)

### S3 — Rollup models and migration
- **Owner agent:** senior-dev-backend
- **What:** Add the `SermonPlayDaily` and `ListenerDay` models and migration 1 (§A.4). Add the
  round-trip test.
- **Files / scope:** `app/models/models.py` (new classes after `PlaybackSession` L697), one new
  `alembic/versions/*.py`, `tests/test_migrations_admin_settings.py`.
- **Verification:** the round-trip test passes against `throwaway_db`. `alembic check` reports no
  drift. The full suite is green (SQLite `create_all` still boots).
- **Status update:** `## ADMIN-SETTINGS — S3 rollup schema`

### [HUMAN_GATE AS1] — Rollup migration
Isaac reviews the migration file. Crossing this authorises S4.

### S4 — Write rollup deltas inside `record_progress`
- **Owner agent:** senior-dev-backend
- **What:** In the same transaction as the existing upsert (before L172), derive this ping's deltas:
  `plays += 1` on first insert or on a restart, `completions += 1` only on a false→true
  transition, `watched_seconds += watched_delta`. Upsert-increment `sermon_play_daily` for
  `(today UTC, sermon_id)`, and insert `listener_day` `ON CONFLICT DO NOTHING`. Deriving the
  deltas requires pre/post state that the current upsert computes SQL-side and never exposes
  (§A.6). Choose **either** a `RETURNING` that exposes the prior state (a CTE, or `xmax = 0` for
  insert detection) **or** a `SELECT … FOR UPDATE` pre-read, and justify the choice in the status
  entry. Constraints: the existing `playback_sessions` semantics (restart threshold, max-position,
  sticky completion) must not change; both dialect arms must keep working, with correctness proven
  on Postgres; no Python read-modify-write on any counter. Hot-row note: a popular sermon on a
  Sunday concentrates increments on one `sermon_play_daily` row (20s pings × concurrent
  listeners). Measure and report it, but don't optimise it speculatively.
- **Files / scope:** `app/services/analytics_service.py` (`record_progress` only),
  `tests/test_usage_rollups.py`.
- **Verification:** the S1 concurrency cases pass on `pg_client`.
  `tests/test_analytics.py` passes unchanged. The full suite is green. Report the p50/p95 of a
  local ping loop before and after.
- **Status update:** `## ADMIN-SETTINGS — S4 record_progress rollups`

### S5 — Concurrency review of the hot path
- **Owner agent:** qa-strategist
- **What:** Independently review S4's delta derivation and tests for missed interleavings (lock
  ordering between `playback_sessions` and `sermon_play_daily`, deadlock potential, and a restart
  vs completion in one ping). Add or request cases.
- **Files / scope:** read-only, apart from test additions in `tests/test_usage_rollups.py`.
- **Verification:** no open findings, or the findings are fixed by senior-dev-backend and
  re-verified.
- **Status update:** `## ADMIN-SETTINGS — S5 hot-path review`

### [HUMAN_GATE AS2] — `record_progress` behaviour change
Isaac approves changing a write that every active player hits every 20s, based on the S4 timings
and the S5 verdict. If D10 turns out wrong, this is where he can tell the Conductor to merge
Phase 1 early.

## Phase 2 — Audit trail

### S6 — `audit_log` schema, `audit_service.record`, retention purge
- **Owner agent:** senior-dev-backend
- **What:** Add the `AuditLog` model, the `AuditAction` and `AuditOutcome` StrEnums (D8) and
  migration 2. Add `app/services/audit_service.py` with `AuditContext` and
  `record(db, action, *, actor, target, details, outcome, ctx)`. `record` **adds and flushes**
  the row, and never commits. Add a `record_detached(...)` helper for fail-open events: it opens
  its own session, commits, and on any exception logs `audit_write_failed` and returns. Add
  `app/scripts/purge_audit_log.py` and the §A.7 settings fields with the values Isaac approved.
- **Files / scope:** `app/models/models.py`, a new migration, `app/services/audit_service.py`,
  `app/core/config.py` (two retention fields), `app/scripts/purge_audit_log.py`,
  `tests/test_audit_log.py`, `tests/test_migrations_admin_settings.py`.
- **Verification:** the round-trip passes. CHECK rejects an unknown action on Postgres. `details`
  JSONB and `ip` INET round-trip on Postgres, and SQLite still boots. The purge deletes or nulls
  exactly at the boundary. The suite is green.
- **Status update:** `## ADMIN-SETTINGS — S6 audit schema + service`

### [HUMAN_GATE AS3] — Audit migration and retention
Isaac reviews the migration and the purge script, with the retention values as implemented.

### S7 — Instrument staff mutations (same transaction)
- **Owner agent:** senior-dev-backend
- **What:** Add `user.staff_invited`, `user.invite_resent`, `user.role_changed`,
  `user.deactivated` and `user.reactivated` at the §A.3 anchors, before each existing
  `db.commit()`. Routers build `AuditContext` and pass it through. Service signatures gain one
  `ctx` parameter and nothing else changes. Revoke-ordering in `change_role` (L544–554) and
  commit-first semantics in `set_active` must stay exactly as they are.
- **Files / scope:** `app/services/auth_service.py` (the four functions only),
  `app/api/admin_auth.py`, `tests/test_audit_log.py`.
- **Verification:** each mutation writes exactly one row with correct before/after. An injected
  audit failure rolls back the mutation (`pg_client`). The existing `tests/test_admin_*` and
  `tests/test_last_admin_concurrent.py` pass unchanged.
- **Status update:** `## ADMIN-SETTINGS — S7 staff mutation audit`

### S8 — Instrument the auth path; fix and verify client IP/UA through the BFF
- **Owner agent:** senior-dev-backend (backend), then senior-dev-frontend (BFF UA forward)
- **What:** Backend: write `auth.login` (password + both OAuth routes) and `auth.logout` with
  `record_detached` after success. `auth.password_changed` and `auth.password_reset` are
  same-transaction inside the service. On `auth.login_failed`, the router adds a `BackgroundTasks`
  job (email, ctx), and that job looks up the account and writes the row only if it exists. The
  request path does **no** extra DB work. BFF: forward the browser `User-Agent`, stripped of CR/LF
  and truncated to 512, on the auth routes (`app/api/auth/login/route.ts`, `refresh`, `logout`) via
  `lib/auth/upstream.ts`/`proxy.ts`. Verification task (not an assumption): in docker-compose
  with `CLIENT_IP_HEADER` set on the portal and the BFF's address in `TRUSTED_PROXIES`, log in via
  the portal and confirm the `audit_log.ip` and `user_agent` values are the browser's; then unset
  them and confirm the fallback plus the `client_ip_fallback` warning. Record both results. If
  docker-compose doesn't currently set these variables, document the required values (S14 puts
  them in `DEPLOYMENT.md`). Don't change `net.py` unless the verification fails. If it does fail,
  halt.
- **Files / scope:** `app/api/auth.py`, `app/services/auth_service.py` (`change_password`,
  `reset_password` only), `app/services/oauth_service.py` (expose `new_account` only, with no
  logic change), `admin_portal/lib/auth/{upstream,proxy}.ts` and the three auth route handlers,
  `tests/test_audit_auth_events.py`, matching admin portal tests.
- **Verification:** `tests/test_auth.py`, `test_auth_hardening.py` and `test_oauth.py` are
  unchanged and green. A forced audit failure still returns 200 with tokens. An unknown email
  writes no row. The known-email failure row appears only after the response, and the test
  asserts no `audit_log` query runs inside the request. The portal `npm run verify` is green.
  The IP/UA verification results are in the status entry.
- **Status update:** `## ADMIN-SETTINGS — S8 auth audit + IP/UA`

### S9 — Security review: auth instrumentation and audit storage
- **Owner agent:** security-reviewer
- **What:** Review S6–S8 for these issues: an enumeration or timing oracle via `auth.login_failed`;
  PII in `details` (no passwords, tokens or reset links; is the email snapshot acceptable?);
  header injection via the forwarded UA; spoofable IPs (`trusted_proxies` breadth, the
  `trusted_proxies_are_scoped` validator at `config.py` L413); whether fail-open can mask a
  brute-force burst (structlog error volume is the signal); and whether the retention purge is
  correct.
- **Files / scope:** read-only.
- **Verification:** no blocking findings, or the owning executor fixes them and they're
  re-verified.
- **Status update:** `## ADMIN-SETTINGS — S9 security review (auth/audit)`

### [HUMAN_GATE AS4] — Login-path instrumentation
Isaac approves the auth-path changes, the BFF header forward and the IP/UA verification results,
based on the S9 verdict.

### S10 — Audit read service and `GET /admin/audit`
- **Owner agent:** senior-dev-backend
- **What:** Build the `UNION ALL` over `audit_log` and the three domain logs (D9), normalised to
  `(source, id, created_at, action, outcome, actor_id, actor_label, actor_role, target_type,
  target_id, target_label, details)`. Apply the filters, ordering `(created_at DESC, id DESC)` and
  `Page[T]` paging. Build `summary` in Python from a per-action template. `staff_only` means
  `actor_role IN (editor, manager, admin)` for `audit_log` rows, and legacy rows (always staff
  actors) pass. The router is `app/api/admin_audit.py` (AdminOnly), registered in `main.py`.
- **Files / scope:** `app/services/audit_service.py`, `app/api/admin_audit.py`,
  `app/models/content_schemas.py` (`AuditEntry`), `main.py`, `tests/test_admin_audit.py`.
- **Verification:** per-category, actor, target, outcome and date filters each return exactly the
  expected rows across all four sources on `pg_client`. `total` matches the filtered count. A
  manager gets 403 and an editor gets 403. The suite is green.
- **Status update:** `## ADMIN-SETTINGS — S10 audit read API`

## Phase 3 — Church settings

### S11 — `church_settings` schema and seed
- **Owner agent:** senior-dev-backend
- **What:** Add the `ChurchSettings` model and migration 3 (§A.4), with the seed row copied
  verbatim from `commentsCompliance.ts`. The test asserts the seeded `comment_guidelines` equals the
  file's string (read the TS file and extract the template literal in the test, so drift fails
  loudly).
- **Files / scope:** `app/models/models.py`, a new migration, `tests/test_migrations_admin_settings.py`.
- **Verification:** the round-trip passes. `CHECK (id = 1)` rejects a second row. The seed matches
  byte-for-byte. `alembic check` is clean.
- **Status update:** `## ADMIN-SETTINGS — S11 church_settings schema`

### [HUMAN_GATE AS5] — Church settings migration
Isaac reviews the migration and the seeded values.

### S12 — Settings service and the three settings endpoints
- **Owner agent:** senior-dev-backend
- **What:** Add `app/services/settings_service.py` (`get`, `get_public` via cache-aside,
  `update` with the optimistic lock + `settings.updated` audit row in the same transaction, and
  invalidation after commit). Add the DTOs and the routers per §A.5, including ETag/304 on the
  public route.
- **Files / scope:** `app/services/settings_service.py`, `app/api/admin_settings.py`,
  `app/models/content_schemas.py`, `main.py`, `tests/test_church_settings.py`.
- **Verification:** every S1 settings case passes, including the 409 race on `pg_client`, 304 with
  real Redis, 200 when Redis is down, and rollback on audit failure. Editor PATCH gets 403 and
  manager PATCH gets 200.
- **Status update:** `## ADMIN-SETTINGS — S12 settings API`

## Phase 4 — Reports API

### S13 — Report and CSV export endpoints
- **Owner agent:** senior-dev-backend
- **What:** Implement §A.5's two report routes in `analytics_service.py`/`analytics.py`. Bucket
  edges are built in Python, with one query per measure over the edges (the `new_listeners_weekly`
  pattern, L376), not one query per bucket. Distinct listeners per bucket come from `listener_day`.
  The export writes `report.exported` and commits **before** streaming the body (fail-closed). The
  CSV writer applies the formula guard to every text cell and is unit-tested directly.
- **Files / scope:** `app/services/analytics_service.py` (new functions only, `record_progress`
  untouched), `app/api/analytics.py`, `app/models/content_schemas.py`,
  `tests/test_analytics_report.py`.
- **Verification:** day/week/month totals reconcile with the seeded daily rows. A 367-day range gets
  422. A listener active on two days of one week counts once for that week. A title of
  `=HYPERLINK(...)` exports as `'=HYPERLINK(...)`. The BOM is present. A manager gets 200 on the
  report and 403 on export. The suite is green.
- **Status update:** `## ADMIN-SETTINGS — S13 reports API`

## Phase 5 — Contract

### S14 — ADRs 0017–0019, DEPLOYMENT.md, plans index
- **Owner agent:** scribe
- **What:** `0017-church-settings-public-contract.md` covers the single-row table, the public
  unauthenticated endpoint plus caching/ETag, D2/D2a, D3, and the mobile fallback rule.
  `0018-system-audit-log.md` covers the catalog, the transaction rules (atomic vs fail-open vs
  fail-closed), the `UNION ALL` read model, IP/UA capture and the §A.7 retention as approved, and
  the privacy-policy disclosure note. `0019-usage-rollups-and-reports.md` covers the rollup design,
  forward-only data, the role split D1, and the CSV guard. In `DEPLOYMENT.md`, add
  `CLIENT_IP_HEADER`/`TRUSTED_PROXIES` requirements (from S8) and the purge-script schedule. Add
  the `plans/README.md` row for this plan.
- **Files / scope:** three new ADRs, `DEPLOYMENT.md`, `plans/README.md`. No other ADR is edited.
- **Verification:** ADR headings match `0016`'s (`Context / Decision / Consequences /
  Alternatives considered`). `git diff --stat docs/adr` shows only the three new files.
- **Status update:** `## ADMIN-SETTINGS — S14 ADRs + docs`

### S15 — Regenerate the contract
- **Owner agent:** noob-dev
- **What:** Run `uv run python -m app.scripts.dump_openapi`, then `npm run gen:api` in
  `admin_portal/` and `mobile/`. Typecheck both.
- **Files / scope:** `openapi.json`, `admin_portal/lib/api/schema.d.ts`, `mobile/lib/api/schema.d.ts`.
- **Verification:** `git diff --stat` touches only those three files. The diff adds only the §A.5
  paths and DTOs. Both `tsc --noEmit` runs are green.
- **Status update:** `## ADMIN-SETTINGS — S15 contract regen`

### S16 — Backend code review
- **Owner agent:** reviewer-gilfoyle
- **What:** Review the backend diff S3–S13 for correctness, the transaction boundaries in §A.3,
  dialect handling, scope creep beyond §A, and abstractions introduced without a second use.
- **Files / scope:** read-only.
- **Verification:** no blocking findings, or findings fixed and re-verified. Full suite green.
- **Status update:** `## ADMIN-SETTINGS — S16 backend review`

### [HUMAN_GATE AS6] — Public API contract
Isaac approves the six new endpoints (§A.5), in particular the **unauthenticated**
`GET /settings/public`, along with ADRs 0017–0019 and the regenerated clients. Crossing this
authorises the client work.

## Phase 6 — Clients (after AS6)

### S17 — Admin portal: Settings layout, profile, audit and reports screens
- **Owner agent:** senior-dev-frontend
- **What:** Replace the placeholder `app/(portal)/settings/page.tsx` with a redirect to
  `/settings/profile`. Add the shared `settings/layout.tsx` and three routes:
  `profile/page.tsx` (`requireRole("manager")`), `audit/page.tsx` (`requireRole("admin")`) and
  `reports/page.tsx` (`requireRole("manager")`, with export rendered only for admins). The
  backend still enforces every guard. Query hooks go in `lib/query/hooks/` (`use-church-settings.ts`,
  `use-audit-log.ts`, `use-usage-report.ts`) with keys in `lib/query/keys.ts`. Handle the PATCH 409
  with a reload-and-reapply banner. Export downloads through the BFF as a file. Follow the S2
  design, and leave `nav-config.ts` L86 as-is (it already points to `/settings`).
- **Files / scope:** `admin_portal/app/(portal)/settings/**`, `admin_portal/components/settings/**`
  (new), the three hooks, `lib/query/keys.ts`, `admin_portal/tests/settings/**`.
- **Verification:** `npm run verify` is green. DOM tests cover these cases: a manager sees no
  audit tab, gets a 404 on `/settings/audit` and sees no export control; the 409 banner; the staff-only
  default filter; and the "Data available from" notice.
- **Status update:** `## ADMIN-SETTINGS — S17 admin portal`

### S18 — Mobile: consume public settings, add legal link rows
- **Owner agent:** mobile-developer
- **What:** Add `lib/query/hooks/useChurchSettings.ts` (persisted, long `staleTime`, no auth
  needed). `me.tsx` takes "Contact us" from `settings.contact_email ?? CONTACT_EMAIL`. `TermsSheet`
  takes its text from `settings.comment_guidelines ?? COMMENTS_TERMS_TEXT`, keeping the title/body
  split. Add "Terms of use" and "Privacy policy" rows that render only when their URL is non-null
  and open via `Linking.openURL`. `commentsCompliance.ts` stays as the fallback. **Do not delete
  it** (App Store guideline 1.2 needs contact info offline). Update its header comment to say so.
- **Files / scope:** `mobile/lib/query/hooks/useChurchSettings.ts`, `mobile/app/(tabs)/me.tsx`,
  `mobile/app/player/_comments/TermsSheet.tsx` (and `CommentsPanel.tsx` only if the text is
  threaded through it), `mobile/lib/content/commentsCompliance.ts` (comment only), their tests.
- **Verification:** `tsc --noEmit` and jest are green. Tests cover these cases: server values
  shown, offline/error falls back to constants, URL rows hidden when null, `openURL` called with
  the server URL. The existing `me.test.tsx` L361 contact test still passes.
- **Status update:** `## ADMIN-SETTINGS — S18 mobile`

## Phase 7 — Close-out

### S19 — Final review: code, security, coverage
- **Owner agent:** reviewer-gilfoyle, then security-reviewer, then qa-strategist
- **What:** Gilfoyle reviews the client diff (S17–S18). Security-reviewer covers the full branch:
  the public endpoint (data exposure, cache poisoning, ETag), CSV formula injection end-to-end
  through the BFF download, role gates on every route and screen, and URL-scheme validation on
  links the mobile app opens. Qa-strategist runs a coverage-gap assessment against the S1 matrix.
- **Files / scope:** read-only.
- **Verification:** no blocking findings, or findings fixed and re-verified. Backend suite, portal
  `npm run verify`, mobile tsc + jest and `pre-commit run --all-files` are all green on the branch
  head.
- **Status update:** `## ADMIN-SETTINGS — S19 final review`

### [HUMAN_GATE AS7] — Merge
Isaac reviews the branch and the S19 results and says go. Then there's one controlled merge of
`feat/admin-settings` into `dev`, no PR, with a conventional-commit merge message. `alembic upgrade
head` stays its own deploy step.

---

## Rollback

- **Before AS7:** abandon or reset `feat/admin-settings`. `dev` is untouched.
- **After AS7, before any deployed `upgrade`:** `git revert -m 1 <merge sha>`.
- **After deploy:** downgrade the three migrations in reverse (settings → audit → rollups). This is
  **destructive to data collected since deploy.** Rollup rows and audit rows can't be rebuilt, so
  export or snapshot `audit_log` before downgrading if it may be needed. The mobile app survives
  an absent `/settings/public` by design, because the fallback constants are kept. Reverting S4
  alone (code, no downgrade) stops rollup writes and leaves the tables in place.
- **Per-step failure:** the executor halts and logs `HALTED: <reason>`. Each step is its own commit
  (`feat:`/`chore:`/`docs:`), so it can be reverted without unwinding the others.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| K1 | Rollup delta derivation double-counts or misses under concurrent pings | Exactly-once tests on `pg_client` (S4), independent review (S5), gate AS2 |
| K2 | `auth.login_failed` reintroduces a timing oracle `authenticate` was built to avoid | Background write after response; test asserts no request-path audit query (S8); S9 |
| K3 | Audit failure blocks sign-in | `record_detached` fail-open + structlog error; forced-failure test |
| K4 | Recorded IPs are the BFF's, not users' | S8 verifies in docker-compose and documents required config (S14) |
| K5 | Seeded guidelines drift from the mobile constant | S11 test extracts the TS literal and compares |
| K6 | CSV formula injection via sermon titles | Guard on every text cell (S13), end-to-end check (S19) |
| K7 | Hot-row contention on `sermon_play_daily` during Sunday peaks | Measured in S4. Optimisation is a later plan only if the numbers warrant it |
| K8 | Retention ships without an approved number | §A.7 is decided at AS0. S6 halts if values are absent |
