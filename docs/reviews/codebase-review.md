# Codebase review — everything except the auth surface

Reviewer: Gilfoyle. Scope: `app/` minus the seven already-reviewed auth files. Lens: code quality
and correctness-as-security, not a full security audit.

## Verdict

**Request changes.** The architecture is sound and the layering is honest — thin routers, typed
domain errors translated at the boundary, real seams with stubs, a genuinely thorough config
preflight. But the entitlement signal and the catalog cache disagree after a `PATCH` to a
published sermon's tier, the playback-progress upsert has no upsert and will throw 500s and lose
watch-time under concurrency, and the subscription webhook handler mishandles re-activation and
mis-sources `valid_until` on checkout completion. None are architectural; all are contained. Fix
the two `Must` items and the webhook `Should` items and this ships.

---

## Findings, most severe first

### 🔴 MUST FIX

#### 1. `update_sermon` never busts the catalog cache — tier change on a published sermon leaves the catalog and the stream gate disagreeing
`app/services/content_service.py:316-344`

`update_sermon` writes any field on `SermonUpdate` — including `tier` — and commits without calling
`invalidate_catalog_cache()`. `update_series` gets this right (`tier_changed` guard at
`content_service.py:546-555`); `update_sermon` does not. A manager flips a published sermon from
`free` to `paid`: for up to `CATALOG_TTL_SECONDS` (300s) `/catalog/sermons` keeps serving the
cached row with the old `tier` and `locked=false`, while `/sermons/{id}/stream` reads the DB
directly and returns `403 upgrade_required`. The reverse (paid→free) shows `locked=true` on a
sermon that streams fine. This is exactly the "free in the catalog, paid at the stream endpoint"
failure.

**Fix:** in `update_sermon`, if the sermon is (or was) `PUBLISHED`, call
`await invalidate_catalog_cache()` after commit — mirror what `update_series` does. Cheap.

#### 2. `record_progress` has no upsert: 500s on the first-write race, lost watch-time on the update race
`app/services/analytics_service.py:40-86`

The function does `SELECT` → if `None` build a new `PlaybackSession` and `add` → else mutate. There
is a `UniqueConstraint("user_id", "sermon_id")` (`models.py:584-586`). Two concurrent progress
posts for the same user+sermon (two devices, two tabs, or one slow request overlapping the next
30-second ping) both see `None`, both insert, and the second commit raises `IntegrityError` that
nothing catches — the client gets a 500. On the update path, `session.watched_seconds +=
watched_delta` is a read-modify-write in Python against a `expire_on_commit=False` instance;
concurrent updates are last-write-wins and silently drop increments.

**Fix:** use `pg_insert(PlaybackSession).values(...).on_conflict_do_update(index_elements=[...],
set_={"watched_seconds": PlaybackSession.watched_seconds + delta, "position_seconds": ...,
"last_played_at": ...})` so the accumulation is a SQL expression and the conflict is handled in
one statement. If you must keep the ORM path, catch `IntegrityError`, `rollback`, re-`SELECT`, and
apply as an update.

---

### 🟡 SHOULD FIX

#### 3. Webhook: re-activation after a scheduled cancel is never reflected
`app/services/subscription_service.py:294-304`

`customer.subscription.updated` only handles the case where `cancel_at_period_end` is truthy
(sets `cancel_at_period_end=True`, `status=CANCELLED`). If the member un-cancels in the Stripe
portal, Stripe sends the same event with `cancel_at_period_end` false — and the handler does
nothing with the falsy branch. Our row stays `CANCELLED` with `cancel_at_period_end=True`
permanently. `entitlement_from_row` still grants access (CANCELLED is entitled), so the user
isn't locked out, but `/subscriptions/me` lies to them and `start_checkout` (finding 5) then
treats them as re-subscribable.

**Fix:** handle the falsy branch explicitly — `cancel_at_period_end=False` and, if the row was
`CANCELLED`, restore `ACTIVE`.

#### 4. Webhook: `checkout.session.completed` sets `valid_until` from the checkout session's `expires_at`
`app/services/subscription_service.py:264-268`

A `checkout.session.completed` object is a Checkout Session. It has no `current_period_end`, so the
`or obj.get("expires_at")` fallback fires — and `expires_at` on a Session is when the *checkout
link* dies (~24h from creation), not the subscription period end. `valid_until` is written ~24h
out. It's normally corrected by the near-simultaneous `invoice.paid`, but if that event is
delayed or dropped (the exact scenario `expire_lapsed` exists for), the safety-net sweep revokes
a paying member roughly a day after they subscribe.

**Fix:** on `checkout.session.completed` don't set `valid_until` from `expires_at` at all — leave
it to `invoice.paid` / `customer.subscription.updated`, or retrieve the subscription object and
read its real `current_period_end`.

#### 5. `start_checkout` lets a cancelled-but-still-entitled member open a second checkout
`app/services/subscription_service.py:119-138`

Guard is `if entitlement_from_row(sub) and not sub.cancel_at_period_end: raise`. A member who
cancelled (still entitled, `cancel_at_period_end=True`) passes the guard and gets a fresh Checkout
Session. Completing it creates a *second* provider subscription while the first is still winding
down. The single `Subscription` row tracks one `provider_subscription_id`; the webhook for the new
sub overwrites it, and the orphaned first subscription keeps emitting events that now either match
nothing or match by `user_id` and stomp state.

**Fix:** if `sub.cancel_at_period_end` is set, route re-subscribe through the billing portal
(un-cancel) rather than a new checkout, or explicitly cancel the old provider subscription before
creating the new one.

#### 6. Search `total` is counted before the tier filter — pagination breaks whenever `?tier=` is used
`app/services/search_service.py:115-141`

`total` is `SELECT count(*)` over `conditions`, which does **not** include tier (tier is inherited,
so it's resolved and filtered in Python at line 138 after the `limit`/`offset` query returns). With
a `tier` facet applied, `total` is inflated and a page can come back with fewer than `limit` items
while later pages still have content. The client's "showing X of Y" and pager are wrong.

**Fix:** resolve the tier filter in SQL. The effective tier is
`COALESCE(sermon.tier, series.tier, 'free')` — a `LEFT JOIN series` plus a `CASE`/`COALESCE`
predicate gets it into both the count and the page query. Then drop the Python post-filter.

#### 7. `series_episodes` hard-codes `has_subscription=False` — every paid episode shows locked to subscribers
`app/api/series.py:116-136`

The endpoint takes no user and calls
`to_list_item(s, effective_tier(s, series), has_subscription=False)`. Every other list view
(catalog, detail, search, continue-watching) resolves real entitlement. A subscriber browsing a
series sees `locked=true` on episodes they've paid for. Fail-closed, so not a bypass, but it's a
visible correctness defect and an inconsistency in the one signal the client branches on.

**Fix:** add `OptionalUser`, resolve `has_paid_access(db, user)` once, pass it through.

#### 8. Webhook idempotency: concurrent redelivery 500s instead of `duplicate_ignored`
`app/services/subscription_service.py:226-320`

`_already_processed` is a plain `SELECT`; the ledger row is inserted with `db.add` and only
persisted at the single `commit` at line 309. Two deliveries of the same `event_id` in flight
together both pass the check, both run the body, and the second `commit` hits
`uq_webhook_provider_event` → uncaught `IntegrityError` → 500 → provider retries. The double-apply
itself is contained (the losing transaction rolls back entirely), but the handler isn't actually
idempotent under concurrency, just under sequential redelivery.

**Fix:** wrap the `commit` and catch `IntegrityError` on the webhook constraint, `rollback`, return
`"duplicate_ignored"`. Optionally insert the ledger row first and commit it before applying the
body.

#### 9. `expire_lapsed` and `sweep_stale_jobs` filter timestamps in Python instead of SQL
`app/services/subscription_service.py:324-357`, `app/services/media_service.py:476-508`

Both `SELECT` the entire candidate set — every paid subscription with a non-null `valid_until`,
every job in `AWAITING_UPLOAD` — then loop and compare `valid_until <= now` / `created_at <=
cutoff` in Python. These run on a cron against tables that only grow. Push the time predicate into
the `WHERE`. For `expire_lapsed`, if you go all the way to a bulk `UPDATE ... WHERE`, use
`RETURNING user_id` so you can still invalidate each entitlement cache key.

#### 10. `content_service` is a 724-line hub and the de-facto shared-error module
`app/services/content_service.py` (whole file)

It carries: tier resolution, cached catalog reads, sermon CRUD, approval transitions, category
CRUD, speaker CRUD, series CRUD, staff sermon listing, thumbnail tickets/confirm, and the
`ContentError` class. Four other services import from it —
`media_service`/`announcement_service`/`analytics_service` import `ContentError` (and
`announcement_service` raises `content_service.ContentError` for announcement operations, which
reads wrong), `search_service` imports the underscore-private `_has_subscription`.

**Seams:** pull `ContentError` (or a base `DomainError`), `effective_tier`, and a public
`has_paid_access` into `app/services/errors.py` / a small `domain.py` that everything can depend
on without importing the content god-module. Then split `taxonomy_service` (category + speaker +
series CRUD) and `thumbnail_service` (ticket/confirm/`_validate_image_type`/`_load_thumbnail_target`)
out. Catalog reads + cache and sermon CRUD + approval can stay as `content_service` or split
further; that's taste.

---

### 🟢 NITS (optional)

- `app/services/content_service.py:182-191` — `_has_subscription` is underscore-private but
  imported by `search_service.py:30` and called directly from `api/media.py:119` and
  `api/analytics.py:76`. Routers reaching into a private service helper is a layering smell. Make
  it public (`has_paid_access`) and expose it through the service API.
- `app/services/content_service.py:232-237` / `173-179` / `149-170` — `_series_map` and
  `series_for` are byte-identical queries, and `load_ref_names` runs a third copy of the same
  series lookup. Collapse to one.
- `app/services/analytics_service.py:224` — `func.cast(PlaybackSession.completed,
  __import__("sqlalchemy").Integer)`. Import `Integer` at the top of the module.
- `app/api/series.py:63-78` and `app/api/speakers.py:33-39` — `create_series` / `create_speaker`
  build the ORM object inline in the router; every other create goes through a service function.
  `create_series` also skips `ContentError` handling and catalog-cache invalidation.
- `app/services/analytics_service.py:40-83` — `position_seconds` is only `ge=0`; nothing clamps it
  to `sermon.duration_seconds`, and `completed` is directly settable by the client. Self-reported
  analytics can be trivially inflated. Low stakes, but clamp `position_seconds` when duration is
  known.
- `app/services/analytics_service.py:158-212` — `overview().active_subscribers` counts
  `ACTIVE`+`CANCELLED` but not `PAST_DUE`, while `PAST_DUE` is in `ENTITLED_STATUSES`. The
  headline number under-counts entitled users relative to the rest of the system.
- `app/db/database.py:20-33` — stray indentation in the `replica_engine` block, commented-out
  `echo=` lines. `get_db`/`get_read_db` are identical bar the sessionmaker; the
  `except Exception: rollback` on a read-only replica session is noise.
- `app/services/announcement_service.py:147` — `from sqlalchemy import func` inside the function
  body; the module already imports `select` at the top.
- `app/services/media_service.py:201-209` — comment says "renditions from a previous run of this
  job", but the delete is keyed on `sermon_id` + `media_type`, so it wipes *any* other job's refs
  for the same sermon and type. Probably intended (latest upload wins), but the comment is wrong
  and there's no `upload_job_id` on `MediaRef` to scope it properly.
- Trailing whitespace / stray blank lines: `media_service.py:232`, `search_service.py:74`.
  `content_service.py:22-24` carries `# noqa: E402` on imports that are not actually out of order.
- `app/api/sermon_approval.py:43-50` — `review_queue` loops `await db.get(Series, ...)` per row.
  Bounded queue so it's fine, but it's the one list path that doesn't use the batch `series_for`
  helper.

---

## Explicitly checked and fine

- **Playback entitlement gate (lead #4).** `media_service.get_stream:315-316` — the
  `tier == PAID and not has_subscription and not is_staff → 403 upgrade_required` check holds.
  Signed playback URLs are minted nowhere else: `list_media_refs` is role-gated and returns rows
  without URLs, and the upload path can't touch a `PUBLISHED` sermon. The free-tier quality cap
  correctly never filters out a `quality is None` passthrough rendition (would leave nothing
  playable), and PAID non-subscribers are 403'd before the loop so the cap only ever applies to
  free content.
- **`effective_tier` consistency (lead #2).** The *tier* itself is resolved identically across
  catalog list, catalog detail, search, stream, continue-watching, staff list and the review
  queue — every path loads the `series` and calls `effective_tier`. The only divergence is the
  `locked`/`has_subscription` flag in `series_episodes` (finding 7) and the cache-staleness window
  in `update_sermon` (finding 1) — not the tier resolver.
- **Entitlement cache invalidation (lead #3).** Fires on `cancel`, on every `handle_webhook`
  branch that resolves a subscription, and per-row in `expire_lapsed`. Ordering is
  commit-then-invalidate everywhere (not the buggy invalidate-then-commit). `is_entitled` fails
  *open* to the database on a Redis outage — correct; a cache blip must not revoke everyone.
- **Announcement visibility (lead #6).** The SQL `WHERE` in `list_visible:110-122` and the Python
  `is_visible:50-60` agree on both boundaries — `publish_at <= now` visible, `expires_at > now`
  visible, equality on `expires_at` hides. `_as_utc` coerces naive→UTC on the Python path;
  Postgres `timestamptz` columns keep the SQL path correct. Only SQLite test comparisons could
  drift, and that's test-only.
- **`expire_on_commit=False` (lead #9).** Post-commit attribute reads are either `refresh`ed or
  read plain scalar columns already resident on the instance (`sub.user_id` in `handle_webhook`
  after commit) — no accidental async lazy IO. No write is routed through `get_read_db`; every
  `ReadDbDep` endpoint, including `/stream`, is read-only.
- **N+1 on list endpoints (lead #10).** Catalog list, staff sermon list, search, and
  continue-watching all batch the series / speaker / category lookups. Only
  `sermon_approval.review_queue` fans out, and that queue is small and bounded.
- **Webhook for an unknown subscription (lead #5).** `_find_subscription` returns `None`, all
  branches no-op, the `ProcessedWebhook` row is still recorded. In practice every user has a
  `Subscription` row from registration and checkout metadata carries `user_id`, so this is not a
  live path.
- **Config preflight (`config.py:170-217`).** Thorough: stub payment/storage/email backends,
  `http://` origins, wildcard CORS with credentials, non-Postgres `DATABASE_URL`, `debug=true` all
  block a production boot. `secret_key_is_real` and `environment_is_known` run in every
  environment. `get_provider`/`get_storage` also refuse the stub in production independently, as
  belt-and-braces.
- **Middleware (`middleware.py`).** Rate limiter and body-size limiter both fail open / reject
  cleanly; correlation ID is set and reset around every request including the exception path; CSP
  is deny-all except for the enumerated docs paths.

---

## What I read closely vs skimmed

**Close read:** `content_service.py`, `media_service.py`, `subscription_service.py`,
`analytics_service.py`, `search_service.py`, `announcement_service.py`, `approval.py`,
`db/database.py`, `models/models.py`, `models/content_schemas.py`, plus the streaming / catalog /
subscription / analytics routers where the entitlement and cache logic actually lands.

**Skimmed:** `core/storage.py`, `core/payments.py`, `core/redis.py`, `core/middleware.py`,
`core/email.py`, `core/logging.py` (seams, checked the stub/live split and the fail-open
behaviour); the thin CRUD routers `categories.py`, `speakers.py`, `sermons.py`, `series.py`,
`sermon_approval.py`, `announcement_approval.py`, `announcements.py` (checked the
validate → service → map-error → role-guard shape, dug into `series.py` where finding 7 lives);
`scripts/*` (checked what a cron would trip over — findings 9; `preflight.py`, `create_admin.py`
are fine); `models/schemas.py`, `config.py` non-auth parts.
