# API Authentication Subsystem — Code Review

Reviewer: Gilfoyle (code-quality lens; no separate security-reviewer commissioned).
Scope: `app/api/auth.py`, `app/api/admin_auth.py`, `app/core/dependencies.py`,
`app/core/security.py`, `app/core/token_store.py`, `app/services/auth_service.py`,
`app/core/rate_limit.py` (login gating only). Everything else is out of scope.

## Verdict

**Request changes.** The core mechanics are, annoyingly, mostly right: refresh
rotation genuinely invalidates the used jti (confirmed against `rotate_refresh` +
`issue_token_pair` + the tests), logout and password changes revoke, the
access-token-as-refresh type-confusion path is blocked, role-assignment guards
stop a manager minting an admin, and the Argon2 dummy-hash timing mitigation is
real. But `config.py:8` points the runtime at the committed `.env.example`, and
the one validator meant to catch a bad secret key does not catch the placeholder
that file ships — that is a latent full auth bypass gated only on deploy hygiene.
Separately, reset/invite tokens are replayable for their entire TTL, which the
48-hour invite variant stretches into a real window. Fix those two and the rest
is cleanup.

---

## 1. CRITICAL — Runtime config loads the committed example file; the secret-key guard misses its placeholder

**Anchor:** `app/core/config.py:8` (`env_file=".env.example"`), `app/core/config.py:113-118` (`secret_not_default`).

`SettingsConfigDict(env_file=".env.example")` means the only dotenv file ever
read is the one checked into git. A real `.env` is ignored entirely. OS
environment variables still take precedence, so a fully-specified deploy is
unaffected — but any variable left unset silently falls back to the committed
example value instead of failing.

For `secret_key` that is fatal. `.env.example` ships
`SECRET_KEY=replace-with-a-long-random-string-at-least-32-chars`. It is 48
characters, so `Field(min_length=32)` passes. It does not contain the substring
`change-me`, so `secret_not_default` passes. A deployment that forgets to inject
`SECRET_KEY` therefore boots green on a publicly-known HS256 signing key —
anyone can mint a valid access token for any `sub` with `role: "admin"`.
`get_current_user` re-reads the row so the forged user must exist, but that is a
trivial bar.

Same file, same mechanism, compounding: `.env.example` sets `ENVIRONMENT=development`
and `DEBUG=true`. If those leak into a real environment via the fallback,
`is_production` is false, so `production_preflight` (`config.py:120-167`) never
runs at all, and `/docs` + `/openapi.json` come up exposed.

Corroborating: `.env.example` also carries what look like live AWS keys
(`AKIA…`). Out of scope to review, but it is direct evidence that "the example
file" is being treated as a real secrets file. It should hold placeholders only.

**Fix:** point `env_file` at `.env`. Give `secret_key` no default and reject the
known placeholder / require minimum entropy in the validator. Have the preflight
assert on `secret_key` regardless of environment, and consider failing when
`ENVIRONMENT` is unrecognised rather than defaulting to `development`.

---

## 2. HIGH — Password-reset and invite tokens are not single-use

**Anchor:** `app/services/auth_service.py:125-138` (`reset_password`), `app/core/security.py:110-125` (`create_reset_token` / `create_invite_token`).

`reset_password` decodes the RESET token, sets the new hash, revokes refresh
tokens — and never records that the token was consumed. The token stays valid
for its full lifetime. A reset token captured in transit, from browser history,
from a proxy log, or from a forwarded invite email can be replayed to re-set the
victim's password again, as many times as the attacker likes, until `exp`.
Revoking refresh tokens on first use does not help — the reset token itself is
the credential, and it is still live.

`create_invite_token` deliberately reuses `type: "reset"` with a 48-hour TTL so
`/auth/reset-password` consumes it (`security.py:118-125`). The conflation is not
itself a privilege bug: `reset_password` never touches `role` or `is_active`, so
an invite token and a forgot-password token are functionally identical and
neither grants anything the `sub` didn't already have. The problem is purely the
window — it turns a 30-minute replayable-token exposure into a 48-hour one, and
it makes the two token classes indistinguishable in logs and audit.

**Fix:** on mint, store the token jti in Redis with the token's TTL; on use,
atomically delete-and-check (`GETDEL`) and reject if absent. Alternatively add a
`password_changed_at` column and reject any RESET token whose `iat` predates it.
Keep the invite as its own `type` marker so the consuming endpoint and the logs
can tell them apart.

---

## 3. HIGH — `/auth/forgot-password` writes a live reset token to the logs unconditionally

**Anchor:** `app/api/auth.py:112-122`.

```
token = security.create_reset_token(str(user.id))
log.info("password_reset_requested", user_id=..., reset_token=token)
```

The comment says Phase 6 wires real email; until then it logs. `structlog` JSON
logs are shipped to a log platform (per the project conventions), so this puts a
valid, ready-to-use account-takeover credential in front of everyone with log
read access, for the token's whole lifetime. The endpoint is also unauthenticated
and only IP-rate-limited at the global middleware layer, so this is
attacker-triggerable at will.

**Fix:** gate the log line behind `not settings.is_production` exactly as
`create_staff` gates `invite_link` (`admin_auth.py:71-72`), or drop it and rely
on the console email backend, which already logs the link in dev.

---

## 4. MEDIUM — Redis is an undocumented SPOF on the token path, with inconsistent fail modes

**Anchor:** `app/core/token_store.py:17-31` (no error handling), `app/core/rate_limit.py:18-25` (explicit fail-open).

`check_rate_limit` catches everything and returns `True` ("fail open") — a
deliberate, commented choice. `token_store` has no error handling at all. When
Redis is down:

- `login` → `authenticate` succeeds → `issue_token_pair` → `store_refresh_jti`
  raises → the catch-all handler returns **500**.
- `refresh` → `is_current_refresh_jti` → `r.get` raises → **500**.

So token issuance is entirely down during a Redis outage, via an unhandled
exception rather than a deliberate decision, and the client gets a 500 instead of
a 503. Meanwhile the rate limiter on the same outage waves everyone through. The
fail-closed posture on `token_store` is defensible — it is the safer default —
but right now it is accidental and mis-typed.

**Fix:** decide the posture explicitly, document it next to the code the way
`rate_limit` does, and wrap the `token_store` calls so an unreachable Redis
returns `503` with a clear message, not a naked 500.

---

## 5. MEDIUM — Two sibling auth dependencies return two different principal shapes, forcing a re-fetch dance

**Anchor:** `app/core/dependencies.py:34-62` vs `:70-89`; `app/api/admin_auth.py:32-36, 59, 83`.

`get_current_user` / `require_role` yield a frozen `CurrentUser` dataclass.
`get_optional_user` yields a live ORM `User` bound to the request session. The
service layer wants the ORM object: `create_staff(actor: User)` and
`change_role(actor: User)` both take a `User`, so every admin endpoint calls
`_actor(db, current)` to reload the row that `get_current_user` already loaded
and threw away. It usually resolves from the session identity map, so the cost is
low, but it is a smell and a seam where a future change (different session,
lazy attribute) turns into a bug.

**Fix:** pick one shape. Either the service functions accept `CurrentUser` (or
just the id + role) and lose the `actor: User` dependency, or `get_current_user`
yields the ORM `User` and `CurrentUser` goes away. Do not keep both.

---

## 6. LOW — Refresh rotation is check-then-set, not atomic

**Anchor:** `app/services/auth_service.py:109` + `:94-98`.

`is_current_refresh_jti` (a `GET`) and the overwriting `store_refresh_jti` (a
`SETEX`) are separate round trips. Two concurrent requests presenting the same
still-valid refresh token both pass the check, both mint a new pair, and the
later `SETEX` wins. Result: two clients holding usable access tokens from one
refresh token, and the reuse-detection branch never fired.

**Fix:** make the check-and-rotate a single atomic op — `GETDEL` the stored jti,
compare, and only then write the new one; or a small Lua script.

---

## 7. LOW — No "last admin" floor in `change_role`

**Anchor:** `app/services/auth_service.py:226-259`.

Self-demotion is blocked (`:237-238`), but nothing stops two admins demoting each
other until zero admins remain and no one can assign the role back.

**Fix:** refuse a change that would drop the active admin count below one.

---

## 8. LOW — Unhandled 500s on signed-but-malformed input and on uniqueness races

**Anchors:**
- `app/services/auth_service.py:114` — `uuid.UUID(payload["sub"])` has no guard, unlike `get_current_user` (`dependencies.py:46-49`). A validly-signed refresh token with a non-UUID `sub` yields a 500 instead of a 401.
- `app/services/auth_service.py:47-51` (`register_user`) and `:180-181` (`create_staff`) check email uniqueness with a `SELECT` and then `INSERT`. Concurrent requests race past the check to the unique constraint; the `commit` raises `IntegrityError` → catch-all 500 instead of the intended 400.

**Fix:** wrap the `sub` parse in the same `try/except (ValueError, KeyError)` used
in the dependency. Catch `IntegrityError` around the insert commit and translate
to the existing `AuthError` message.

---

## 9. LOW — Fixed-window rate limiter can orphan its key, and has no per-account dimension

**Anchor:** `app/core/rate_limit.py:19-22`.

`INCR` then `EXPIRE` only when `current == 1`. A crash or a lost connection
between the two leaves a counter with no TTL — that IP+email is throttled
permanently until someone clears the key by hand. Also the bucket is keyed on
`login:{ip}:{email}` only, so an attacker rotating source IPs never trips it;
there is no account-scoped counter.

**Fix:** set the TTL atomically (`SET key 1 NX EX window` then `INCR`, or a
pipeline / Lua). Add a second bucket keyed on the account alone with a looser
threshold.

---

## Nits

- `app/api/auth.py:8` — `require_role` is imported and never used.
- `app/services/auth_service.py:12-16` — duplicate aliased imports (`select as _select`, `UserRole as _UserRole`), function-local `secrets` and `func`, all under a blanket `# noqa: E402`. Merge-scar clutter; consolidate to the top of the module.
- `app/api/admin_auth.py:72` — reaches into `email._reset_link`, a private helper. Promote it to a public function.
- `app/core/security.py:79-85` — the access token carries a `role` claim that nothing reads; `require_role` uses the DB-backed `CurrentUser.role`. Harmless, but a claim that lies dormant invites someone to trust it later. Use it or drop it.
- `app/core/security.py:128-143` — `decode_token` sets no `leeway`, and `_create_token` sets `nbf = iat = now`. Freshly minted tokens can be rejected by a peer with a slightly lagging clock. A few seconds of leeway is standard.

---

## Explicitly checked and fine

- Refresh rotation invalidates the used jti; replay returns 401 (`rotate_refresh`, confirmed by `test_refresh_rotates`).
- Logout and password change/reset revoke the refresh jti (`token_store.revoke_refresh`, confirmed by tests).
- Access token rejected on `/refresh` — `decode_token` enforces the `type` claim (`security.py:151-158`).
- Refresh tokens deliberately carry no `role`; `rotate_refresh` re-reads the user row, so a stale refresh cannot mint stale privileges.
- Role-assignment matrix (`_ASSIGNABLE_BY`) stops a manager creating or promoting to manager/admin, and blocks a manager modifying another manager/admin.
- Self-role-change is refused.
- Argon2 dummy-hash on unknown email removes the login-timing enumeration oracle (`security.verify_password`, `authenticate`).
- `/auth/forgot-password` returns an identical response whether or not the email exists (aside from finding 3's log line).
- `decode_token` pins the algorithm, validates aud/iss/exp/nbf, and requires core claims — no `alg: none` acceptance.
- `CurrentUser` is a frozen dataclass; the principal cannot be mutated mid-request.
