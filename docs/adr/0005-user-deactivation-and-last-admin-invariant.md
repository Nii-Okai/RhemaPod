# ADR 0005 — User deactivation, the last-admin invariant, and the Redis-down deactivation trade

- **Status:** Accepted
- **Date:** 2026-09-10
- **Scope:** `fastapi_sermon` backend — new `PATCH /api/v1/users/{id}/active`,
  new `POST /api/v1/users/{id}/resend-invite`, and a shared last-admin guard now
  enforced on `PATCH /api/v1/users/{id}/role` as well
- **Deciders:** Isaac; architect, planner; `security-reviewer` (mandatory) +
  `reviewer-gilfoyle`
- **Relates to:** `plans/plan-admin-portal-phase2.md` §A.5, §A.6, W18, `[HUMAN_GATE 6]`,
  resolved decisions 8–10; risks P1, P2; `plans/plan-admin-portal.md` `[HUMAN_GATE 3]`

> Built by W18. This records four things a future reader cannot recover from the
> diff: who may call the new deactivate endpoint, the minimum-cardinality
> invariant and its `FOR UPDATE` mechanism (and why a partial unique index
> cannot express it), the deliberate Redis-down divergence from `change_role`,
> and the harness limitation that leaves the concurrent case to one PG-gated
> module.
>
> **Revised after the W18 security + code review of `a0c2575`** (Isaac's
> ruling): §4 no longer uses a no-TTL `invite_pending` Redis key — that had a
> Redis-blip account-takeover window — but a nullable `users.activated_at`
> column set pre-commit in the same transaction as the password write. §3 now
> also revokes refresh tokens on *reactivation* (CWE-613). Resend-invite gains a
> per-target rate limit and prior-link retirement (CWE-770). This partially
> reverses resolved decision 8's "no invite-state column": `activated_at` is a
> lifecycle timestamp, not the `invited_at` audit field decision 8 weighed.
>
> **Revised again after the security re-check of `d3390d7`** (still a `🔴`): that
> pass stamped `activated_at` only in `reset_password`, so self-registered→
> promoted users, pre-migration rows, and bootstrap admins all held a real
> password with `activated_at IS NULL` and `resend_invite` would still mint a
> working set-password link for them. §4 now stamps `activated_at` on **all**
> first-password paths (table below) **and** backfills every pre-migration row
> in `a6b7c8d9e0f1.upgrade`. The "only the newest set-password link ever
> completes" claim is softened to "at most `limit` live links per rate-limit
> window".

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

Reactivation never touches the invariant (it only raises the active-admin
count). It does, however, do a **best-effort `revoke_refresh` on the reactivated
account** (CWE-613): if the *prior* deactivation deferred its revoke because
Redis was down, `refresh:{uid}` still holds the pre-deactivation jti, and
reactivating within the 30-day refresh TTL would otherwise re-arm a credential
the deactivation was meant to kill. Same commit-first posture as deactivation —
`is_active=true` commits, then the revoke is attempted; a Redis outage still
returns `200` with `revocation_deferred=true` (and logs
`reactivate_revoke_deferred`), never `503`.

### 4 — `POST /users/{id}/resend-invite`

Re-issues a staff invite: a fresh single-use jti + a fresh invite email via the
same `email` seam `create_staff` uses. Same authz matrix as §1.

- **Already activated → `409`, decided by `users.activated_at`.** A nullable,
  timezone-aware `users.activated_at` column (second additive Phase 2 migration,
  `a6b7c8d9e0f1`, chained off `f5a6b7c8d9e0`; `nullable=True`, no default) is the
  authoritative record of "has this account finished its invite?". `NULL` =
  invited, never set a password. `resend_invite` refuses with `409` when
  `target.activated_at is not None`.

  It is stamped — `datetime.now(timezone.utc)`, **only when currently `NULL`**,
  and **in the same transaction as the password write (before `db.commit()`)** so
  it can never lag the password (fail-closed) — on **every path that sets a
  self-chosen first password**, not just invite acceptance:

  | Path | When |
  |---|---|
  | `auth_service.reset_password` | invite acceptance / forgot-password (only if NULL — a forgot-password reset on an already-active account keeps the earlier stamp) |
  | `auth_service.register_user` | at row creation — self-registration is activation by definition |
  | `auth_service.change_password` | defensively — anyone changing a password has a live account |
  | `auth_service.authenticate` (rehash) | defensively — a successful auth on an active row proves the account is live |
  | `app/scripts/create_admin.py` | both the fresh bootstrap create and the `existing.is_active = True` promote branch |
  | `app/scripts/seed_dev.py` | seeded staff + listeners are live dev accounts |
  | `auth_service.create_staff` | **never** — this is the one path that *creates* the pending invite; `activated_at` stays `NULL` here, correctly |

  **Backfill.** `a6b7c8d9e0f1.upgrade` runs
  `UPDATE users SET activated_at = created_at WHERE activated_at IS NULL` after
  adding the column. Every row that predates the migration is an account that has
  been in use → activated by definition; leaving it `NULL` would let
  `resend_invite` mint a working set-password link for it (the same
  CWE-620/640 class as the original finding, triggered by the migration gap
  instead of a Redis blip). The safe direction: a genuinely-pending pre-migration
  invite becoming non-resendable is acceptable; a live account staying resendable
  is the vulnerability — so backfill **all** NULLs. `created_at` (always present,
  server-defaulted) is used rather than `now()` — it is truthful about the
  account's real age.

  **Why not `activated_at IS NULL` as a bare proxy.** It is only a safe "invite
  still pending" signal if *every* path that gives an account a real password
  stamps it. The review of `d3390d7` (which stamped it only in `reset_password`)
  showed three populations — self-registered-then-promoted users, pre-migration
  accounts, bootstrap admins — holding a real password with `activated_at IS
  NULL`, so `resend_invite`'s guard did not fire. The fix is the table above plus
  the backfill, not a different column.

  **Why not the earlier no-TTL Redis flag.** W18 originally tracked this as a
  non-expiring `invite_pending:{user_id}` Redis key set in `create_staff` and
  cleared in `reset_password`. The security review of `a0c2575` showed the clear
  ran *after* `db.commit()`: a Redis blip in the window between the password
  commit and the clear leaves `invite_pending = true` on a now-active account,
  and `resend-invite` then emails a working set-password link for a live
  staff/admin account — account takeover (CWE-620/640). The claim that the key
  "only fails safe" was backwards; it had an unsafe direction. It was also the
  codebase's first immortal key, with the eviction policy pinned nowhere
  (`allkeys-lru` would silently drop it and wrongly `409` a genuine pending
  invite). A DB column set pre-commit in the same transaction has neither
  failure mode: no Redis dependency for the "is this activated?" question, and
  the flag physically cannot outrun or lag the password write.

- **Prior invite link retired on resend (CWE-770).** Each `create_staff` /
  `resend_invite` records the *current* invite jti under a self-expiring
  `invite_jti:{user_id}` key (TTL = the invite token's own 48h; **this one does
  expire** — it is a pointer to a live jti, not a durable fact). `resend_invite`
  pops that pointer and `consume_single_use`s the old jti *before* minting the
  new one. This bounds live set-password links to **at most `limit` (3) per
  rate-limit window** — *not* strictly one: two concurrent resends both clear the
  rate limit, only one wins the pointer `GETDEL`, and each still registers a live
  jti; and a `TokenStoreUnavailable` while consuming the prior jti (pointer
  already popped) leaves that jti live for its TTL with no pointer left to retire
  it. The 3/hour cap is what genuinely bounds the fan-out; retirement removes the
  *common-case* extra link. `register_single_use` + `remember_invite_jti` now
  share one `try` in `resend_invite`: on `TokenStoreUnavailable` the caller gets
  a clean `503` and the just-registered jti is best-effort consumed, so a `503`
  never leaves a live-but-un-pointed link (consistent with `create_staff`). A
  failed *send* (generic error) keeps the new, *pointed* link so the next resend
  can retire it — the admin simply resends.

- **Per-target rate limit (CWE-770).** `resend_invite` is capped at **3 per
  hour per target** via the existing `check_rate_limit` fixed window
  (`resend_invite:{target_id}`), so it cannot be used to mail-bomb an address or
  keep a fan-out of live links in flight. Over the cap → `429`. It fails **open**
  on a Redis outage, like `login` — the `503` below is the real backstop when
  Redis is down.

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
  `POST /users/{id}/resend-invite`), two new schemas (`ActiveUpdateRequest`,
  `UserActiveResponse`), and — from the review fix pass — a new
  `UserPublic.activated_at` field (`string(date-time) | null`) that flows to
  every `UserPublic` serialization site (`list_users`, `change_role`,
  `create_staff`, and both lifecycle responses). The W16 diff is empty by
  design (nothing reads that column).
- **Second additive Phase 2 migration**, `a6b7c8d9e0f1` (`users.activated_at`,
  nullable, no default), chained off `f5a6b7c8d9e0`. `upgrade` also backfills —
  `UPDATE users SET activated_at = created_at WHERE activated_at IS NULL` — so no
  pre-migration row stays resend-invitable. `downgrade` still just drops the
  column. `alembic upgrade head → downgrade -2 → upgrade head` round-trips the
  `users` and `processed_webhooks` *schemas* exactly (the roundtrip asserts
  column presence/absence, not data); `tests/test_migration_roundtrip.py`
  (PG-gated) also has a dedicated test that inserts a pre-migration row and
  asserts the backfill stamped it with its own `created_at`.
- **No non-expiring Redis keys.** The review fix pass removed the no-TTL
  `invite_pending:{user_id}` flag entirely (see §4). The only invite-related
  Redis key now is `invite_jti:{user_id}`, which carries the invite token's own
  48h TTL. "Is this account activated?" is a DB column question.

## Notes for the implementation review (GATE 6)

- `security-reviewer` **mandatory** on this item, plus `reviewer-gilfoyle`.
- The two decisions GATE 6 made rather than the implementer: the invariant
  mechanism (§A.5 A/B/C → **A**) and the Redis-down deactivation trade
  (§A.6 A/B/C → **B**). Both are recorded above as decided facts.
- Coverage: `tests/test_user_lifecycle.py` (authz matrix, sequential invariant
  on both paths, Redis-outage deactivate → 200 + logged defer, resend-invite
  happy / 409 / 503, deactivated-token rejection, break-glass; and from the fix
  pass — `activated_at` on every `UserPublic` site, forgot-password does not move
  it, reactivation revokes a deferred-revoke refresh token, resend rate-limit
  429, resend retires the prior link; and from the `d3390d7` re-check — self-
  registration stamps `activated_at`, a self-registered→promoted user's resend
  is `409`, `change_password` stamps a NULL row then resend is `409`, a
  bootstrapped admin's resend is `409`), `tests/test_last_admin_concurrent.py`
  (the concurrent case, now with a `guard_barrier` fixture that forces the
  second transaction's guard `SELECT` to land while the first still holds its
  `FOR UPDATE` locks), and `tests/test_migration_roundtrip.py` (both Phase 2
  migrations up/down/up).
