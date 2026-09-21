# ADR 0009 — `Sermon.publish_at` authz: single door, manager/admin only

- **Status:** Accepted
- **Date:** 2026-09-21
- **Scope:** `fastapi_sermon` backend — `app/models/content_schemas.py`
  (`SermonCreate`, `SermonUpdate`, new `PublishRequest`),
  `app/api/sermon_approval.py` (`POST /approvals/sermons/{id}/publish`),
  `app/services/content_service.py` (`transition`'s new `publish_at` kwarg
  and `_Unset` sentinel). No migration, no new route — the publish route
  already existed and gains an optional body.
- **Deciders:** Isaac
- **Relates to:** `docs/adr/0008-sermon-content-lock-and-scheduled-publish.md`
  (introduced `publish_at` and the read-time visibility gate — both
  unchanged by this ADR; this one is only about *who* may set the field and
  *where*, not how it behaves once set)

> Closes an authz gap in ADR 0008's `publish_at`: it shipped settable by
> anyone who could create or edit a sermon, including the sermon's own
> author. Two commits on `feat/sermon-schedule-publish-authz` remove both
> mutation paths and consolidate `publish_at` into the one place it belongs —
> the manager/admin-gated publish review action.

---

## Context

ADR 0008 added `Sermon.publish_at`, mirroring `Announcement.publish_at`
field-for-field: nullable, settable on `SermonCreate`/`SermonUpdate` "while
the sermon is still editable (draft/rejected)," visibility computed at read
time. That decision copied the announcement pattern faithfully but didn't
ask a question specific to sermons: *who* should decide when a sermon goes
live.

Isaac's ruling: scheduling a sermon's publish time is a manager/admin
decision made during or after review, not a content-authoring concern.
Editors create content and hand it to managers — they don't get to decide
publish timing. As shipped, `publish_at` violated this on two independent
paths, both reachable by the sermon's own creator:

| Door | Field | Reachable by |
|---|---|---|
| `POST /sermons` | `SermonCreate.publish_at` | Anyone who can create a sermon (editor included) |
| `PATCH /sermons/{id}` | `SermonUpdate.publish_at` | Anyone who can edit the sermon pre-lock (editor included) |

Neither path had any role check on `publish_at` specifically — both just
inherited whatever role could reach create/update generally, which for
sermons includes `editor`.

## Decision

Two commits, same branch, second one closing a door the first commit didn't
know about yet:

**1 — `0cd8e8a`: remove `publish_at` from `SermonUpdate`.** `PATCH
/sermons/{id}` can no longer set it, for any role.

**2 — `c0ee687`: remove `publish_at` from `SermonCreate`.** Found as a
follow-up: the same bug had a second door at creation time. `POST /sermons`
can no longer set it either, for any role. `create_sermon`'s write path
drops the field too — a sermon now always starts with `publish_at` unset.

**Single remaining door: `PublishRequest.publish_at` on the publish
action.** A new optional body on `POST /approvals/sermons/{sermon_id}/publish`:

```python
class PublishRequest(BaseModel):
    publish_at: datetime | None = None
```

That route was already `ManagerPlus`-gated (`require_role(MANAGER, ADMIN)`)
before this change — **no new RBAC check was needed**, only removal of the
two side doors. This is the core move: rather than adding a bespoke
role-check on one field inside two general-purpose, editor-reachable
create/update paths, `publish_at` moves entirely into a path that was
already correctly gated for exactly the role this needed.

**Backward compatibility: bodyless publish still means "publish now,
untouched."** The review-queue frontend's existing call is a bodyless
`POST .../publish`. That must keep working unchanged and must **not**
clear a schedule that was somehow already on the row. This needs
distinguishing three states — "caller omitted the field entirely," "caller
sent `publish_at: null`," and "caller sent a future timestamp" — where the
first two are *not* the same thing (omitted = leave the row alone; explicit
null = clear it). `content_service.transition()` gained a `publish_at`
kwarg defaulting to a private sentinel:

```python
class _Unset:
    """Sentinel distinguishing "caller didn't pass `publish_at`" ... from
    "caller passed `publish_at=None`" ... A plain `None` default can't make
    that distinction since `None` is itself a valid, meaningful value here."""

_UNSET = _Unset()

async def transition(..., publish_at: datetime | None | _Unset = _UNSET) -> Sermon:
    ...
    if action == "publish" and not isinstance(publish_at, _Unset):
        sermon.publish_at = publish_at
```

This sentinel is new to this codebase — nothing else uses this pattern.
Recorded here as a deliberate, narrow, single-file choice to solve one
three-state problem (omitted / null / value) that a plain `Optional`
parameter genuinely can't express — not a new house convention to reach for
elsewhere. The kwarg only has any effect on the `"publish"` action; every
other transition ignores it.

**Mechanism unchanged.** The visibility gate itself —
`sermon_publish_time_passed` / `sermon_visibility_clause`, the read-path
wiring across catalog/search/series/streaming — is exactly what ADR 0008
shipped. This ADR does not touch it.

## Consequences

- **Positive:** the authz gap is closed on both doors it had, not just the
  one Isaac originally flagged — the second commit is itself evidence the
  first fix wasn't assumed complete without checking. `publish_at` now has
  exactly one mutation path, and it was already correctly role-gated, so no
  new permission logic was written or needs maintaining.
- **Negative — non-additive OpenAPI change, the first in this feature
  area.** Everything ADR 0008 shipped was additive (new column, new fields,
  no removals). This change removes `publish_at` from both `SermonCreate`
  and `SermonUpdate`'s schemas — a real breaking change in the contract,
  even though nothing in this codebase currently depends on the old
  behavior: no shipped client sets `publish_at` via create/update today, and
  the frontend work that would have is being built against this fix, not
  against the old behavior (see below). `openapi.json` regenerated and
  committed in both commits.
- **Negative — scheduling now requires the sermon to already be approved.**
  Because the only door is the publish action, and `publish` only fires
  from `approved`, a sermon can no longer be scheduled during drafting —
  only at or after the approve step. This is intentional (matches Isaac's
  framing: scheduling is a review-time decision), not an oversight.
- **Neutral — rescheduling/cancelling a schedule stays out of scope.**
  `PublishRequest` has no partial-update semantics; each `publish` call
  fully replaces `publish_at` (or leaves it untouched, if the field is
  omitted). Changing a schedule after the fact isn't addressed here, same
  as it wasn't in ADR 0008.
- **Neutral — frontend consequence, in-flight, not part of this ADR.** The
  sermon editor's Access card briefly had a `publish_at` datetime field
  (added alongside ADR 0008); it's being removed entirely on top of this
  branch (`ui-designer` design, `senior-dev-frontend` build) — scheduling
  now only happens through review-time actions (approve-and-publish-later,
  or publish-later from an already-approved sermon).
- **Coverage:** `tests/test_sermon_scheduled_publish.py`, substantially
  rewritten — `test_publish_at_ignored_on_create` and
  `test_publish_at_ignored_by_general_update` assert the field is silently
  dropped (not a 422 — no schema in this codebase sets `extra="forbid"`) on
  both former doors; every scenario that previously created a
  pre-scheduled sermon inline now goes through submit → approve →
  `publish` with a `PublishRequest` body instead; new tests target the
  publish action directly —
  `test_publish_action_sets_future_publish_at`,
  `test_publish_action_empty_body_publishes_immediately`,
  `test_publish_action_explicit_null_overrides_stale_publish_at`,
  `test_publish_action_bodyless_leaves_existing_publish_at_untouched` — the
  last two are the sentinel's actual test: explicit `null` clears a stale
  `publish_at` on republish, and a second, genuinely bodyless `publish` call
  (schedule → unpublish → republish with no `json=` body at all) leaves an
  already-set `publish_at` untouched.

## Alternatives considered

- **Keep `publish_at` on `SermonCreate`/`SermonUpdate`, add a role check
  scoped to that one field:** rejected — this bolts a bespoke,
  field-specific authz rule onto two general-purpose paths that editors
  legitimately need for everything else on the sermon. It leaves two
  mutation paths for the same field to keep in sync forever, and is exactly
  the kind of asymmetric, easy-to-miss-on-the-next-refactor guard that's
  harder to reason about than "the field doesn't exist here."
- **Mask/ignore `publish_at` for non-manager callers instead of removing
  it from the schema:** rejected — a manager PATCHing a sermon would then
  still not be able to schedule it that way (scheduling only makes sense at
  publish time, once approved), so the field would sit on `SermonUpdate`
  doing nothing for every caller, manager included. Removing it is more
  honest about what the schema actually accepts.
