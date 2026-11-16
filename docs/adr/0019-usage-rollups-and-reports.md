# ADR 0019 — Usage rollups and reports: forward-only daily aggregates, managers view, admins export

- **Status:** Proposed (flips to Accepted at `[HUMAN_GATE AS7]` merge to `dev`).
- **Date:** 2026-10-20
- **Scope:** Backend — `sermon_play_daily` and `listener_day` (migration `dbdcee764ca3`), the
  rollup writes inside `analytics_service.record_progress`, `analytics_service.usage_report`,
  `report_csv`/`csv_cell`, `GET /admin/analytics/report` and
  `GET /admin/analytics/report/export`. Admin portal — the `/settings/reports` screen (S17).
- **Deciders:** Isaac (+ planner, architect, senior-dev-backend, qa-strategist)
- **Relates to:** `plans/plan-admin-settings.md` §A.1 (D1, D4), §A.2, §A.4.1, §A.5; ADR 0018
  (`report.exported`).

> Managers can see plays, completions, watch time, listeners, new listeners and signups for any
> period up to a year, by day, week or month. Only admins can download it as CSV.

---

## Context

`playback_sessions` keeps one cumulative row per user and sermon: enough for "continue
watching" and lifetime totals, but it can't say how many plays happened last week. Reports
needed per-period numbers without an event stream, without slowing the progress ping every
active player sends every 20 s, and without SQL that only runs on Postgres (the default test
suite is SQLite).

## Decision

### 1. Two daily rollups written in the progress ping

`record_progress` derives this ping's deltas in the same transaction as its existing upsert:
`plays` on a first play or a restart, `completions` on a false-to-true transition, and
`watched_seconds`. It upserts `sermon_play_daily (day, sermon_id)` and inserts
`listener_day (day, user_id)` if missing. A first write is detected through Postgres conflict
arbitration (`INSERT … ON CONFLICT DO NOTHING RETURNING`), with a `FOR UPDATE` read only on
conflict, so concurrent pings count each play exactly once. This was reviewed for deadlocks
(fixed lock order, one writer) and measured: the slowest 5% of pings went from 49 ms to 113 ms,
far inside the 20 s interval.

### 2. Forward-only data, and the report says so

There is no history to rebuild the rollups from, so plays, completions and watch time exist only
from the day S4 is deployed. Every report returns `data_available_from` (the earliest rollup
day). New listeners (first play ever, from `playback_sessions.first_played_at`) and signups
(viewer accounts created) come from full-history tables and are accurate for any period. Both
rollups cascade on sermon/user delete, like `playback_sessions`, so erasing an account lowers past
totals.

### 3. Report shape

Periods are half-open `[from, to)` UTC dates (Ghana is UTC+0 with no DST, so there is no `tz`
parameter), at most 366 days. Bucket edges are computed in Python: days, ISO Mondays or the 1st
of each month, with the first and last buckets clipped to the period, so the buckets always add
up to the totals. Each measure is one conditional-aggregate query over the edges, with no
`date_trunc`. Distinct listeners are a `COUNT(DISTINCT)` per bucket and for the whole period,
never a sum of daily counts.

### 4. Role split (D1) and on-demand only (D4)

Managers and admins can view `GET /admin/analytics/report`; only admins can call the export.
Reports are generated on request; there is no scheduled or emailed delivery.

### 5. CSV export

`kind=timeseries|top_sermons`, UTF-8 with a BOM (so Excel opens it as UTF-8), CRLF line endings,
`Content-Disposition: attachment`. Every cell goes through the OWASP formula guard the admin
portal already uses for its subscriptions CSV (a leading `= + - @`, tab or CR gets a `'`
prefix), then RFC 4180 quoting. Sermon titles are editor-controlled, so a title like
`=HYPERLINK(…)` must never execute when the file is opened. The export is fail-closed on its
audit row (ADR 0018).

## Consequences

- **Positive:** per-period reporting with no event pipeline, two small tables, and the same SQL on
  SQLite and Postgres. Report queries scan at most a year of daily rows.
- **Negative / accepted:** no plays/completions/watch time before S4's deploy date. `listener_day`
  is per-user daily activity, which is personal data, kept as long as reports need it (§A.7); the
  privacy policy should cover it. A popular sermon concentrates increments on one
  `sermon_play_daily` row on a busy day; measured clean at 15 concurrent listeners, not optimised
  further.
- **Follow-ups:** S17 (portal screen). Per-sermon unique listeners would need a third rollup;
  not in v1.

## Alternatives considered

- **An append-only play event table:** rejected. Far more storage and aggregation cost for
  questions the daily rollups already answer.
- **Rollups built by a nightly job from `playback_sessions`:** rejected. Cumulative rows can't be
  split back into days; the nightly diffing would be fragile and still lose same-day restarts.
- **`date_trunc`/SQL week functions:** rejected. Postgres-only, and the default suite runs SQLite.
- **Managers can export too:** rejected by Isaac (D1). Export moves data out of the system, so it
  stays with admins and is audited.
