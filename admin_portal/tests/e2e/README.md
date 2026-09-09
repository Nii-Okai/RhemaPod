# E2E suite (Playwright)

One happy-path suite against the **running local Docker stack + seeded DB**
(plan §A.11). It is deliberately **not** part of `npm run verify` — `verify`
must not depend on infrastructure.

## Specs

| File | What it covers |
|---|---|
| `auth.spec.ts` | W4 auth surface: login sets httpOnly cookies, RSC `/auth/me` bootstrap, authenticated `/api/bff/*` pass-through, logout clears cookies and a portal route bounces to `/login`. |
| `money-path.spec.ts` | The full money path: `editor.sam` creates a draft → uploads media through the real pipeline (client-validate → ticket → browser-direct PUT to MinIO → confirm → poll to `ready`) → submits for review → `manager.mo` approves & publishes → the sermon is live in the public catalog. |

## Prerequisites

1. **Stack up:**
   ```
   docker compose up -d
   ```
   The API (`:8000`), Postgres, Redis and MinIO (`:9000`) must all be healthy.
   MinIO matters — the money-path upload leg PUTs to it browser-direct.

2. **Fixture data seeded.** `app/scripts/seed_dev.py` *is* the fixture
   (GATE 3 #8). It is idempotent:
   ```
   docker compose exec -T api python -m app.scripts.seed_dev
   ```
   `global-setup.ts` attempts this automatically before the run and then
   verifies a seeded account can log in — if the rows are missing it stops the
   run with this exact command. Run it by hand only when `docker` is not on the
   PATH of the shell that launches Playwright.

   Seeded staff (shared passphrase `SeedDev-Passphrase-2026`):
   `editor.sam@seed.rhemapod.dev`, `editor.rae@seed.rhemapod.dev`,
   `manager.mo@seed.rhemapod.dev`, `manager.val@seed.rhemapod.dev`.

## Run

```
npx playwright test            # from admin_portal/
npx playwright test --headed   # watch it
npx playwright show-trace ...  # traces are retained on failure only
```

The Playwright `webServer` starts `npm run dev` on `:3000` if it is not already
running (`next dev`, not `next start` — `Secure` cookies are dropped on
`http://localhost`, §A.8).

## Rate limit

The backend keeps a 300/60s global limit (per-IP behind the BFF, GATE 3 #1
pending) and a 10/60s per-account login limit. A single full suite run stays
well inside both. `workers: 1` — do not parallelise.
