# Admin Settings S9 — Security Review: auth instrumentation and audit storage

Plan: `plans/plan-admin-settings.md`, step S9 (read-only review of S6–S8).
Scope: `app/services/audit_service.py` (write side), `app/core/dependencies.py`
(`get_audit_context`), the S7/S8 call sites in `app/services/auth_service.py`,
`app/services/oauth_service.py`, `app/api/auth.py`, `app/api/admin_auth.py`,
the BFF User-Agent forward (`admin_portal/lib/auth/user-agent.ts` and its
callers), and `app/scripts/purge_audit_log.py`.

Reviewer note: this pass was done by the same agent that wrote S7/S8, not by
an independent `security-reviewer`. Weigh it accordingly at `[HUMAN_GATE AS4]`.

## Verdict

**No open blocking findings.** One blocking issue was found and fixed during
S8: a pre-existing account-enumeration timing oracle in `authenticate`
(finding 1), which the plan assumed was already closed. One robustness
issue in the new code was fixed (finding 2). The rest are accepted residuals.

---

## 1. BLOCKING, FIXED — `authenticate` never ran its dummy Argon2 verify

**Anchor:** `app/services/auth_service.py`, `authenticate`.

The plan (§A.3, DoD bullet 5) relies on `authenticate` costing the same for
an unknown email as for a known email with a wrong password. It didn't:

```python
if user is None or not security.verify_password(password, stored):
```

`or` short-circuits, so for an unknown email `verify_password` (and its dummy
hash) never ran. Measured against a live server, 40 interleaved attempts each:

| Build | Known email, wrong password | Unknown email |
|---|---|---|
| `dev` @ `5559d07` (before) | 69.6 ms median | 6.8 ms median |
| this branch, after fix | 66.7 ms median | 66.3 ms median |

A roughly 10x latency gap tells anyone whether an email has an account. It
predates this plan; it was present in the earliest commit in history.

**Fix:** call `verify_password` unconditionally, then branch. A regression
test (`test_unknown_email_still_runs_the_password_hash`) asserts the dummy
verify runs for an unknown email.

## 2. FIXED — client-supplied `X-Correlation-ID` could fail an audited mutation

`CorrelationIdMiddleware` accepts any inbound `X-Correlation-ID`, unbounded.
`audit_log.correlation_id` is `varchar(64)`, so on Postgres an over-long
header would have raised `StringDataRightTruncation` inside the same
transaction as a role change or deactivation, failing it with a 500.
`get_audit_context` now truncates to 64 (and the UA to 512). The IP is
validated with `ipaddress` and recorded as NULL if `client_ip` returns a
non-address (`"unknown"`) or a scoped IPv6 literal that INET rejects.
Test: `test_oversized_correlation_id_is_truncated_not_fatal`.

## 3. Enumeration via `auth.login_failed` — not an oracle

- The row is written by a Starlette `BackgroundTask` attached to the 401,
  so the account lookup and insert run after the response is sent. The
  route returns a `JSONResponse` instead of raising `HTTPException`, because
  FastAPI drops injected background tasks when the handler raises. Status,
  body shape and `detail` are identical to the handler's output.
- `test_login_failed_adds_no_db_work_to_the_request_path` records every SQL
  statement and asserts the request-path statements for a known email are
  identical to an unknown email's, with no `audit_log` statement before the
  background job starts.
- OAuth verification failures write nothing (no verified identity).

## 4. PII in `details` — acceptable

No row stores a password, token, reset link or comment body. `details` holds
method, reason, role names, token *type* (`reset`/`invite`) and
`new_account`. The actor's email is snapshotted (`actor_email`), as the
plan intends, so rows survive account erasure. `auth.login_failed` stores
the attempted account's email, which is only written for an email that
already exists. All of this is personal data, which §A.2 already flags for
the privacy policy.

## 5. Header injection via the forwarded UA — not exploitable

The BFF strips C0 control characters and DEL and truncates to 512
(`userAgentFrom`); `Headers.set` would also throw on CR/LF. The backend
strips CR/LF again and truncates. The UA is informational only and never
used for any trust decision.

## 6. IP spoofing — bounded by existing controls

- The BFF never reads inbound `X-Forwarded-For`/`X-Real-IP`, only the
  configured `CLIENT_IP_HEADER`. Verified live: a browser-supplied
  `X-Forwarded-For: 198.51.100.66` was ignored and `audit_log.ip` recorded
  the trusted header's `203.0.113.7`.
- The backend trusts XFF only from `TRUSTED_PROXIES`, which
  `trusted_proxies_are_scoped` (`config.py`) caps at /8 (IPv4) and /32
  (IPv6), rejecting world CIDRs.
- Residual risk: a deployment that sets `CLIENT_IP_HEADER` to a header its
  own edge does not overwrite would let clients choose their recorded IP.
  `DEPLOYMENT.md` (S14) must say the header has to be set *by* the edge
  from the TCP peer, never passed through.

## 7. Fail-open masking a brute-force burst — accepted

`auth.login` / `auth.logout` / `auth.login_failed` swallow insert errors
after logging `audit_write_failed` (with `action` and `correlation_id`).
Login throttling is independent (`login:` rate-limit bucket), so a broken
audit table doesn't weaken brute-force protection. The structlog error
volume is the alert signal, as the plan intends.

Residual: an attacker who knows a valid email can cause one
`auth.login_failed` row per attempt, bounded by the per-IP+email login rate
limit (10/min) and the global limiter. Rows expire with the 365-day
`auth.*` retention.

## 8. Retention purge — correct as implemented in S6

`purge_audit_log.py` deletes `auth.*` rows older than
`AUDIT_AUTH_RETENTION_DAYS` and nulls `ip`/`user_agent` on every other row
older than `AUDIT_NETWORK_RETENTION_DAYS`, both 365 days per Isaac's AS0
decision. Both settings default to 365 and reject a value below 1 at
startup, and the S6 tests pin both boundaries. Scheduling it is S14's deploy concern.

## 9. Low — duplicate `client_ip_fallback` warnings

`get_audit_context` calls `client_ip`, and so does the login rate limiter (and
`GlobalRateLimitMiddleware`). When the forwarding chain is misconfigured, a
request can now log `client_ip_fallback` more than once. That is noisier but
still correct (the volume is still the signal); not worth threading the
resolved IP through to avoid it.

## IP/UA verification (S8 task)

Run on a local stack (Postgres 17, Redis, uvicorn, `next dev`), because
`docker-compose.yml` has no admin portal service and sets neither variable:

| Case | Portal `CLIENT_IP_HEADER` | Backend `TRUSTED_PROXIES` | Recorded `ip` | Recorded `user_agent` | Fallback warning |
|---|---|---|---|---|---|
| A | `x-real-ip` | `["127.0.0.1"]` | browser's (`203.0.113.7`, …) on login, failed login, staff invite and logout | browser's | none |
| B | unset | `["127.0.0.1"]` | `127.0.0.1` (the BFF) | browser's | `client_ip_fallback reason=no_xff` |

Required production values for S14's `DEPLOYMENT.md`: `CLIENT_IP_HEADER`
naming a header the portal's edge sets from the TCP peer, and the BFF's
address (or narrow subnet) in the backend's `TRUSTED_PROXIES`.
