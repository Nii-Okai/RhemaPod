# ADR 0002 — BFF session design

- **Status:** Accepted
- **Date:** 2026-09-09
- **Scope:** `admin_portal/` — where the auth tokens live and how the portal talks to FastAPI
- **Deciders:** Isaac; architect, security-reviewer, scribe
- **Relates to:** `plans/plan-admin-portal.md` §A.2 / §A.7 / §A.8 / §A.10, Amendments A1–A3, GATE 2; `DEPLOYMENT.md` §8; `docs/adr/0001-tier1-production-readiness.md`

> Built by W4 (BFF proxy, login, logout, set-password) and adjudicated by the mandatory
> `security-reviewer` pass on that work item (verdict: SHIP WITH FIXES). This ADR records
> **what shipped** in `admin_portal/lib/auth/` — where the code diverged from plan §A.2,
> the code is what is documented here.

---

## Context

The portal is a Next.js app in front of a hand-rolled-JWT FastAPI API (`pyjwt` HS256,
short-lived access token ~15 min, long-lived refresh token 30 d, rotated on every
`/auth/refresh` with the old `jti` burned in Redis). The locked product decision is that
the browser talks only to the Next app, same-origin. The open question was where the two
tokens live and how requests reach FastAPI.

Facts that shaped the decision, established from the code, not assumed:

| Observation | Evidence |
|---|---|
| The refresh token rotates on every use; the old `jti` is burned immediately | backend `auth_service` refresh path |
| A single portal page load fans out to ~5 proxied requests | plan §A.2 "concurrency hazard", §A.10 arithmetic |
| The backend rate limiter keys on `request.client.host` with no proxy-header handling, at 300 req / 60 s | `app/core/middleware.py`; plan §A.10 |
| `/openapi.json` is served only under `DEBUG=true` | `main.py`; the spec is dumped to a file instead (`app/scripts/dump_openapi.py` → repo-root `openapi.json`) |
| Several public GET routes return staff-only counts when a bearer is present | `DEPLOYMENT.md` §8; `content_service.staff_sees_full_counts` |

### Options considered

1. **Tokens in JS-readable storage** (`localStorage` or in-memory), browser calls FastAPI
   directly, CORS on the API.
2. **Tokens in `httpOnly` cookies + a BFF proxy** in the Next app — the browser holds no
   token and only ever calls Next, same-origin.
3. **A full server-side session store** — an opaque session id in a cookie, tokens and
   session state held server-side in Redis.

## Decision

**Option 2 — the BFF proxy.** Both tokens live in `httpOnly` cookies the browser cannot
read. `app/api/bff/[...path]` (`lib/auth/proxy.ts`) is the one place an `Authorization`
header is attached; `app/api/auth/*` handle login / refresh / logout / set-password /
forgot-password. All of it runs on the Node runtime (`export const runtime = "nodejs"`,
`dynamic = "force-dynamic"`).

### Where the tokens live

The shipped cookie spec (plan Amendment A1 — supersedes the §A.2 attribute table):

| Cookie | Name (prod) | Name (dev) | Path | SameSite | Secure | `httpOnly` |
|---|---|---|---|---|---|---|
| access | `__Host-rp_at` | `rp_at` | `/` | Lax | prod only | yes |
| refresh | `__Secure-rp_rt` | `rp_rt` | `/api` | Strict | prod only | yes |

- The `__Host-` / `__Secure-` prefixes are invalid without `Secure`, and a prefixed cookie
  on `http://localhost` is rejected by the browser outright — so dev uses the bare names.
  Name and `Secure` are gated on the **same** `IS_PROD` (`NODE_ENV === "production"`) test,
  in `lib/auth/cookies.ts`.
- The refresh cookie cannot take `__Host-` because that prefix requires `Path=/` and the
  refresh cookie is scoped to `Path=/api` (keeping the 30-day credential off document
  navigations and the `/_next` asset stream). It takes `__Secure-` instead. This rests on
  the deployment assumption in Amendment A2: no attacker-influenceable sibling subdomains
  under the registrable domain.
- `Path` / `SameSite` / `Secure` are defined once per cookie (`AT_SPEC`, `RT_SPEC`) and
  shared by set and clear, so logout clears on the exact attributes the cookies were set
  with. A "keep me signed in" of `false` writes the refresh cookie as a session cookie
  (no `Max-Age`) — a security-positive shortening only.
- **No Next-side cookie signing secret.** The cookie value is the backend-signed JWT and is
  `httpOnly`; a second signature buys nothing and adds a secret to manage. This is a
  decision — do not "fix" it later.
- **Session bootstrap:** `(portal)/layout.tsx` is a Server Component that reads `rp_at`,
  calls `GET /api/v1/auth/me` server-to-server, and passes `{id, email, name, role}` into a
  client `SessionProvider` (`lib/auth/session.ts`, wrapped in React `cache()`). Nothing is
  written to a client-readable cookie; nothing goes to `localStorage`.

### The proxy and refresh

`lib/auth/proxy.ts`, per request:

1. Blocklist `auth/*` credential paths (`auth/login`, `auth/refresh`, `auth/register`,
   `auth/reset-password`, `auth/forgot-password`, `auth/logout`) → **404**, with
   slash-normalisation so `//` and `%2F%2F` variants cannot slip it (Amendment A3). This
   stops a same-origin/XSS caller from `POST /api/bff/auth/login` and reading a raw
   `TokenPair` out of a JS-readable body. `auth/me` stays allowed.
2. CSRF check on mutating methods (below).
3. Read `rp_at`. If it is missing or within **60 s** of expiry (`isExpiringSoon`,
   `lib/auth/jwt.ts` — an unverified `exp` decode; FastAPI verifies the signature) and
   `rp_rt` exists → refresh **preemptively**.
4. Forward `METHOD /api/v1/<path>` with the bearer and a small header allowlist. The
   inbound `x-correlation-id` is forwarded only if UUID-shaped, otherwise a fresh one is
   minted.
5. If the upstream is **401** and `rp_rt` exists and we have not already refreshed this
   request → refresh **once**, forward once more.
6. Relay the upstream status / body / header allowlist, plus `Set-Cookie` if a refresh
   rotated the pair. An unexpected upstream 3xx → 502.

A refresh that fails with a real auth error (401 — reuse / expired) clears both cookies and
returns 401. A refresh that fails 5xx is a transient blip: relay 503, keep the cookies, and
in the preemptive path fall through on the current access token if it is still valid.

### Refresh concurrency

Concurrent proxy requests that each find an expired access token would each call the
rotating `/auth/refresh`; all but the first present an already-burned `jti` → cascading
401 → the user is logged out mid-session. Two things prevent that:

- **Preemptive refresh with the 60 s skew** makes the reactive 401 path the exception, so
  most refreshes happen on a single request.
- **`lib/auth/exchange.ts` keeps a module-scope `Map<refreshToken, Promise<RefreshResult>>`.**
  Concurrent callers in the same Node process presenting the same refresh token await the
  same promise, so exactly one `/auth/refresh` goes out. The first synchronous caller wins
  the race — there is no `await` between the map lookup and the set, so the dedupe is real,
  not best-effort.
- **As-built, not in plan §A.2:** a *successful* rotation stays addressable by the **old**
  refresh token for a short window (`RESULT_TTL_MS`, 2 s) rather than being dropped the
  instant it settles, so a straggler tab still holding the pre-rotation token is handed the
  new pair instead of racing into a backend reuse-detection 401 that would clear cookies
  for the whole browser. Trade-off: for those 2 s a genuinely replayed old refresh token on
  this instance also gets a fresh pair. The window is kept short to bound that; the proper
  fix is the backend reuse-grace window, which supersedes this entirely.

**Single Next instance only.** The dedupe map and the 2 s retention are per-process. Phase 1
ships as one instance (or sticky sessions) by plan resolved decision 7. A move to
multi-instance reopens plan **GATE 3 #9** (a backend reuse-grace window) and must be taken
*before* the topology changes — the trigger is a multi-instance deploy, and it is checked
before any deploy, not discovered when users start getting logged out. A Redis mutex in the
portal was rejected: it gives the portal a Redis dependency to solve a problem that only
exists once the portal is multi-instance.

### CSRF

The proxy supplies the bearer, so any request reaching it with a valid cookie is fully
authenticated — `SameSite` is a browser behaviour, not a spec guarantee, and does not stop
a same-site subdomain attacker. So `lib/auth/csrf.ts` requires, on every mutating method
(POST / PUT / PATCH / DELETE), either `Sec-Fetch-Site: same-origin` **or** an `Origin`
header exactly equal to `PORTAL_ORIGIN`. Anything else → 403. This guard runs in the proxy
**and** in every `/api/auth/*` handler including login, which makes forced-login CSRF a
non-issue. Double-submit CSRF tokens were rejected — a cookie, a header, a provider and a
failure mode to defend a class the Origin check already covers, in a tool that will never
be embedded cross-origin. `SameSite` on the cookies is defence-in-depth, not the primary
control.

### Client IP for the backend rate limiter

Behind the BFF every FastAPI request otherwise arrives from the Next server's one IP, so
the backend's per-IP throttles bucket all staff as one. `lib/auth/client-ip.ts` reads the
real client IP **only** from `process.env.CLIENT_IP_HEADER` — the header the portal's own
infrastructure (a fronting nginx, a platform LB) sets from the TCP connection it
terminated. It is `net.isIP()`-validated, rejects comma lists / `host:port` / anything with
whitespace or CR/LF, and is forwarded as exactly one `X-Forwarded-For`. Inbound
`X-Forwarded-For` / `X-Real-IP` on a browser request are attacker-fabricated here (the BFF
is the edge) and are **never** consulted. With `CLIENT_IP_HEADER` unset, no forwarded
header is sent and the backend rate-limits per-BFF (acceptable for single-user dev; the
backend logs a `client_ip_fallback` each time). A real multi-user deployment **must** set
it from a trusted hop.

## Consequences

**Positive**

- No token ever reaches page JS. An XSS on the portal can *act as* the user while the tab
  is open (unavoidable) but cannot *steal a token* and act as the user later, elsewhere,
  after the tab closes.
- One `Authorization`-attaching site, one egress path. Auth logic is not spread across the
  component tree.
- The Origin/`Sec-Fetch-Site` check is ~15 lines, no token plumbing, no per-form wiring,
  and covers login too.
- Per-staff backend rate limiting is recoverable via one configured, validated header
  without trusting anything the browser sent.
- The browser makes no cross-origin request to FastAPI, so the backend needs no
  `ALLOWED_ORIGINS` change and there is no CORS preflight in play.

**Negative / accepted costs**

- **The portal must run as a single Next instance** (or sticky sessions) until plan
  GATE 3 #9 is taken. This is a real deployment constraint, not a soft preference.
- Every backend call is one extra network hop (browser → Next → FastAPI).
- The `stripBackendMount` indirection: callers use fully-typed `/api/v1/...` schema paths,
  the client rewrites the wire URL to `/api/bff/...`, and the BFF re-adds `/api/v1`. Three
  representations of one path.
- Local dev needs the exact-origin match (`PORTAL_ORIGIN`, `allowedDevOrigins`) or login
  403s with no obvious cause. Documented in `admin_portal/README.md`.
- The proxy buffers request bodies whole (needed to replay on the 401 retry), so it is
  JSON-only with a 1 MB cap (413) and a 30 s read timeout (408). Media PUTs go
  browser → storage direct and never touch it.
- No RSC-side refresh: a Server Component cannot rotate cookies, and calling the rotating
  `/auth/refresh` there would burn the `jti` out from under the proxy. A user idle past the
  access-token TTL re-authenticates on the next hard navigation. Known Phase 1 rough edge.

**Neutral**

- A shared CDN or reverse-proxy cache in front of the API **must** `Vary: Authorization`
  (or a cache key including the header) on the count-bearing GET routes — the BFF forwards
  a staff bearer and those routes return all-status counts for staff vs published-only for
  anonymous. Cross-reference `DEPLOYMENT.md` §8.
- `rp_rt` on `__Secure-` rather than `__Host-` is safe only under the no-sibling-subdomain
  assumption (Amendment A2). If the portal moves onto a shared domain, revisit whether the
  refresh cookie takes `__Host-` and `Path=/`.
- The 2 s straggler-retention window (D3) is a same-instance mitigation with a small
  same-instance replay cost; it is subsumed by GATE 3 #9 whenever that lands.

## Alternatives considered

- **Option 1 — tokens in JS-readable storage + direct browser→FastAPI + CORS.** Rejected.
  Given the locked "browser talks only to Next" decision there is no consumer for a
  browser-held access token; holding one only adds an XSS exfiltration target and a
  hydration problem, and it forces `ALLOWED_ORIGINS` / CORS config on the API for a flow
  that otherwise needs none.
- **Option 3 — full server-side session store.** Rejected for Phase 1. It adds a Redis
  dependency and a session table to the portal to solve problems (revocation, multi-device)
  the backend already owns via `jti` burning and revoke-by-user-id. The `httpOnly`-cookie
  approach gets the XSS-can't-exfiltrate property without the portal owning session state.
  If the portal goes multi-instance, the relevant piece to add is the backend reuse-grace
  window (GATE 3 #9), not a portal-side store.
- **Refresh in Next middleware.** Rejected. Middleware runs before the handler so it cannot
  see FastAPI's 401, it defaults to the Edge runtime (no module-scope process state for the
  dedupe map), and coordinating `Set-Cookie` from middleware under concurrency is fiddly.
  The logic lives in one server module both the proxy and the auth routes call.
- **Redis mutex in the portal for refresh coordination.** Rejected — see "Refresh
  concurrency".
- **Double-submit CSRF tokens.** Rejected — see "CSRF".

## Follow-ups

- **Plan GATE 3 #9** — backend refresh-rotation reuse-grace window. Deferred; trigger is a
  multi-instance portal deploy, checked *before* the topology change. Would need its own
  `security-reviewer` pass.
- **Plan GATE 3 #1 / §A.10** — `X-Forwarded-For` trust (or an internal-caller exemption) on
  the backend global rate limiter before any real deploy. Local dev currently relies on a
  raised limit.
