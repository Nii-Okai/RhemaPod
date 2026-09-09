# RhemaPod admin portal

The staff admin portal for the RhemaPod sermon backend (`../app`, FastAPI). Editors,
Managers and Admins manage sermons, series, speakers and categories, and announcements,
and run the review → approve → publish workflow. Dashboard, Subscriptions, Users & roles
and Settings are Phase 2 — their routes exist under `app/(portal)/` as stubs.

- Session / auth architecture: [`../docs/adr/0002-bff-session-design.md`](../docs/adr/0002-bff-session-design.md)
- Phase 1 build plan (the contract this was built to): [`../plans/plan-admin-portal.md`](../plans/plan-admin-portal.md)
- Edge-cache requirement for the count-bearing GETs: [`../DEPLOYMENT.md`](../DEPLOYMENT.md) §8

## Stack

| Piece | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript `strict` |
| Styling | Tailwind v4 — `@theme` tokens in `app/globals.css`, no JS config |
| Components | shadcn/ui primitives on Radix (`radix-ui`); `lucide-react` confined to primitive internals |
| Server state | `@tanstack/react-query` v5 — every list, the editor, the review queue, upload polling |
| API access | `openapi-fetch` against `lib/api/schema.d.ts`, generated from the repo-root `openapi.json` by `openapi-typescript`. The file is committed. |
| Tests | Vitest 5 (two projects: `node` + `happy-dom`), MSW, Playwright |
| Runtime | Node 24 (`.nvmrc`, `package.json` `engines`) — `next build` and Vitest 5 will not run on older lines |
| Package manager | npm (pnpm is not on the build machine — plan resolved decision 8) |

## Architecture — the BFF proxy

The browser never calls FastAPI. Both JWTs (access + refresh) live in `httpOnly` cookies
the browser cannot read. Every data call goes same-origin to the Next app; the only
network egress to FastAPI is `app/api/bff/[...path]` (the one authenticated pass-through,
`lib/auth/proxy.ts`) and `app/api/auth/*` (login / refresh / logout / set-password /
forgot-password). The proxy attaches the bearer, refreshes the token pair preemptively,
and enforces a same-origin check on every mutating request. `lib/api/client.ts` callers
address paths as `/api/v1/...` (the fully-typed schema paths); the `stripBackendMount`
middleware rewrites the wire URL to `/api/bff/...` and the BFF re-adds the `/api/v1` mount
when it forwards.

Full rationale, the cookie attribute table, and the single-instance constraint:
[`../docs/adr/0002-bff-session-design.md`](../docs/adr/0002-bff-session-design.md).

## Directory layout

Follows plan §A.1 — route groups for the two chrome contexts, and `lib/` layered the way
the backend is (`api` transport → `query` server-state → feature hooks → components).

```
app/
  (public)/       login, forgot-password, set-password — no shell, no session
  (portal)/       layout.tsx bootstraps GET /auth/me → SessionProvider + shell;
                  sermons/, series/[id]/, review/ (manager+), people/, announcements/,
                  and the Phase 2 stubs (dashboard, subscriptions, users, settings)
  (reference)/    /kit component gallery, /tokens token audit — reachable by direct
                  URL for the design-fidelity pass, absent from the sidebar
  api/auth/*      login · logout · refresh · set-password · forgot-password route handlers
  api/bff/[...path]  the generic authenticated pass-through (GET/POST/PATCH/DELETE)
components/
  ui/             restyled shadcn primitives (Button, Input, Select, Dialog, …)
  portal/         app-shell, sidebar, data-table, status-badge, pagination, … (ours)
  <feature>/      announcements/ people/ review/ series/ sermons/
lib/
  api/            schema.d.ts (generated, committed) · client.ts · server.ts · errors.ts
  auth/           proxy.ts · cookies.ts · csrf.ts · exchange.ts · client-ip.ts · jwt.ts ·
                  session.ts · upstream.ts · require-role.ts · session-context.tsx
  query/          client.ts · keys.ts · provider.tsx · hooks/ (one file per feature)
  upload/         direct-to-storage pipeline — xhr-put · upload-context · validate · eta · merge
  <feature>/      format/ people/ portal/ review/ series/ — pure logic, no React
tests/            node + dom Vitest projects; tests/e2e/ is Playwright
```

## Local development

**Prerequisites**

- Node 24 — `nvm use` (or put a keg-only Homebrew `node@24` on `PATH`).
- The backend stack running: from the repo root, `docker compose up` (postgres, redis,
  api, **MinIO**). MinIO is not optional — the upload pipeline cannot be exercised against
  the `LocalStorage` stub, which fakes a successful PUT.

**Configure**

```bash
cp .env.local.example .env.local
```

| Var | Purpose |
|---|---|
| `API_BASE_URL` | FastAPI base URL, server-to-server only. Default `http://127.0.0.1:8000`. |
| `PORTAL_ORIGIN` | The portal's own origin. The BFF's CSRF check compares every mutating request's `Origin` against this **exactly**. Default `http://localhost:3000`. |
| `CLIENT_IP_HEADER` | Optional. Name of the inbound header your own infra sets from the real client connection (e.g. `x-real-ip`). Leave **unset** for plain `npm run dev` — the backend then rate-limits per-BFF and logs a `client_ip_fallback` each request. |

There is deliberately no `NEXT_PUBLIC_*` variable. If one appears, something server-side
has leaked to the browser.

**Run**

```bash
npm install
npm run dev            # http://localhost:3000
```

**The origin wrinkle** — this bit the team once. Login (and every mutating call) works
**only** on exactly `http://localhost:3000`, or an origin you have whitelisted. Two things
enforce that: the BFF rejects any mutating request whose `Origin` is not `PORTAL_ORIGIN`
(or `Sec-Fetch-Site: same-origin`) with a 403, and the dev-asset / BFF-route guard blocks
non-`localhost` origins. To reach the dev server from another device you must run
`next dev -H 0.0.0.0`, add that origin (LAN IP) to `allowedDevOrigins` in `next.config.ts`,
**and** point `PORTAL_ORIGIN` at it. Miss any one and login 403s with no obvious cause.

**Seed data**

The workflow screens are unverifiable without content in every status and more than one
actor. From the repo root:

```bash
uv run python -m app.scripts.seed_dev      # idempotent; production-guarded, loopback DB only
```

Seed staff logins — all with password `SeedDev-Passphrase-2026`:

| Email | Role |
|---|---|
| `editor.sam@seed.rhemapod.dev`, `editor.rae@seed.rhemapod.dev` | Editor |
| `manager.mo@seed.rhemapod.dev`, `manager.val@seed.rhemapod.dev` | Manager |

No Admin account is seeded — create one with `uv run python -m app.scripts.create_admin`.

## Testing

```bash
npm run verify        # build + typecheck + lint + test — the floor for every change
```

- `npm test` → Vitest, two projects (`vitest.config.mts`):
  - **node** — pure logic and the MSW-backed API/BFF transport suites. `environment: "node"`.
  - **dom** — `*.dom.test.tsx` component/hook render tests under `happy-dom`.
  - One project at a time: `npx vitest run --project node|dom`.
- `maxWorkers: 3` is deliberate. The default per-core fan-out starves `findBy*` in the
  happy-dom interaction suites under CPU contention and makes runs machine-dependently
  flaky. Leave it.
- **MSW, never a mocked `fetch`.** Assert on the wire, not on the wrapper — the frontend
  analogue of the "don't mock the ORM" rule.
- `npm run test:e2e` → Playwright, one happy-path suite (login → create → upload → confirm
  → submit → approve & publish → verify the approval log). Needs the Docker stack up and
  the DB seeded. **Deliberately not in `verify`** — it needs infrastructure `verify` does
  not assume.

Suite size today: ~56 Vitest files, ~465 tests.

## Regenerating the API types

After any backend contract change:

```bash
# repo root — rebuild the spec (no running server needed)
uv run python -m app.scripts.dump_openapi

# here — regenerate the committed types
npm run gen:api        # openapi-typescript ../openapi.json -o lib/api/schema.d.ts
```

Commit the `schema.d.ts` diff — it is the review artifact for the contract change.

## Not built in Phase 1

- **Phase 2 screens** — Dashboard, Subscriptions, Users & roles, Settings. Routes exist
  under `app/(portal)/` as stubs.
- **Invite sending.** Phase 1 ships invite *acceptance* (`/set-password`); staff accounts
  are created by `create_admin.py` / the API until Phase 2.
- **No dark mode** — the palette has one dark hint and no dark surface set (plan §A.6).
- **Polling, not push** — upload status and nav counts poll; no WebSocket / SSE.
- **No cross-entity search** — the top-bar input is wired to `GET /sermons?q=` only.
- **No CI, no container, no deploy target** for the portal (plan §A.11). `npm run verify`
  runs locally and via the repo pre-commit hooks.

## Known rough edges

- **Single Next instance only.** The refresh-rotation dedupe is per Node process. A move to
  multi-instance must take the backend reuse-grace window first (plan GATE 3 #9). See
  ADR 0002.
- **No RSC-side refresh.** A user idle past the ~15-min access-token TTL re-authenticates on
  the next hard navigation; an active session stays warm because the proxy refreshes on
  data calls. Noted in `lib/auth/session.ts`.
