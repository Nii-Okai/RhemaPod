# ADR 0008 — Sermon approved/published field lock, and scheduled publish (`publish_at`)

- **Status:** Accepted
- **Date:** 2026-09-21
- **Scope:** `fastapi_sermon` backend — `content_service.update_sermon` (new
  status guard, no route/schema change); new nullable `sermons.publish_at`
  column (migration `b3c4d5e6f7a8`), `SermonCreate`/`SermonUpdate`/
  `SermonListItem` schema fields, and the public sermon-visibility read paths
  (catalog list/detail, search, series episodes, streaming)
- **Deciders:** Isaac
- **Relates to:** `Announcement.publish_at` / `announcement_service.is_visible`
  (the pattern this item copies exactly), `docs/adr/0006-staff-subscriptions-read-api.md`
  (precedent for "additive migration, no gate, mandatory record")

> Records two independent, additive changes shipped in the same backend
> batch: (1) sermons in `approved`/`published` status are now content-locked
> against `update_sermon`, and (2) sermons gained a `publish_at` field that
> mirrors `Announcement.publish_at` field-for-field, including the
> public/staff DTO exposure split.

---

## Context

### 1 — The field lock

`update_sermon` had **no status guard at all** beyond the pre-existing
episode-position lock (which only fires for `pending_review`/`under_review`,
and only for the episode-number/series axes). A manager or admin — or the
editor who created it — could PATCH an `approved` or `published` sermon's
title, tier, speaker, category, series, or episode number with no
restriction. The frontend is adding a client-side lock in a separate PR; that
is UX only. This ADR is the real guard.

### 2 — Scheduled publish

Isaac's decision: sermons should support publishing at a future datetime,
using the exact pattern already built and reviewed for `Announcement`:
visibility computed at read time from `status` + `publish_at`, no background
worker. Facts confirmed before writing anything (per the batch brief's
instruction not to guess):

| Observation | Evidence |
|---|---|
| `Announcement.publish_at` is `DateTime(timezone=True)`, nullable, indexed alone | `alembic/versions/c2d3e4f5a6b7_add_announcements.py` |
| `announcement_service.is_visible`: `status == PUBLISHED AND (publish_at is None OR publish_at <= now) AND (expires_at is None OR expires_at > now)` | `announcement_service.py` |
| `AnnouncementCreate` validates `expires_at > publish_at` but has **no** "publish_at must be in the future" check | `content_schemas.AnnouncementCreate.expiry_after_publish` |
| `AnnouncementListItem` (the **public** list DTO) exposes `publish_at` | `content_schemas.AnnouncementListItem` |
| The public read paths (`list_visible`, `get_visible`) only ever return already-visible rows, so a returned `publish_at` is always already in the past or unset — exposing it publicly leaks nothing premature | `announcement_service.list_visible` / `get_visible` |

## Decision

### 1 — Field lock: `update_sermon` refuses `approved`/`published`

```
_CONTENT_LOCKED_MESSAGES = {
    SermonStatus.APPROVED: "This sermon is approved and locked — publish it, then unpublish to make changes.",
    SermonStatus.PUBLISHED: "This sermon is published and locked — unpublish it first to make changes.",
}
```

Checked first thing in `update_sermon`, immediately after `_load_editable`
(before the episode-position lock, which is mutually exclusive with these two
statuses — a sermon is never simultaneously `pending_review`/`under_review`
and `approved`/`published`). `409`, distinct message per status so the client
can tell which rule fired, and distinct from the pre-existing "in review,
position locked" message.

**No admin bypass.** Unlike ADR 0007's segregation-of-duties rule, this is a
data-integrity guard, not a conflict-of-interest rule — a manager or admin
editing a live/approved sermon out from under its own reviewed state is
exactly the bug this closes, regardless of who they are. The guard applies
uniformly to every role that can reach `update_sermon`.

**Scope: `update_sermon` only.** The approval-transition actions themselves
(`publish`, `unpublish`, `withdraw`, `approve`, `reject`) are untouched — they
go through `content_service.transition`, a different function.

**`unpublish` is self-resolving, confirmed.** `unpublish` transitions
`published → unpublished` (`approval.TRANSITIONS["unpublish"]`).
`unpublished` is not in `_CONTENT_LOCKED_MESSAGES`, so the sermon is editable
again immediately — no separate "unlock" action needed. This is the intended
cycle: publish locks it, unpublish unlocks it, exactly as `Announcement`'s
`unpublish → approved` already works.

**Known pre-existing gap, not fixed here (flagged, not silently worked
around):** `approved` has no path back to an editable status except
`approved → published → unpublished`. Looking at `approval.TRANSITIONS`, the
only action with `approved` in its `allowed_from` is `publish`; neither
`withdraw` nor `reject` accepts `approved` as a source status. So an
`approved`-but-not-yet-published sermon that needs a fix must be published
and then unpublished to become editable again — there is no direct
"un-approve." This is a pre-existing state-machine gap (not introduced by
this change) surfaced by adding the lock; widening `withdraw` or `reject` to
accept `approved` as a source is a state-machine change belonging to its own
plan step and Isaac's ruling, not folded into this batch.

**Dead code, kept.** `update_sermon`'s existing
`if changed and sermon.status == SermonStatus.PUBLISHED: await invalidate_catalog_cache()`
can no longer execute — the new guard above it refuses the update before this
line is reached whenever status is `PUBLISHED`. Left in place, commented, as
defense-in-depth against a future relaxation of the guard silently reopening
the catalog-staleness bug it exists to prevent, rather than deleted.

### 2 — `publish_at`: mirrors `Announcement.publish_at` exactly

**Migration** (`b3c4d5e6f7a8`, additive, chained off `a6b7c8d9e0f1`):
`sermons.publish_at DateTime(timezone=True) NULL`, one lone index
(`ix_sermons_publish_at`) — same type, same nullability, same indexing shape
as the announcement column. No `expires_at` equivalent (not asked for; sermons
don't expire).

**Schema.** `publish_at` is settable on `SermonCreate`/`SermonUpdate` (so it
can be set while still editable — draft/rejected — same window
`AnnouncementCreate`/`Update` allow). **No "must be in the future" validator**
— `AnnouncementCreate` doesn't enforce one either (confirmed above), so none
is added here; matching the precedent exactly means matching its absence of
validation too, not inventing stricter rules the reviewed pattern never had.

**Public exposure.** `publish_at` is added to the base `SermonListItem` (so
it flows to `SermonDetail`/`SermonAdminListItem`/`SermonAdminDetail`
automatically), **not** confined to the staff DTOs. This mirrors
`AnnouncementListItem` exposing it publicly, and is safe for the identical
reason: the public sermon reads only ever return a sermon that has already
cleared the visibility gate (§3), so a `publish_at` value returned to a
caller is always already in the past (or unset) — nothing about a hidden
sermon's future schedule leaks.

### 3 — Visibility gate: `sermon_visibility_clause` / `sermon_publish_time_passed`

Two new helpers in `content_service.py`, the query-level and row-level twins
(mirroring the existing `staff_scope_hides` / `editor_scope_filter` pairing
pattern in the same module):

- `sermon_publish_time_passed(sermon, at=None) -> bool` — `publish_at is None
  or publish_at <= now`. Paired with the existing `VIEWER_VISIBLE_STATUSES`
  status check for a single already-loaded row.
- `sermon_visibility_clause(at=None)` — the SQL twin:
  `(Sermon.status == PUBLISHED, or_(Sermon.publish_at.is_(None), Sermon.publish_at <= now))`.

Wired into every public sermon read that previously gated on
`Sermon.status == SermonStatus.PUBLISHED` alone:

| Read path | File |
|---|---|
| Public catalog list | `content_service.list_published_sermons` |
| Public catalog detail (404 if not visible) | `content_service.get_sermon_detail` |
| Full-text/filtered search | `search_service.search_sermons` |
| Autocomplete | `search_service.suggest` |
| A series' public episode list | `api/series.py::series_episodes` |
| Signed streaming URLs | `media_service.get_stream` (viewer path only — `is_staff` still bypasses, same as the existing status check it sits beside) |

**Staff reads are untouched and always see everything, regardless of
`publish_at`** — `get_sermon_for_staff`, `list_sermons_for_staff`
(`GET /sermons`, `GET /sermons/{id}`) apply no visibility gate at all, same
as before this change. This is the same public/staff split
`announcement_service` already has (`get_visible`/`list_visible` vs.
`get_any`/`list_all`).

**The `publish` transition itself needed no change.** It already just flips
`status → PUBLISHED`; the read-time gate above is what makes a future
`publish_at` actually hide the row until then. Confirmed sufficient — no
change to `content_service.transition` or `sermon_approval.py`.

**Known trade-off, not new:** `list_published_sermons` caches the catalog
list for 5 minutes (`CATALOG_TTL_SECONDS`). A sermon crossing its `publish_at`
threshold mid-cache-window doesn't appear until the TTL lapses or the cache is
busted by an unrelated write — identical to the existing behavior for a
sermon published with no schedule at all (it also waits out the same TTL).
Not a regression introduced by this change; `announcement_service.list_visible`
has no such cache, so there is no precedent to match here either way.

## Consequences

- **`openapi.json` regenerated and committed.** Additive only: `publish_at`
  added to `SermonCreate`, `SermonUpdate`, `SermonListItem` (and therefore
  every schema that extends it — `SermonDetail`, `SermonAdminListItem`,
  `SermonAdminDetail`, `ReviewQueueItem` does **not** extend it and is
  unaffected). No new paths, no removed fields.
- **Migration round-trips.** `alembic upgrade head → downgrade -1 → upgrade
  head` — additive column + index, `downgrade` drops both cleanly.
- **Coverage:** `tests/test_review_integrity.py` (the field lock — 409 on
  `approved`/`published`, 200 unchanged on `draft`/`rejected`, distinct
  message from the episode-position lock, unpublish re-enables editing);
  `tests/test_sermon_scheduled_publish.py` (`publish_at` settable while
  editable and visible on staff DTOs; a future-dated published sermon hidden
  from catalog list/detail(404)/search/series-episodes/streaming; staff sees
  it regardless of `publish_at`, always; once `publish_at` passes it appears
  everywhere; `publish_at=None` is an unchanged regression case).
