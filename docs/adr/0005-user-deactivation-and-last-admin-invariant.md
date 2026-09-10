# ADR 0005 — User deactivation, the last-admin invariant, and the Redis-down deactivation trade

- **Status:** Accepted
- **Date:** 2026-09-10
- **Scope:** `fastapi_sermon` backend — new `PATCH /api/v1/users/{id}/active`,
  new `POST /api/v1/users/{id}/resend-invite`, and a shared last-admin guard now
  enforced on `PATCH /api/v1/users/{id}/role` as well
- **Deciders:** Isaac; architect, planner; `security-reviewer` (mandatory) +
  `reviewer-gilfoyle` (implementation review pending on W18)
- **Relates to:** `plans/plan-admin-portal-phase2.md` §A.5, §A.6, W18, `[HUMAN_GATE 6]`,
  resolved decisions 8–10; risks P1, P2; `plans/plan-admin-portal.md` `[HUMAN_GATE 3]`

> Built by W18. This records four things a future reader cannot recover from the
> diff: who may call the new deactivate endpoint, the minimum-cardinality
> invariant and its `FOR UPDATE` mechanism (and why a partial unique index
> cannot express it), the deliberate Redis-down divergence from `change_role`,
> and the harness limitation that leaves the concurrent case to one PG-gated
> module.

---

## Context

The "Users & roles" screen needs to deactivate a departed staff member and
reactivate a returning one. Facts established from the code, not assumed:

| Observation | Evidence |
|---|---|
| Departed staff are modelled as `is_active=false`; attribution is unchanged (resolved decision 9) | `User.is_active`; no `departed_at` column exists |
| `get_current_user` re-reads the user row **every request** and rejects `is_active=False`; it also sources `role` from that row, not the JWT | `app/core/dependencies.py::get_current_user` |
| `change_role` blocks self-demotion and revokes refresh tokens **before** commit, so a Redis outage 503s it with the role change rolled back | `auth_service.change_role`, `token_store` module docstring |
| Nothing enforces "there is always an admin" — it is unreachable today only because self-demotion is blocked and there is no other lockout path | `auth_service.change_role` before this change |
| Invite state is a Redis single-use jti with a 48h TTL — no `invited_at` / `last_login_at` column (resolved decision 8) | `auth_service.create_staff`, `security.create_invite_token` |
| `FOR UPDATE` is house style for in-transaction guards, and it is a no-op under SQLite | `content_service.transition` / `take_over_review` (`stmt.with_for_update()`) |

Adding a deactivate endpoint makes zero-admin a two-click operation with no
recovery short of `app/scripts/create_admin` (risk P1). Copying `change_role`'s
revoke-before-commit ordering would 503 the one endpoint whose purpose is to
stop someone, exactly when Redis is down (risk P2). Both were put to GATE 6.

## Decision

### 1 — `PATCH /users/{id}/active` — authz rule and who may call it

Body: `{"is_active": bool}` — `false` deactivates, `true` reactivates. The
endpoint sits behind `require_role(MANAGER, ADMIN)` (editor / viewer → 403 at
the dependency, before any handler code). The service then mirrors
`_ASSIGNABLE_BY` — the same matrix `change_role` and `create_staff` use:

| Actor | May deactivate / reactivate |
|---|---|
| **manager** | an **editor** only. A manager targeting a manager or an admin — self included, since a manager is not an editor — is refused **403**. |
| **admin** | **anyone**, subject only to the last-admin invariant below. An admin *may* deactivate themselves when another active admin exists; the sole active admin cannot (409). |

Returns `UserActiveResponse` — `{user: UserPublic, revocation_deferred: bool}`.
`revocation_deferred` is normally `false`; see §3 for when it is `true`. The
wrapper (rather than a bare `UserPublic` like `change_role`) exists precisely
because the GATE 6 trade is about the *observability* of a failed revoke.

`404` if the target does not exist. Deactivating an already-inactive account
(or reactivating an already-active one) is an idempotent `200` no-op.

### 2 — The last-admin invariant: minimum cardinality, `FOR UPDATE`, one shared helper

**The invariant:** `COUNT(*) FROM users WHERE role = 'admin' AND is_active = true`
must never reach 0.

**Mechanism (GATE 6 = §A.5 option A).** `auth_service._assert_not_last_active_admin`:

1. Returns immediately unless the target is *itself* an active admin — no other
   change can reduce the active-admin population.
2. `SELECT id FROM users WHERE role = 'admin' AND is_active = true ORDER BY id FOR UPDATE`,
   in the caller's transaction. `ORDER BY id` gives a deterministic lock order
   so two of these racing each other **block** rather than deadlock.
3. If the locked set has `≤ 1` row (that row being the target), the caller's
   pending change would zero the count → `ContentError("… last active
   administrator …", status_code=409)`.

The lock set always contains the target on any path that can reach zero, so a
concurrent transaction attempting the same thing blocks on step 2 until this
one commits, then re-reads a set of size 1 and is refused.

**It is enforced on BOTH mutating paths, from ONE helper, so they cannot drift
or race each other:**

- `set_active` — before setting `is_active=False`.
- `change_role` — before a demotion **out of** the admin role (`new_role != admin`).

On `change_role` the guard is, sequentially, unreachable: the sole active admin
can only be demoted by themselves (already blocked with a 400 "You cannot change
your own role"), and any other admin actor implies a second active admin, so the
count is never 1. It is wired in regardless — the concurrent `change_role` ×
`set_active` race is real, and a shared helper is the only way the two paths
stay consistent as the code evolves.

**Why not a partial unique index.** A partial unique constraint
(`UNIQUE (…) WHERE role='admin' AND is_active`) bounds cardinality from
**above** — it enforces "at most one active admin", the exact opposite of what
is wanted. This is a **lower**-bound (minimum-cardinality) rule, and no unique
constraint can express one. This is the trap the next person will otherwise
re-derive; it is written down here so they do not.

### 3 — Redis-down deactivation: commit-first (GATE 6 = §A.6 option B), diverging from `change_role`

`set_active`, on deactivation:

1. `is_active = False`, then **`await db.commit()`** — the lockout lands first.
2. *Then* `token_store.revoke_refresh(...)`, best-effort. On
   `TokenStoreUnavailable` the call still returns **`200`** with
   `revocation_deferred = true` and logs `deactivate_revoke_deferred`
   (structured: `user_id`, `by`). It does **not** 503.

**Rationale.** `get_current_user` re-reads `is_active` on every request and
rejects an inactive user regardless of whether the refresh token was revoked.
The residual exposure of a non-revoked refresh token is therefore one
access-token lifetime (it can still mint an access token, which the next request
rejects), not an open session. Weighed against that: a 503 here means *you
cannot lock out a compromised account while Redis is down* — the failure mode
this endpoint exists to prevent. Availability of the lockout control wins.

**This deliberately diverges from `change_role`**, which revokes **before**
commit and **does** 503 on a Redis outage (with the role change rolled back).
The divergence is intentional and asymmetric: a delayed role *downgrade* that
leaves elevated sessions briefly live is a genuine privilege problem worth
failing closed for; a delayed *token revoke* behind an already-committed
`is_active=False` is not, because the row check is authoritative on every
request. `reset_password` / `change_password` keep their revoke-before-commit
ordering too — deactivate is the single considered exception.

Reactivation does no token work (there are no live sessions for an account that
has been rejected on every request) and never touches the invariant.

### 4 — `POST /users/{id}/resend-invite`

Re-issues a staff invite: a fresh single-use jti + a fresh invite email via the
same `email` seam `create_staff` uses. Same authz matrix as §1.

- **Already activated → `409`.** With no `invited_at` column (decision 8),
  "invited, never set a password" is tracked as a **durable, no-TTL** Redis flag
  `invite_pending:{user_id}` — set in `create_staff` and `resend_invite`,
  cleared in `reset_password` once the account sets its own password. It has no
  TTL on purpose: the invite *link* expires on its jti, but a still-pending
  account must stay re-invitable well past 48h. A full Redis data loss makes
  `resend-invite` report a still-pending account as already activated — a
  spurious `409`, which is the safe direction to fail (the unsafe direction
  would be re-issuing a working password-set link for a live account).
- **Redis down → `503`.** Unlike deactivate, this operation *is* the single-use
  jti; without it the emailed link does not work, so there is nothing to degrade
  to. `create_staff` gets the same explicit `503` mapping, with a message that
  says the account was **not** created (the create is transactional) rather than
  the generic "please retry".

### 5 — "Deactivated token rejected at next request" is already true — a test, not a change

`get_current_user` already re-reads the row and rejects `is_active=False`.
`tests/test_user_lifecycle.py::test_deactivated_user_live_access_token_rejected_next_request`
proves it (login → deactivate → same still-unexpired access token → `401`).
Nothing was implemented for this.

## Consequences

- **Harness limitation (decision 10, §A.5).** SQLite ignores `FOR UPDATE` and is
  single-writer, so the default suite proves only the **sequential** invariant
  (the last active admin is refused on both paths, for every actor including
  themselves). The **concurrent** case — two simultaneous demote/deactivate
  transactions leave exactly one admin — is proved in **one** PG-gated module,
  `tests/test_last_admin_concurrent.py` (real PostgreSQL via a throwaway
  database; `pytest.skip` with a reason when none is reachable, honouring
  `TEST_PG_DSN`). This module is **capped at one** — a second PG-gated module is
  a plan amendment, not an executor's call.
- **Break-glass unchanged.** `app/scripts/create_admin` still bootstraps or
  promotes an admin directly against the DB, covered by
  `tests/test_user_lifecycle.py::test_create_admin_script_bootstraps_and_promotes`.
- `openapi.json` (repo root) is regenerated and committed; the W18 diff is
  additive — two new paths (`PATCH /users/{id}/active`,
  `POST /users/{id}/resend-invite`) and two new schemas (`ActiveUpdateRequest`,
  `UserActiveResponse`). The W16 diff is empty by design (nothing reads that
  column).
- A new Redis key namespace, `invite_pending:{user_id}`, with no TTL — the
  codebase's first non-expiring key. Justified above; the alternative (an
  `invited_at` column) was cut by decision 8.

## Notes for the implementation review (GATE 6)

- `security-reviewer` **mandatory** on this item, plus `reviewer-gilfoyle`.
- The two decisions GATE 6 made rather than the implementer: the invariant
  mechanism (§A.5 A/B/C → **A**) and the Redis-down deactivation trade
  (§A.6 A/B/C → **B**). Both are recorded above as decided facts.
- Coverage: `tests/test_user_lifecycle.py` (authz matrix, sequential invariant
  on both paths, Redis-outage deactivate → 200 + logged defer, resend-invite
  happy / 409 / 503, deactivated-token rejection, break-glass) and
  `tests/test_last_admin_concurrent.py` (the concurrent case).
