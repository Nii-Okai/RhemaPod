# ADR 0007 — No self-approval (segregation of duties) on sermons and announcements

- **Status:** Accepted
- **Date:** 2026-09-21
- **Scope:** `fastapi_sermon` backend — `content_service.transition`,
  `content_service.take_over_review`, `announcement_service.transition`. No
  new routes, no schema change.
- **Deciders:** Isaac
- **Relates to:** `docs/adr/0004-sermons-author-scoped-filter.md` (editor
  ownership scoping — a different axis), the review-claim lock
  (`content_service._CLAIM_GATED_ACTIONS`, GATE 3 Batch 6 #9)

> Records why a manager can no longer single-handedly walk their own content
> from draft to published, the admin bypass, and — the one asymmetry a future
> reader will otherwise re-litigate — why sermons block the whole review-entry
> surface while announcements block only `approve`.

---

## Context

Isaac's ruling, verbatim: *"When an editor creates an announcement, a manager
needs to approve before publish. Editors should not be able to publish
announcements"* — confirmed to apply identically to sermons: a manager who
creates a sermon may not approve/publish it themselves; admin bypasses.

Facts established from the code, not assumed:

| Observation | Evidence |
|---|---|
| No self-approval check existed anywhere before this change | `content_service.transition`, `announcement_service.transition` (grepped, absent) |
| Editors already cannot reach `approve`/`reject`/`start_review` at all — role-gated at the transition table | `approval.TRANSITIONS`, `ANNOUNCEMENT_TRANSITIONS` (roles tuple excludes `EDITOR`) |
| The announcement portal's "Publish" button auto-walks draft→submit→approve→publish in one click for a manager | admin-portal (separate codebase) — noted here because this ADR's fix is what makes that button now stop at `approve` for the button-presser's own content |
| Sermons already have a review-claim lock: a *different*, non-claiming manager is blocked from `approve`/`reject`/`withdraw` while `under_review` | `content_service._CLAIM_GATED_ACTIONS`, `_review_claimer_id` |
| The claim lock has an admin bypass (`actor.role != UserRole.ADMIN`) | same, `transition()` |
| `publish` is deliberately never claim-gated — "any manager may publish an approved sermon" | `_CLAIM_GATED_ACTIONS` docstring |

The review-claim lock answers *"has someone else already staked a claim on
reviewing this?"* — it says nothing about the sermon's own author, who was
never blocked from claiming their own submission in the first place. This ADR
adds that companion rule.

## Decision

### 1 — Announcements: `approve` only, `reject` stays open

In `announcement_service.transition`, before resolving the transition:

```
if action == "approve" and actor.id == ann.created_by and actor.role != UserRole.ADMIN:
    raise ContentError(
        "You can't approve your own announcement — another manager needs to review it",
        403,
    )
```

- **`reject` is deliberately not gated.** Rejecting your own draft is
  self-correction — you're pulling your own work back, not signing off on it.
  There is no conflict of interest in refusing yourself.
- **Admin bypasses**, matching the review-claim admin-bypass already
  established on the sermon side.
- Placed before the transition-table lookup (matching the file's existing
  ownership check for `submit`, which is also checked before legality in this
  file) rather than after, unlike the sermon side (§2) — see the note in §3.

### 2 — Sermons: the whole review-entry surface is blocked, not just `approve`

In `content_service.transition`, after the transition-legality check
(`resolve_transition`) succeeds and before the review-claim check:

```
_SELF_AUTHOR_REVIEW_BLOCKED_ACTIONS = frozenset({"start_review", "approve", "reject"})

if action in _SELF_AUTHOR_REVIEW_BLOCKED_ACTIONS and sermon.created_by == actor.id and actor.role != UserRole.ADMIN:
    raise ContentError("You submitted this sermon — another manager needs to review it", status_code=403)
```

`take_over_review` (a separate function, not a table-driven action) carries
the identical check inline, right after its own status check and before it
reads the current claimer.

**Why the whole surface, not just `approve` (the asymmetry with
announcements):** the review-claim lock's `_CLAIM_GATED_ACTIONS` docstring
already establishes the shape of "someone else claimed this, so you can't
act on it" — but a sermon's own author was never a legitimate claimant to
begin with. Letting them `start-review` their own submission (self-claiming
it, which locks out every *other* manager too, since the review-claim lock
then treats them as the claimer) would let the same conflict of interest in
through a side door: claim it, sit on it, then quietly approve. Blocking
`start_review` and `take_over_review` in addition to `approve`/`reject`
closes that door — the sermon's author simply never gets to hold the claim.

**`withdraw` is excluded**, for the same reason announcement `reject` is:
pulling your own submission back to draft is self-correction, not a review
decision needing a second person.

**`publish` is excluded on both content types.** Once a different manager (or
an admin) has legitimately approved the item, publishing is a mechanical last
step — flip the status, nothing more to judge — not a review decision. This
mirrors the existing `_CLAIM_GATED_ACTIONS` precedent: `publish` is not
claim-gated either, for the identical reasoning ("any manager may publish an
approved sermon").

### 3 — Why the check order differs between the two files

Sermons: self-authorship is checked *after* `resolve_transition` succeeds —
an action illegal from the sermon's current status 409s for everyone, author
or not, before the 403 fires. This mirrors the sermon file's own stated
convention ("Transition legality first... so it fires solely for an action
that would otherwise be allowed").

Announcements: the ownership check runs *before* `resolve_announcement_transition`
— this is not a new convention introduced here, it matches the pre-existing
`submit`-ownership check three lines above it in the same function, which
already ran before legality. Not worth inverting just for this change; the
observable difference is limited to one edge case (a manager `approve`-ing
their own still-`draft` announcement gets a 403 "own content" message instead
of a 409 "wrong status" message) that no test in this codebase depends on
either way.

## Consequences

- **The announcement portal's one-click "Publish" button** (draft→submit→
  approve→publish for a manager, entirely client-driven) now genuinely stops
  at `approve` for the button-presser's own content — the backend refuses
  the approve call with 403, and the frontend fix (a separate PR, not part of
  this backend batch) needs to surface that 403 rather than swallow it. This
  ADR does not change the admin-portal frontend.
- **No schema, no migration, no new route.** Pure service-layer logic;
  `openapi.json` is unaffected by this item (see ADR 0008 for the schema
  change bundled into the same backend batch).
- **Editor-authored content is unaffected.** Editors already cannot reach
  any of the gated actions (role-gated at the transition table), so this
  rule only restricts a manager/admin surface that used to be unrestricted
  for self-authored content.
- **Coverage:** `tests/test_review_integrity.py` — self-`start-review`,
  self-`approve`, self-`reject`, self-take-over all 403 for a sermon's own
  manager-author; a different manager succeeds at each; admin bypasses;
  `publish` and `withdraw` are unaffected; editor-authored content is
  unaffected (a reviewing manager who didn't create it is unchanged).
  Announcement `approve`-own is 403, `reject`-own is 200, admin bypasses.
