# ADR 0003 — Staff user list is staff-scoped; role counts are a separate full-table aggregate

- **Status:** Accepted
- **Date:** 2026-09-10
- **Scope:** `fastapi_sermon` backend — `GET /api/v1/users` and the new `GET /api/v1/users/role-counts`
- **Deciders:** Isaac; architect, planner, reviewer-gilfoyle, security-reviewer (implementation review pending on W15)
- **Relates to:** `plans/plan-admin-portal-phase2.md` §A.6, resolved decision 5, GATE 3 Batch 7 items 1–2, W15; `plans/plan-admin-portal.md` GATE 3 (standing backend gate)

> Built by W15 (Backend Batch 7). This ADR records the two authz/surface changes a
> future reader cannot recover from the diff: why the staff list stopped returning
> viewers for everyone, and why the count endpoint that sits next to it is deliberately
> **not** scoped the same way.

---

## Context

The Phase 2 "Users & roles" screen needs two things from the backend:

1. a **list** of staff to render in a table — one row per person, with name, email, id;
2. a set of **tiles** showing how many accounts exist per role, including viewers.

Facts established from the code, not assumed:

| Observation | Evidence |
|---|---|
| `GET /users` returned `Page[UserPublic]` over **every** user, newest first, no role filter | `app/api/admin_auth.py::list_users`, `auth_service.list_users` before this change |
| The endpoint is already `require_role(MANAGER, ADMIN)` | `ManagerPlus` alias in `admin_auth.py` |
| Viewer accounts are self-registered and unbounded; staff accounts are a handful | `auth_service.register_user` sets `role=VIEWER`; staff come only from `POST /users` |
| `OverviewStats.total_users` counts everyone; `unique_viewers` is distinct users in `playback_sessions` | `analytics_service.overview` — a *listening* population, not the `viewer` role |
| Several tests discovered a freshly-registered viewer's id by calling `GET /users` and filtering the page | `tests/test_user_management.py`, `tests/test_auth_hardening.py:284–295` |

Resolved decision 5 (locked by Isaac): the staff-management list is **role-filter only**
(no `q` / email search), and **managers can never reach viewers**. The consequence was
accepted on the record — promoting a pre-existing viewer to staff is not a Phase 2 portal
flow.

## Decision

### 1 — `GET /users` is hard-scoped to staff roles, for every actor

The list now always applies `role IN (editor, manager, admin)`. It is **not** actor-dependent
(an admin does not get a wider list than a manager) — the list simply never contains a viewer.

- A new optional `role` query parameter narrows **within** staff. `role=editor` /
  `role=manager` / `role=admin` are honoured.
- `role=viewer` is **rejected with 400** at the router boundary, before the service runs.
  The alternative — returning an empty page — was considered and dropped: a 400 says "this
  list does not represent viewers" where an empty page reads as "there happen to be none".
  Never a viewer page, empty or otherwise.
- `UserPublic` is unchanged. No field added, no field removed. The only visible change is
  which rows come back and the new `role` parameter.

Rejected alternative: an actor-dependent scope (managers see staff, admins see everyone).
It is more code, it re-introduces the "enumerate every viewer's email" exposure for admins,
and decision 5 does not ask for it.

**Why this is an ADR and not just a diff:** `GET /users` is public API surface and the
change is authz-adjacent — it removes rows a caller with the same role used to see. A future
reader diffing `auth_service.list_users` sees a `WHERE role IN (...)` appear with no
explanation of whether it is a scope rule or an accident. It is a scope rule.

### 2 — `GET /users/role-counts` is a full-table `GROUP BY role`, viewer bucket included

A new `ManagerPlus` route returning `RoleCounts` — `{viewer, editor, manager, admin, total}`,
every bucket always present and zero-filled. It runs `SELECT role, COUNT(*) FROM users
GROUP BY role` over the **whole** table.

**It is deliberately not scoped like decision 1.** A count is not an enumeration. "There are
1,284 viewers" identifies nobody; a list of 1,284 email addresses identifies 1,284 people.
The privacy property decision 5 protects is *reach to an individual*, and an aggregate has
none. A test asserts the `viewer` bucket is non-zero when viewers exist — specifically so a
later reader who notices the "inconsistency" with decision 1 does not "fix" it and break the
Viewers tile.

Rejected alternative: sourcing the tile from `OverviewStats`. `total_users` counts staff
too, and `unique_viewers` is a listening population, not the `viewer` role. Neither answers
the tile; the aggregate exists because nothing else does.

### 3 — The viewer-discovery tests move onto the DB fixture

Tests that located a registered viewer's id via `GET /users` (`test_admin_changes_role`,
the manager-path role tests, `test_cannot_change_own_role`, `test_role_change_revokes_refresh`,
and the Redis-503 rollback test in `test_auth_hardening.py`) now seed the viewer through the
DB fixture and take the id from the created row. The endpoint was only ever an id-discovery
convenience there; coupling role-management tests to a list endpoint's scoping rules is what
made them fragile. No `?include_viewers` flag, no test-only escape hatch, no per-actor
scoping exception — any of those would re-introduce the surface decision 5 removes.

## Consequences

- **Promoting a pre-existing viewer to staff is not a portal flow in Phase 2.** A viewer has
  no list row, there is no email search, and `POST /users` rejects a duplicate email.
  `POST /users` invites *fresh* staff, which is the observed need. The break-glass path is
  unchanged: `PATCH /users/{id}/role` with an id obtained out-of-band.
- A narrow admin-only `GET /users/by-email` (exact match, single result, no listing) is the
  recorded Phase 3 answer if this bites (`plans/plan-admin-portal-phase2.md` §E 7a). It is
  **not** built now; adding it is a plan amendment.
- `docs/` — the repo-root `openapi.json` is regenerated and committed; the diff is additive
  (two new paths, two new schemas, one new query parameter).
- The count endpoint is one extra uncached `GROUP BY` on a screen a manager opens. `users`
  is small and the query is indexed on nothing in particular, but the row count is low
  enough that this is not a concern at Phase 2 scale. If it ever is, the fix is a short
  Redis TTL, mirroring the `overview()` note in risk P5 — not a rollup.

## Notes for the implementation review (GATE 3 Batch 7)

- `reviewer-gilfoyle` on the batch; `security-reviewer` on this item (item 1).
- The 400-vs-empty choice for `role=viewer` is settled here as **400**; the acceptance
  criterion only requires that it is one of the two and is tested. It is tested
  (`tests/test_portal_batch7.py::test_users_list_rejects_viewer_filter`).
