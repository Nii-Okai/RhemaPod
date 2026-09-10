# ADR 0004 — `GET /sermons?created_by=me` — author-scoped staff sermon list

- **Status:** Accepted
- **Date:** 2026-09-10
- **Scope:** `fastapi_sermon` backend — `GET /api/v1/sermons` (staff list)
- **Deciders:** Isaac; architect, planner, reviewer-gilfoyle (implementation review pending on W15)
- **Relates to:** `plans/plan-admin-portal-phase2.md` §A.1, §A.8, GATE 3 Batch 7 item 3, W15/W23; `plans/plan-admin-portal.md` GATE 3

> Built by W15 (Backend Batch 7). Recorded because it adds public API surface, even
> though it changes neither the response shape nor any authorization rule.

---

## Context

The reduced Phase 2 Dashboard (§A.1) gives every role, editors included, a "your work in
progress" block: their own drafts, their own rejected sermons, their own in-flight uploads.
The staff sermon list (`GET /sermons` → `Page[SermonAdminListItem]`) already scopes an
**editor** to their own rows (`content_service.editor_scope_filter`), but a **manager/admin**
sees everyone's, and the WIP block needs a manager/admin to be able to ask for just theirs.

The design register (§A.8) names the missing param explicitly: `GET /sermons?created_by=me`
— "No such param — Built — Batch 7 #3".

## Decision

Add one optional query parameter to `GET /sermons`:

- **`created_by`** — accepts the single literal value `me`. Any other value is a 422
  (`Literal["me"]` in the signature), so it can never become a general "list another
  author's sermons" back door.
- When `created_by=me`, the list is narrowed to `Sermon.created_by == <caller id>`, applied
  as an **additional** `WHERE` on top of the existing role scope in
  `list_sermons_for_staff(..., author_id=...)`.

What this deliberately is **not**:

- **Not an authz change.** The filter can only ever *narrow* what a caller already sees. An
  editor is already confined to their own rows, so `created_by=me` is a no-op for them;
  passing it never widens visibility for anyone. `require_role(EDITOR, MANAGER, ADMIN)` on
  the route is unchanged.
- **Not a response-shape change.** `SermonAdminListItem` and the `Page[...]` envelope are
  untouched. `total` continues to be the pre-paging count of the (now optionally narrowed)
  result set, built from the same condition list as the page.
- **Not `created_by=<uuid>`.** Listing an arbitrary author's sermons is not a Phase 2 need
  and would be a real authz surface. Only `me` is accepted.

## Consequences

- The editor Dashboard and the manager/admin Dashboard use the **same** endpoint for their
  WIP cards; only the presence of `created_by=me` differs, and for an editor it is
  redundant-but-harmless.
- `docs/openapi.json` (repo root) is regenerated and committed; the diff is additive — one
  new optional parameter with an enum of `["me"]`.
- If a future screen genuinely needs "sermons by author X", that is a new, deliberate authz
  surface with its own ADR and `security-reviewer` pass — not an extension of this
  parameter.

## Notes for the implementation review

- `reviewer-gilfoyle` on the batch. No `security-reviewer` gate for this item (item 1 has
  that); flagged here only so the "narrow, cannot widen" reasoning is on the record.
- Covered by `tests/test_portal_batch7.py::test_sermons_created_by_me_scopes_to_caller` and
  `::test_sermons_created_by_rejects_non_me_value`.
