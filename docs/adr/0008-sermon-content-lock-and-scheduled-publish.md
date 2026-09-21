# ADR 0008 — Sermon approved/published field lock, and scheduled publish (`publish_at`)

- **Status:** Accepted
- **Date:** 2026-09-21
- **Scope:** `fastapi_sermon` backend — `content_service.update_sermon` (new
  status guard, no route/schema change); new nullable `sermons.publish_at`
  column (migration `b3c4d5e6f7a8`), `SermonCreate`/`SermonUpdate`/
  `SermonListItem` schema fields, and the public sermon-visibility read paths
  (catalog list/detail, search, series episodes, streaming). §4 (same-day fix
  pass, follow-up commit): `approval.TRANSITIONS["reject"]`,
  `content_service.transition`'s self-author check,
  `content_service.reorder_series_episodes` /
  `episode_position_move_locked`, `content_service.confirm_thumbnail`.
- **Deciders:** Isaac
- **Relates to:** `Announcement.publish_at` / `announcement_service.is_visible`
  (the pattern this item copies exactly), `docs/adr/0006-staff-subscriptions-read-api.md`
  (precedent for "additive migration, no gate, mandatory record"),
  `docs/adr/0007-no-self-approval.md` (§4's self-author carve-out extends that
  ADR's rule, doesn't relitigate it)

> Records two independent, additive changes shipped in the same backend
> batch: (1) sermons in `approved`/`published` status are now content-locked
> against `update_sermon`, and (2) sermons gained a `publish_at` field that
> mirrors `Announcement.publish_at` field-for-field, including the
> public/staff DTO exposure split. §4 records a same-day follow-up commit
> that closed three gaps the mandatory `reviewer-gilfoyle` /
> `security-reviewer` passes found in that batch.

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

**Resolved in the fix pass below (§4): `reject` now accepts `approved` as a
source.** The gap described in the original text of this ADR — `approved`
having no path back to editable except the `published → unpublished` detour —
is closed; see §4 for the transition and the segregation-of-duties interaction
it raised.

**Dead code, deleted.** `update_sermon`'s
`if changed and sermon.status == SermonStatus.PUBLISHED: await invalidate_catalog_cache()`
was kept at first commit as a commented "defense-in-depth" branch, but a
comment enforces nothing — flagged in review (gilfoyle) as cargo cult. Removed
in the fix pass, along with the now-pointless `changed` bookkeeping that only
existed to feed it. The reasoning it stood for is now a prose comment instead
of a dead conditional: the guard above unconditionally refuses any update
while `status == PUBLISHED`, so this function can never be the one that
dirties a published sermon's cached catalog card — the only path that can is
unpublish → edit → republish, and `publish`/`unpublish` in
`content_service.transition` already invalidate the cache themselves.

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

### 4 — Fix pass (2026-09-21, same day, separate commit): closing the gaps the reviews found

Both `reviewer-gilfoyle` ("Approve with nits") and `security-reviewer` ("Pass
with notes") signed off on the batch above but flagged three loose ends. All
three are addressed in one follow-up commit on the same branch:

**`reject` now accepts `approved` as a source (Isaac's call).** Closes the gap
noted in §1: `approval.TRANSITIONS["reject"]` now allows `APPROVED →
REJECTED`, same role rule as the existing pending/under-review case (Manager
or Admin). A rejected sermon already re-enters the normal flow via `submit`
(`TRANSITIONS["submit"]` already accepted `REJECTED` as a source, unchanged),
so rejecting an approved sermon is a real, complete path back to editable —
not a new dead end.

**Segregation-of-duties interaction, decided explicitly.**
`content_service.transition`'s self-author block
(`_SELF_AUTHOR_REVIEW_BLOCKED_ACTIONS = {start_review, approve, reject}`) gates
on the *action*, not the source status — so without a carve-out, a sermon's
own creator would also be blocked from rejecting their own **approved**
sermon, the same as they're blocked from rejecting their own
pending/under-review one. Decided **not** to block it: by the time a sermon
reaches `approved`, self-approval is already enforced, so someone else
necessarily made that call. The creator rejecting their own already-approved
sermon isn't reviewing their own work — there's no second judgment call being
skipped, no second person's sign-off being bypassed. It's "I want to pull this
back," functionally equivalent to `withdraw` (never gated) and directly
mirrors the existing precedent that an announcement's `reject` is never
self-gated (`announcement_service.transition`, same reasoning: rejecting your
own submission is self-correction, not a conflict of interest). Implemented as
a narrow carve-out in the existing check — `reject` stays gated for the
sermon's own creator when the source status is `pending_review`/`under_review`
(unchanged: rejecting *unreviewed* work is still a review decision), gated off
only when the source is `approved`. Admin bypass is unaffected either way
(admins were never gated here).

**`reorder_series_episodes` closed the same lock gap `update_sermon` already
has.** Security review: the bulk `PUT /series/{id}/episode-order` endpoint
only ever consulted `episode_position_move_locked` against the *review-lock*
statuses (`pending_review`/`under_review`), never against
`_CONTENT_LOCKED_MESSAGES` (`approved`/`published`) — so a manager could
renumber an approved or published episode's `episode_number` through the bulk
endpoint even though the single-row `PATCH /sermons/{id}` already 409s on the
identical field for the identical sermon. Fixed by generalising
`episode_position_move_locked` to take a `locked_statuses` parameter
(defaulting to the existing review-lock set, so every other call site is
unaffected), and having `reorder_series_episodes` run the same
"would this position actually change" check a second time against
`tuple(_CONTENT_LOCKED_MESSAGES)`. Two separate checks, two separate 409
messages (an in-review lock reads "in review"; a content lock reads "approved
or published") so the caller can tell which rule fired, same as the two
distinct messages `_CONTENT_LOCKED_MESSAGES` already gives per status.
**No-op semantics preserved, not reinvented:** because both checks reuse the
same `episode_position_move_locked` predicate, "stays at its current number
while other episodes shuffle around it" is allowed under the content lock for
exactly the reason it's already allowed under the review lock — it isn't a
move.

**`confirm_thumbnail` — lock extended to sermons, deliberately not to
series.** Security review / gilfoyle: `confirm_thumbnail` had no status check
at all, so a thumbnail could be swapped on an approved/published sermon with
no guard, sidestepping the field lock via a different field on the same row.
Decided to extend `_CONTENT_LOCKED_MESSAGES` to `confirm_thumbnail` for
`kind == "sermons"` — same 409, same message shape as `update_sermon`'s,
because a sermon's thumbnail is not incidental presentation metadata: it rides
on the cached public `SermonListItem` catalog card exactly like title,
description, and duration do (§1's own reasoning for why *any* field edit on
a locked sermon needs refusing). **Deliberately not extended to
`kind == "series"`:** a series never enters the review workflow at all — its
`status` column only ever moves `draft <-> published` via `update_series`
(manager-only), which itself imposes no lock on a published series' other
fields (title, description, tier, thumbnail are all still PATCH-able while
`published`). Locking only the thumbnail on a published series while leaving
every other series field open would be a new, inconsistent, unrequested
restriction — not a gap closure. If Isaac wants a content lock on published
series generally, that's a separate decision belonging to its own ADR, not an
extension of this one by implication.

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
- **Fix-pass coverage (§4), `openapi.json` unaffected** — none of the four
  fixes changes a request/response schema (all are service-layer status
  checks and one state-machine table entry), confirmed by re-running the dump
  script and diffing against the committed file: no drift.
  - `tests/test_review_integrity.py` — `reject` from `approved` by admin (log
    entry + note recorded), by a different manager, and by the sermon's own
    creator (the SoD carve-out); `reject` still gated for the creator from
    `under_review` (unchanged case, confirms the carve-out is
    status-specific); resubmit-after-reject-from-approved round-trips back
    into `pending_review`.
  - `tests/test_portal_batch5.py` — bulk reorder refused (409, episode named)
    when it would renumber an `approved` or a `published` episode, message
    distinct from the in-review case; a reorder that leaves an approved
    episode's number unchanged while others move around it still succeeds
    (same no-op semantics as the existing in-review case).
  - `tests/test_thumbnails.py` — `confirm_thumbnail` 409s on an
    `approved`/`published` sermon; a `confirm_thumbnail` on a `published`
    **series** still succeeds (documents the deliberate series exemption, not
    an oversight).
  - `tests/test_sermon_scheduled_publish.py` — `test_staff_streams_scheduled_sermon`:
    the missing positive case gilfoyle flagged — a manager and the owning
    editor both get 200 + playback variants from `/stream` on a
    future-`publish_at`, `PUBLISHED` sermon (the anonymous-404 side was
    already covered; this closes the untested branch of the same
    conditional).
