# Admin Settings S19 — Final review: clients, security, coverage

Plan: `plans/plan-admin-settings.md`, step S19. Scope: the client diff (S17 admin portal, S18
mobile), a security pass over the whole branch, and coverage against the plan's Definition of
Done.

Reviewer note: done by the agent that wrote S7–S18; no independent `reviewer-gilfoyle`,
`security-reviewer` or `qa-strategist` pass was run. Weigh it accordingly at
`[HUMAN_GATE AS7]`.

## Verdict

**No open blocking findings in this plan's code.** One real defect was found and fixed in S18
(finding 1). Two pre-existing mobile problems unrelated to this plan were found and have since been fixed
(finding 6).

---

## 1. FIXED in S18 — legal links would never have shown on a real phone

The first version of `safeHttpsUrl` (mobile) used `new URL(url).protocol`. React Native 0.76's
built-in `URL` throws "not implemented" from `protocol` and `hostname`, so on a device every link
would have been rejected and the Terms/Privacy rows silently hidden. Jest runs Node's full `URL`,
so every test passed. The check is now a pattern, and a test installs an RN-like `URL` to pin it.

## 2. Client review (S17, S18)

- **Portal state:** `useChurchSettings` writes the PATCH response into the cache, so the form
  re-bases on the new `version` with no refetch race. The form is a child seeded from props
  rather than an effect (lint rule `react-hooks/set-state-in-effect`).
- **409 handling** never retries automatically. Retrying with a fresh version is exactly the
  silent overwrite the version lock exists to stop.
- **`BarChart`** now keys bars by index, not label. Labels repeat across years ("Oct") and are
  blank when Reports thins a dense axis. The dashboard's only use (8 unique week labels) is
  unaffected; its tests pass.
- **Checked visually** in Chromium against a real backend at 1360 px and 390 px. The overlapping
  daily axis labels this found were fixed before commit.
- **Mobile:** `useChurchContent()` never returns empty values, so no screen has to handle "no
  settings". The `TermsSheet` placeholder gate now checks the text actually shown.

## 3. Security

| Check | Result |
|---|---|
| Public endpoint data exposure | `ChurchSettingsPublic` excludes `updated_by_id`/`updated_at`. Only fields meant for the app are public; ADR 0017 records that nothing private may be added. |
| Cache poisoning | The Redis key is fixed (`settings:public:v1`) and its value comes only from the DB row, never from request input. The response doesn't vary by caller, so `Cache-Control: public` is safe for shared caches even when a request carries `Authorization`. |
| ETag | `W/"<version>"`, derived from a server-side integer. `If-None-Match` is parsed as a list with weak comparison and never echoed. A stale cache can serve the old body with its matching old ETag for at most 300 s (S16 §4). |
| CSV injection, end to end | Downloaded through the BFF from a live stack: `Content-Disposition: attachment`, `text/csv; charset=utf-8`, BOM present, and a `=HYPERLINK("x","y")` sermon title arrives as `"'=HYPERLINK(""x"",""y"")"`. Unit-tested for `= + - @`, tab and CR leads. |
| Role gates, server | Every new route has a role-matrix test: settings read/write manager+, audit admin-only, report manager+, export admin-only; editors and viewers 403, anonymous 401. |
| Role gates, screens | `/settings` and each sub-route call `requireRole` (an editor 404s, a manager 404s on Audit trail). The Audit tab and the export links aren't rendered below the bar. DOM and route tests cover each. |
| URL schemes the app opens | The server accepts only absolute `https` URLs. The app re-checks with a pattern (finding 1) before `Linking.openURL`, so `javascript:`, `http:`, `mailto:`, `tel:`, userinfo and whitespace are all refused. |
| Secrets in the branch diff | The repo's `.githooks/pre-commit` patterns (AWS keys, Stripe live keys, PEM keys, `.env`) found nothing across all 75 changed files. |

**Accepted residual: the export is a GET that writes an audit row.** `rp_at` is `SameSite=Lax`,
so a top-level navigation from another site to the export URL sends the admin's cookie. The
browser downloads a file the attacker can't read, and one `report.exported` row is written. No
data leaves the system, and the row records it. Making export a POST would break the plain
download link for no confidentiality gain.

## 4. Coverage against the Definition of Done

| DoD bullet | Evidence |
|---|---|
| Public settings: 200 unauthenticated, weak ETag, 304, cache-aside, 200 with Redis down | `tests/test_church_settings.py` (FakeRedis and real Redis variants) |
| PATCH: stale 409, `settings.updated` same transaction, rollback on audit failure (Postgres), cache invalidated after commit | `tests/test_church_settings.py` (incl. 4 concurrent PATCHes → one 200) |
| Role matrix for settings, audit and report routes | `test_church_settings.py`, `test_admin_audit.py`, `test_analytics_report.py` |
| Every §A.3 event at its call site; atomic; logins fail-open | `tests/test_audit_log.py` (S7), `tests/test_audit_auth_events.py` (S8), report/settings tests |
| `auth.login_failed` only for real accounts; status, body and latency indistinguishable | `test_audit_auth_events.py` (SQL trace, Argon2 spy); live timing 66.7 vs 66.3 ms (S9 review) |
| `GET /admin/audit` merges four sources, every filter, `summary` | `tests/test_admin_audit.py` (Postgres + SQLite smoke) |
| Rollup deltas exactly once under concurrency; `test_analytics.py` unchanged | `tests/test_usage_rollups.py` (S4/S5) |
| Report shape, 366-day cap, granularity, distinct listeners; CSV BOM, guard, `report.exported` | `tests/test_analytics_report.py` |
| Browser IP and UA recorded through the BFF | Verified live on Postgres + uvicorn + `next dev` with `CLIENT_IP_HEADER`/`TRUSTED_PROXIES` (S9 review). Not run in docker-compose itself: compose has no portal service. |
| Alembic round trip and no drift | `tests/test_migrations_admin_settings.py` |
| Contract and clients regenerated, additions only | S10/S12/S13/S15 commits |
| Portal `/settings` redirect, per-route guards, admin-only export | `admin_portal/tests/settings/*`, `tests/portal/settings-page.test.tsx` |
| Mobile server values, fallbacks, rows hidden when unset | `mobile/lib/query/hooks/__tests__/useChurchSettings.test.ts`, `me.test.tsx`, `TermsSheetServerText.test.tsx` |
| Suites green | Backend 1793 passed / 1 skipped (S16, against real Postgres and Redis; S17–S18 changed no backend code). Portal `npm run verify` green (822). Mobile `tsc`, jest (1010) and lint green after the finding 6 fixes. |
| ADRs 0017–0019, plans index row | S14 |

**Gaps, not blocking:** restoring a persisted settings response after an app restart relies on
the app's existing TanStack persister (default-persisted, 24 h) and isn't tested specifically.
The S1 test matrix lived in the uncommitted `status.md`, so this table maps to the DoD instead.

## 5. Scope

No client change outside the plan's file list except `admin_portal/components/charts/BarChart.tsx`
(index keys, finding 2) and `admin_portal/tests/portal/settings-page.test.tsx`, which tested the
placeholder S17 replaced. `nav-config.ts` is untouched.

## 6. Pre-existing, outside this plan — since fixed

- **Mobile jest:** `app/(tabs)/__tests__/announcements.test.tsx` failed to parse because the
  screen had gained `useRouter`/`useSafeAreaInsets` after the test was written, so the real
  `expo-router` (and `expo-linking`'s ESM build) loaded. Fixed in a follow-up commit by mocking
  both, as `me.test.tsx` does. All 154 suites (1010 tests) now pass.
- **Mobile lint:** 19 errors, now 0. Metro asset `require()` is allowed by config, `require()`
  inside `jest.mock` factories is allowed in tests, two disable comments for an uninstalled
  `react-hooks` rule became plain comments, and four genuinely unused variables were removed.
- **`pre-commit run --all-files`:** the repo has no `.pre-commit-config.yaml` and no `pre-commit`
  install, so this step can't run as written. The repo's actual hook was applied to the branch
  diff instead (§3).
