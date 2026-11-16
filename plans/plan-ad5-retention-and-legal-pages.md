# Plan: AD5 prerequisites — 30-day audit IP/UA retention + public legal pages

Two prerequisites for `[HUMAN_GATE AD5]` of the account-deletion initiative
(`plans/plan-account-deletion-backend.md`, `plans/plan-account-deletion-clients.md`).

- **Part A (R-steps): retention.** A small backend change. It runs and merges on its own and
  doesn't wait on Part B's content gate.
- **Part B (L-steps): legal pages.** Public pages on the admin portal, plus a Legal group in the
  mobile Me tab. The text is blocked on facts only Isaac has.

Decisions are Isaac's from chat on 2026-10-30, recorded in `status.md` under "ACCOUNT-DELETION —
D15 on-device verification (partial)". Execution is logged in the append-only root `status.md`
with the prefix `AD5-PREREQ`, one `## AD5-PREREQ — <step> <agent: …> <date>` heading per step.

Executors halt **only** at gates. If something diverges from this plan, they halt and the Conductor
decides whether to amend. **No schema change is expected.** If one shows up, it's a new gate:
halt.

---

## Goal

Every `audit_log` row loses its `ip` and `user_agent` once it's 30 days old, and the 90-day
comment-snapshot purge runs. Both are driven by an in-process daily task that's safe with many
instances, and both are live on Render dev. RhemaPod also has public pages for Privacy, Terms and
Support on the admin portal (`admin.rhemapod.com`). Their text is accurate to the code, written for
Ghana (Act 843), and reviewed by Isaac. The mobile Me tab links to them; the comment guidelines
stay in-app only.

## Definition of Done

- [ ] `purge_audit_log` nulls `ip`/`user_agent` on **all** rows older than
      `AUDIT_NETWORK_RETENTION_DAYS`, `auth.*` included. The default is 30. The 365-day `auth.*`
      delete is unchanged.
- [ ] An in-process daily retention task runs both purges. It is:
      - opt-in by config, and off unless enabled (tests never enable it);
      - non-blocking at startup;
      - single-runner across instances (Postgres advisory lock);
      - logging counts only.
- [ ] The ADR 0018 addendum records the two exceptions to append-only: viewer erasure (already
      there) and 30-day IP/UA nulling. §6 Retention is superseded for network data.
- [ ] Render dev runs the task: Isaac confirms a `retention_run` log line after merge.
      `.env.example`, `render.yaml`, `docker-compose.yml`, `DEPLOYMENT.md` and
      `DEPLOYMENT-RENDER.md` are all updated.
- [ ] Public, signed-out, static routes exist on `admin.rhemapod.com`: `/privacy`, `/terms`,
      `/support`. Each one links to the others and to `/delete-account`. There is **no** public
      `/guidelines` page (§B.2).
- [ ] The privacy text is written to Ghana's Data Protection Act 2012 (Act 843), names Watered
      Garden Church, Dansoman – Accra as data controller, and matches the L1 data inventory and
      the retention facts in §B.3. The Terms state 13+, Ghana law and courts, and IAP billing
      (§B.5). Isaac has reviewed every legal text (`[HUMAN_GATE P3]`).
- [ ] Mobile Me → Legal group: Privacy policy, Terms of use, Community guidelines (the in-app
      sheet).
- [ ] The `/delete-account` copy matches the new retention. ADR 0017 is unchanged.
- [ ] Green on the branch head:
      - backend `uv run pytest -q --tb=short`
      - portal `npm run verify`
      - mobile `npx tsc --noEmit` and `npx jest`
      - `pre-commit run --all-files`
- [ ] Merged into `dev` at `[HUMAN_GATE P1]` (Part A) and `[HUMAN_GATE P4]` (Part B).

## Constraints / Assumptions

- **Branch:** `feat/ad5-retention-legal`, off `dev`. Part A merges into `dev` at
  `[HUMAN_GATE P1]`. The branch then keeps going with Part B (merge `dev` back in first if `dev`
  has moved), and merges again at `[HUMAN_GATE P4]`. No PRs. Conventional commits. Push after
  each commit.
- **Merging into `dev` deploys to Render dev.** So P1 and P4 are deploy gates.
- **Schema:** verified by the planner on `feat/account-deletion` @ `5802413`. No change is needed:
  - `AuditLog.ip` (`_InetAsString`) and `AuditLog.user_agent` (`String(512)`) are already
    `nullable=True` (`app/models/models.py` ~L967–968).
  - `ix_audit_log_created_at_id` covers the age predicate.
  - `CommentModerationLog.body_snapshot` is already nullable.
- **No new dependencies.** The scheduler is `asyncio` plus SQL. The portal pages use what's
  already installed. Mobile keeps `Linking.openURL` (no `expo-web-browser`). If any step thinks it
  needs a dependency, halt.
- **Tests:** real Postgres via Testcontainers. No mocked session.
  - Backend command:
    `OBJECT_STORE_ACCESS_KEY_ID= OBJECT_STORE_SECRET_ACCESS_KEY= ARCHIVE_STORE_ACCESS_KEY_ID= ARCHIVE_STORE_SECRET_ACCESS_KEY= uv run pytest -q --tb=short`
  - Portal: `PATH=/usr/local/opt/node@24/bin:$PATH npm run verify` in `admin_portal/`. Next.js
    16.4: read `node_modules/next/dist/docs/` before using route or metadata APIs (see
    `admin_portal/AGENTS.md`).
  - Mobile: `npx tsc --noEmit && npx jest` in `mobile/`.
- **Not in scope:** the other sweeps that also don't run on Render free (`sweep_uploads`,
  `sweep_stream_jobs`, `expire_subscriptions`). Folding them in is a separate decision; see Risks.
  Admin-editable legal text is not in scope either. Nor are a public guidelines page (P2 answer 7),
  apex/prod domain work (pages stay on `admin.rhemapod.com`, P2 answer 6), App Store Connect
  metadata entry (Isaac, M10/M11), and cookie banners (the public pages set no cookies; L3
  verifies this).
- **Not in scope: an in-app age confirmation.** The app has no age gate, and the Terms will state
  13+ (P2 answer 3). Adding an age-confirmation step at sign-up is a separate client and possibly
  backend change; the planner recommends it as a follow-up, not part of this plan. The App Store
  and Play age ratings should match 13+ (Isaac, at M11).

---

## Part A — design (binding)

### A.1 Retention rule
`purge_audit_log()` drops the `~action LIKE 'auth.%'` exclusion from its nulling UPDATE. Every row
with `created_at < now - AUDIT_NETWORK_RETENTION_DAYS` and a non-null `ip` or `user_agent` gets
both nulled. The `AUDIT_NETWORK_RETENTION_DAYS` default goes from 365 to 30 (`ge=1` stays). The
`auth.*` 365-day hard delete (`AUDIT_AUTH_RETENTION_DAYS`) is unchanged. The cutoff stays strict,
matching the existing scripts.

### A.2 Where the code lives
Both purge functions move, behaviour-preserving, into `app/services/retention_service.py`. That
module also gets `run_retention_once(db, now=None) -> RetentionResult`, which:

1. opens one transaction;
2. takes `pg_try_advisory_xact_lock(<fixed bigint key, a named module constant>)`. If it doesn't
   get the lock, it returns `skipped=True` and changes nothing;
3. runs the audit purge and then the snapshot purge;
4. commits.

`app/scripts/purge_audit_log.py` and `app/scripts/purge_comment_snapshots.py` become thin CLI
wrappers around the service. They keep working for compose `ops` and for manual runs. The move is
justified because there are now two callers (CLI and scheduler) and `app/core` → `app/scripts`
would invert the dependency rule.

### A.3 Scheduler
`app/services/retention_scheduler.py` holds one `async` loop:

- Wait an initial delay: a module constant, about 60 s, plus random jitter of up to 30 s. Then
  run, then sleep 24 h, and repeat.
- Each run opens its own `PrimarySession`. Any exception is caught and logged as
  `retention_run_failed` with the exception type only, and the loop keeps going. A failed run
  never takes the API down.
- `main.py` `lifespan` starts the loop with `asyncio.create_task` **only if**
  `settings.retention_scheduler_enabled`, then yields straight away, so startup isn't blocked. On
  shutdown it cancels the task and awaits it.
- `RETENTION_SCHEDULER_ENABLED: bool = False` is a new setting. It's enabled in `render.yaml` and
  the compose `api` service. Tests never set it.

There's no interval setting. That's YAGNI: tests call `run_retention_once` directly.

### A.4 Logging
One `retention_run` info line per run:
- `audit_deleted`, `audit_network_nulled`, `snapshots_nulled`, `duration_ms`;
- or `skipped=true`.

No row contents, emails or IPs are ever logged. The CLI wrappers keep their existing log events.

### A.5 Render free caveat (documented, not solved)
Free web services spin down when idle, so the 24 h sleep rarely finishes. In practice it runs
about once per wake, after the initial delay. That's acceptable because the UPDATEs are idempotent
and lock-guarded. The real fix is a Render cron job or an ECS scheduled task when the app moves
off free. At that point the deployed env sets `RETENTION_SCHEDULER_ENABLED=false` and runs the
CLI. This goes in `DEPLOYMENT-RENDER.md` §8 and `DEPLOYMENT.md`.

---

## Part B — design (binding)

### B.1 Routes
New routes in `admin_portal/app/(public)/`, following the `delete-account/page.tsx` pattern: a
server component with no session, no data fetching, `Wordmark`, and a `metadata` title. All are
static TSX in the repo; a text change is a commit.

| Route | Content |
|---|---|
| `/privacy` | Privacy Policy (§B.3, §B.5) |
| `/terms` | Terms of Service (§B.5) |
| `/support` | contact@rhemapod.com, the delete-account link, the Apple manual-revoke pointer |

- A shared `_components/legal-nav` links the four public pages: `/privacy`, `/terms`,
  `/support`, `/delete-account`.
- Internal links are relative. The pages stay on `admin.rhemapod.com` for now (P2 answer 6); no
  apex-domain work.
- Each page shows an "Effective date" constant, and changing it is a commit.
- There's no `[PENDING`-style placeholder text. A DOM test asserts that none renders.

### B.2 Comment guidelines: no public page (P2 answer 7, option b)
`church_settings.comment_guidelines` stays the one source of truth: staff edit it in portal
Settings (ADR 0017, unchanged), `GET /settings/public` serves it, and mobile `TermsSheet` shows it
in-app, with `COMMENTS_TERMS_TEXT` in `mobile/lib/content/commentsCompliance.ts` as the offline
fallback (pinned by `tests/test_church_settings.py` and `tests/test_migrations_admin_settings.py`).

- There is **no** `/guidelines` route and no server fetch from the public pages.
- The Terms refer to the Community Guidelines "shown in the app before you first comment and
  available under Me → Legal", without copying the text.
- No ADR 0017 addendum. The `terms_of_use_url` / `privacy_policy_url` fields were always URLs;
  pointing them at portal routes is data, not a contract change.

### B.3 Privacy retention facts the text must state
| Data | Retention |
|---|---|
| Audit `ip`/`user_agent` | nulled after 30 days, on **all** audit rows (once Part A ships) |
| `auth.*` audit rows (sign-in events) | deleted at 365 days |
| Other audit rows | retained indefinitely; a deleted viewer's email (and target label) is removed (ADR 0018 addendum) |
| Moderation `body_snapshot` | 90 days |
| Backups | overwritten within 30 days |

**Correction to the D14 text** in `status.md`: it says "Security and audit log entries … are kept
for up to 365 days". That's wrong as a blanket statement. Only `auth.*` rows are deleted at 365
days. Other audit rows are retained indefinitely with the deleted viewer's email removed, and IP
address and user agent are nulled after 30 days on every row. L3 uses the corrected wording.
L1 still confirms which non-`auth` actions can carry a viewer as actor or target (for example
`account.deleted`), and whether `listener_day` (kept indefinitely per ADR 0019) is erased on
deletion via `USER_FKS`, so the text says exactly that.

Part B merges after Part A (P4 follows P1), so the 30-day statement is true when the page goes
live. If P4 is ever reached without P1, halt.

### B.4 Mobile
`SignatureYou.tsx` already shows "Terms of use" and "Privacy policy" rows, but only when the
server returns `terms_of_use_url` / `privacy_policy_url` (ADR 0017 D2, S18). Both are unset today.

- The rows move into a new **Legal** group: Privacy policy, Terms of use, Community guidelines
  (the existing in-app sheet).
- "Help & safety" keeps Contact us.
- The URLs stay server-driven. There's no compiled-in fallback URL.
- At `[HUMAN_GATE P4]`, Isaac (or the executor, on his approval) sets both URLs on dev via portal
  Settings → `https://admin.rhemapod.com/{privacy,terms}`. That's a data operation, reversible by
  clearing the field.

The support URL for App Store Connect is `https://admin.rhemapod.com/support`. It's metadata
Isaac enters in ASC, not an in-app row ("Contact us" already covers that in-app).

### B.5 Legal facts (answered at `[HUMAN_GATE P2]`, Isaac, 2026-10-30)
1. **Data controller / operator:** Watered Garden Church, Dansoman – Accra (Ghana).
2. **Governing law:** Ghana; disputes go to the courts of Ghana. The policy may say the church
   processes data in line with the Data Protection Act 2012 (Act 843), but must **not** quote any
   Data Protection Commission registration number.
3. **Minimum age:** 13, for using the app and for commenting. The Terms state 13+. There's no
   in-app age gate, and adding one is out of scope (follow-up). App Store / Play age ratings should
   match.
4. **Payments:** in-app purchase through Apple / Google. The Terms include an IAP billing section:
   - purchases are made through, and charged to, the user's App Store / Google Play account;
   - subscriptions auto-renew until cancelled;
   - manage or cancel in the store's subscription settings;
   - refunds follow Apple's / Google's policies (the church doesn't process them);
   - deleting a RhemaPod account does **not** cancel a store subscription (matches the
     account-deletion Screen 1 copy).

   Note: no IAP client exists yet (ADR 0016). The section describes how purchases work when
   offered; it must not claim any specific product or price.
5. **Regions:** Ghana only. The privacy policy is written to Act 843 (data subject rights of
   access, correction, objection and deletion; purpose limitation; security; the controller's
   contact). **No** GDPR or CCPA sections.
6. **Host:** `admin.rhemapod.com` for now.
7. **Guidelines:** option (b), §B.2.

---

## [HUMAN_GATE P0] — Plan approval
Isaac approves this plan, including §A.1–§A.5 and §B.1–§B.4. Nothing runs before this.

## Part A — Retention (independent of P2)

### R1 — ADR 0018 addendum (Proposed) + config docs
- **Owner agent:** scribe
- **What:** Append `## Addendum (2026-10-30): 30-day network-data retention` to
  `docs/adr/0018-system-audit-log.md`. It says:
  - `audit_log` is append-only with exactly two exceptions: viewer erasure (link the existing
    addendum) and nulling `ip`/`user_agent` on **every** row after `AUDIT_NETWORK_RETENTION_DAYS`
    (30).
  - It supersedes the network part of §6. The `auth.*` 365-day delete is unchanged.
  - It covers the in-process scheduler (§A.3) and its Render caveat (§A.5).

  Fix the stale 365 references in `DEPLOYMENT.md` (~L148) and in `.env.example`
  (`AUDIT_NETWORK_RETENTION_DAYS=30`, plus `RETENTION_SCHEDULER_ENABLED=false` with a comment).
  Add the §A.5 caveat to `DEPLOYMENT-RENDER.md` §8, and replace the "Audit rows / snapshots not
  purged" bullets.
- **Files / scope:** `docs/adr/0018-system-audit-log.md`, `DEPLOYMENT.md`,
  `DEPLOYMENT-RENDER.md`, `.env.example`
- **Verification:**
  - `grep -n "365" DEPLOYMENT.md .env.example docs/adr/0018-system-audit-log.md` shows 365 only
    for `auth.*` deletion.
  - `pre-commit run --files <changed>` is green.
- **Commit:** `docs(adr): ADR 0018 addendum — 30-day audit IP/UA retention`
- **Status update:** `[R1] <files, grep result>`

### R2 — Retention service + 30-day rule on all rows
- **Owner agent:** senior-dev-backend
- **What:** Implement §A.1 and §A.2:
  - create `app/services/retention_service.py` (the moved purge functions,
    `run_retention_once`, the advisory lock, a `RetentionResult` dataclass);
  - turn the two scripts into thin wrappers;
  - change the config default to 30.
- **Files / scope:** `app/services/retention_service.py` (new), `app/scripts/purge_audit_log.py`,
  `app/scripts/purge_comment_snapshots.py`, `app/core/config.py`,
  `tests/test_retention_service.py` (new), plus updates to `tests/test_purge_comment_snapshots.py`
  and to existing `purge_audit_log` tests (find them with `grep -ln purge_audit_log tests/`).
- **Verification:** Testcontainers Postgres covers:
  - an `auth.*` row at 31 days → ip/UA nulled and the row kept;
  - a non-`auth` row at 31 days → nulled;
  - a 29-day row → untouched;
  - an exact-boundary row → kept;
  - an `auth.*` row at 366 days → deleted;
  - snapshots at 91 and 89 days;
  - a second run → zero counts (idempotent);
  - the lock held on a separate connection → `skipped=True` and no rows changed;
  - `AUDIT_NETWORK_RETENTION_DAYS=0` → settings validation error.

  Then:
  - `uv run python -m app.scripts.purge_audit_log` and
    `uv run python -m app.scripts.purge_comment_snapshots` still exit 0 against compose Postgres;
  - the full backend suite, with the env-blanking prefix, is green;
  - `pre-commit run --all-files` is green.
- **Commit:** `feat(audit): 30-day ip/user-agent retention on all audit rows`
- **Status update:** `[R2] <pass/fail counts, test names>`

### R3 — In-process daily scheduler
- **Owner agent:** senior-dev-backend
- **What:** Implement §A.3 and §A.4:
  - `app/services/retention_scheduler.py`;
  - `retention_scheduler_enabled` in `app/core/config.py`;
  - the conditional start and cancel in `main.py` `lifespan`;
  - `RETENTION_SCHEDULER_ENABLED: "true"` in `render.yaml` (the `rhemapod-dev` group) and on the
    compose `api` service;
  - update the `comment-snapshot-purge` compose comment ("also runs in-process when enabled").
- **Files / scope:** `app/services/retention_scheduler.py` (new), `app/core/config.py`, `main.py`,
  `render.yaml`, `docker-compose.yml`, `tests/test_retention_scheduler.py` (new).
- **Verification:**
  - Tests drive `async with lifespan(app)` directly, with no new dependency:
    - flag off → no task created;
    - flag on, with the initial delay patched to 0 and the sleep patched → one run happens on real
      Postgres, and shutdown cancels it with no warnings and no pending task;
    - an exception raised inside a run → `retention_run_failed` is logged and the loop survives;
    - `structlog` capture shows that `retention_run` holds only the count keys from §A.4.
  - `rg -n "RETENTION_SCHEDULER_ENABLED" tests/ conftest.py` shows it's never set true globally.
  - Local `docker compose up api`: within ~90 s the log shows one `retention_run` line and
    `/health` answers before it.
  - Full suite and pre-commit are green.
- **Commit:** `feat(ops): in-process daily retention task for audit and comment snapshots`
- **Status update:** `[R3] <counts, compose log excerpt (event names + counts only)>`

### R4 — Part A review
- **Owner agent:** reviewer-gilfoyle, then security-reviewer (in parallel, on the R1–R3 diff)
- **What:** Gilfoyle checks correctness, the lock semantics, task lifecycle and cancellation, and
  dependency direction. Security checks:
  - nothing personal in the logs;
  - the nulling is complete (both columns, all actions);
  - the scheduler can't be triggered externally;
  - the failure mode doesn't fail open in a harmful way.
- **Files / scope:** read-only.
- **Verification:** both reports are in `status.md`. There are no open BLOCKER or HIGH findings.
  Fixes go back to R2 or R3 under the same commit conventions (`fix(audit): …`).
- **Status update:** `[R4] <verdicts, findings, fix commits>`

### [HUMAN_GATE P1] — Accept ADR 0018 addendum; merge Part A to `dev` (irreversible on Render dev)
Merging deploys to Render dev. The first run **irreversibly** nulls `ip`/`user_agent` on every
audit row older than 30 days in the dev database. Isaac approves the ADR addendum (Proposed →
Accepted), the R4 verdicts, and the merge.

After the merge, Isaac or the executor confirms one `retention_run` line in the Render logs and
records it in `status.md`. If Part B has started by then, it continues on the branch after
`git merge dev`.

## Part B — Legal pages

### [HUMAN_GATE P2] — Facts for the legal text — **ANSWERED 2026-10-30 (Isaac, in chat)**
All seven questions are answered; the answers are binding in §B.5 (and §B.2 for the guidelines).
L3 may run once `[HUMAN_GATE P0]` is crossed. Summary:

1. Data controller: Watered Garden Church, Dansoman – Accra (Ghana).
2. Governing law: Ghana, Ghana courts. No Data Protection Commission registration number in the
   policy.
3. Minimum age: 13 (app and commenting). Terms state 13+. In-app age confirmation is out of scope
   (follow-up); store age ratings should match.
4. Payments: Apple / Google in-app purchase; Terms include an IAP billing section (§B.5 item 4).
5. Regions: Ghana only. Privacy policy written to Act 843; no GDPR/CCPA sections.
6. Host: `admin.rhemapod.com` for now; no apex-domain work.
7. Guidelines: option (b). No public `/guidelines` page; guidelines stay staff-editable in portal
   Settings and in-app only; ADR 0017 unchanged.

### L1 — Data inventory (read-only, feeds the privacy text)
- **Owner agent:** scribe, with security-reviewer cross-checking the result
- **What:** Build an inventory of the personal data the system actually handles, with a
  file:line citation for each item. It covers:
  - `User` fields and social identities;
  - comments, reports, blocks, playlists, `listener_day` and listening history;
  - downloads (on device);
  - the audit `ip`/UA;
  - email (Resend);
  - storage (R2 live, AWS S3 Deep Archive);
  - Cloudflare Stream;
  - Redis tokens;
  - Google/Apple sign-in;
  - the hosting providers (Render now, AWS later).

  For each item, record the purpose, the retention, and whether account deletion erases it (from
  `USER_FKS` and `tests/test_user_fk_classification.py`). Settle the two §B.3 open points
  (non-`auth` viewer audit rows, and `listener_day` on deletion). Confirm there are no
  analytics/crash/push SDKs in `mobile/package.json` (the planner found none).
- **Files / scope:** read-only. Output goes in `status.md` under `## AD5-PREREQ — L1 data
  inventory`.
- **Verification:** every row cites code. security-reviewer appends "inventory complete:
  yes/no + gaps".
- **Status update:** `[L1] <inventory>`

### L2 — Page shell, nav, tests
- **Owner agent:** senior-dev-frontend
- **What:** Build §B.1:
  - the three routes, holding only headings and an obviously-draft body that the DOM tests
    reject;
  - `legal-nav`;
  - a link from `/delete-account` to the legal nav.

  No `/guidelines` route and no data fetching (§B.2).

  No legal prose is written here.
- **Files / scope:** `admin_portal/app/(public)/{privacy,terms,support}/page.tsx`,
  `admin_portal/app/(public)/_components/legal-nav.tsx`, and
  `admin_portal/app/(public)/delete-account/page.tsx` (the nav link only).
  Tests: `admin_portal/tests/public/legal-*.dom.test.tsx`.
- **Verification:**
  - DOM tests: each page renders signed out, has an h1 and a `legal-nav` with four links
    (`/privacy`, `/terms`, `/support`, `/delete-account`) whose `href`s are relative, and has no
    `PENDING`/`TODO`/`DRAFT` text. That last assertion is deliberately red until L3, so L2
    commits it as `it.todo` and L3 turns it on.
  - A test asserts `/guidelines` is not a route (no `app/(public)/guidelines/` directory).
  - `PATH=/usr/local/opt/node@24/bin:$PATH npm run verify` is green.
- **Commit:** `feat(portal): public legal page shell`
- **Status update:** `[L2] <test counts, build note>`

### L3 — Draft legal text (after `[HUMAN_GATE P2]`)
- **Owner agent:** scribe
- **What:** Write the Privacy Policy, the Terms of Service and the Support page from the P2
  answers, the L1 inventory, §B.3, and the D14 deletion text in `status.md` ("ACCOUNT-DELETION —
  D14 docs + privacy text"), with the §B.3 corrections applied.
  - Privacy: names Watered Garden Church, Dansoman – Accra as data controller; written to Act 843
    (rights of access, correction, objection, deletion; how to exercise them via
    contact@rhemapod.com); no DPC registration number; no GDPR/CCPA sections; audit retention in
    exactly the §B.3 wording (365-day deletion for sign-in events only; other audit rows retained
    indefinitely with the deleted viewer's email removed; IP/user agent nulled after 30 days on
    all rows).
  - Terms: 13+ minimum age (app and commenting); Ghana law and Ghana courts; the IAP billing
    section from §B.5 item 4 with no specific product or price; Community Guidelines referenced
    as shown in-app (Me → Legal), not copied (§B.2).
  - Plain language, no boilerplate filler.
  - Each page carries a visible "Effective <date>" line.
  - A code comment (not rendered) on each file says "Draft prepared with AI assistance; not legal
    advice; reviewed by Isaac on <date>". Isaac fills in the date at P3.
  - Turn the L2 `it.todo` into a live test.
  - Assert the retention numbers on `/privacy` the same way `delete-account.dom.test.tsx` does
    (30 / 30 / 90 / 365), and assert `/privacy` contains no "GDPR"/"CCPA"/registration-number
    text and `/terms` contains "13" and the store-cancellation sentence.
  - Confirm the pages set no cookies, so no banner is needed.
- **Files / scope:** the three static `page.tsx` files and their DOM tests.
- **Verification:**
  - DOM tests are green, and `npm run verify` is green.
  - A mechanical cross-check table in `status.md` maps each privacy claim to an L1 inventory row.
- **Commit:** `docs(portal): draft privacy policy, terms of service and support page`
- **Status update:** `[L3] <claim→inventory table, test counts>`

### L4 — Mobile Legal group, delete-account copy
- **Owner agent:** mobile-developer (mobile), senior-dev-frontend (delete-account copy). One step,
  two commits.
- **What:**
  - Mobile: §B.4, the regroup in `SignatureYou.tsx`. Rows still render only when their URL is
    set.
  - Portal: the `/delete-account` "What we keep" list adds "network details (IP address, device
    user agent) in security logs: 30 days", and its audit line uses the §B.3 wording. Update its
    DOM test.
  - No ADR 0017 change (§B.2).
- **Files / scope:** `mobile/app/(tabs)/_me/signature/SignatureYou.tsx` and its tests under
  `mobile/app/(tabs)/_me/__tests__/`; `admin_portal/app/(public)/delete-account/page.tsx`;
  `admin_portal/tests/public/delete-account.dom.test.tsx`.
- **Verification:**
  - Jest: the Legal group renders three rows when both URLs are set, and only Community
    guidelines when neither is. Tapping a row calls `Linking.openURL` with the server URL.
    "Contact us" is still in Help & safety.
  - `npx tsc --noEmit` and `npx jest` are green.
  - Portal `npm run verify` is green.
- **Commits:** `feat(mobile): Me → Legal group`, `fix(portal): delete-account page states 30-day
  network-data retention`
- **Status update:** `[L4] <counts>`

### L5 — Part B review
- **Owner agent:** reviewer-gilfoyle + security-reviewer (parallel), then briefer
- **What:**
  - Gilfoyle: the code and the tests.
  - Security: the public pages fetch nothing and leak nothing, set no cookies, and add no third-party scripts; the privacy claims match L1.
  - Briefer: compresses everything for Isaac's P3 review.
- **Files / scope:** read-only.
- **Verification:** no open BLOCKER or HIGH findings. Fixes are committed as `fix(...)`. Then
  backend, portal and mobile suites plus `pre-commit run --all-files` are green on the branch
  head.
- **Status update:** `[L5] <verdicts, final counts>`

### [HUMAN_GATE P3] — Isaac's legal review of the drafted text
Isaac reads `/privacy`, `/terms` and `/support`, from a local `npm run dev` or the
briefer's excerpt. The text is a **draft, not legal advice**. Isaac either approves it or returns
edits. Edits go back through L3 and L5. Nothing merges before approval. Isaac also dates the
"reviewed by" comment.

### [HUMAN_GATE P4] — Merge Part B to `dev` (deploy) + set Settings URLs
Precondition: `[HUMAN_GATE P1]` is crossed and `retention_run` has been seen on Render (the
privacy text's 30-day claim depends on it). Isaac approves the merge into `dev`, which deploys the portal and API to Render dev. After the
deploy:

1. Set `terms_of_use_url` and `privacy_policy_url` in portal Settings to the dev URLs (a data
   operation, audited as `settings.updated`).
2. Confirm all four public pages load signed out on a phone.
3. Confirm the Me → Legal rows open them.
4. Record everything in `status.md`.

Production enablement (App Store Connect privacy/support URLs, store age rating 13+) stays under
`[HUMAN_GATE AD5]` / M11.

## Rollback

- **Part A:**
  - Set `RETENTION_SCHEDULER_ENABLED=false` in Render and redeploy. That stops the task with no
    code change.
  - Reverting the R2 and R3 commits restores the 365-day default and the scripts.
  - **Data already nulled can't be restored.** Accepted at `[HUMAN_GATE P1]`.
  - No migration is involved.
- **Part B:**
  - Revert the L-commits. The pages are additive.
  - Clear the two Settings URLs, and the mobile rows hide themselves (existing behaviour). No
    app release is needed.

## Risks

- **Render spin-down** means about one run per wake, not a strict daily run (§A.5). That's
  acceptable for dev, and a cron job is required for prod.
- **First-run volume:** one unbatched UPDATE over the whole audit table. Fine at dev scale. If
  prod `audit_log` passes about 1M rows before cron lands, batch it (amendment).
- **Other unscheduled sweeps** (`sweep_uploads`, `sweep_stream_jobs`, `expire_subscriptions`)
  still don't run on Render. They're out of scope on purpose. Isaac can fold them into the same
  scheduler later with an amendment.
- **Guideline acceptance isn't versioned.** `comments_terms_accepted_at` doesn't record which
  text was accepted. That's true before this plan too, and it's noted for Isaac, not fixed here.
- **Legal exposure:** the text is AI-drafted. `[HUMAN_GATE P3]` is the control. Consider a
  lawyer's review before prod (Isaac's call).
