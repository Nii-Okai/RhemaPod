# Deploying RhemaPod to Render (staging)

Staging first, production later (§9). Everything is defined in `render.yaml`
(a Render Blueprint); secrets are entered in the dashboard and never committed.
`.env.render.example` lists every variable and where each one comes from.

## 0. What the Blueprint creates

| Resource | Render type | Plan | Notes |
|---|---|---|---|
| `rhemapod-staging-db` | Postgres 17 | `0.1c-256mb` | Private network only. **Not** `free` — free Postgres expires after 30 days. |
| `rhemapod-staging-kv` | Key Value | `256mb` | `noeviction` + persistence: refresh sessions live here. `free` has no persistence, so a restart would log everyone out. |
| `rhemapod-api-staging` | Web (Docker) | `0.5c-512mb` | FastAPI. Pre-deploy runs `alembic upgrade head` + preflight. `api.rhemapod.com`. |
| `rhemapod-admin-staging` | Web (Node 24) | `0.5c-512mb` | Next.js admin portal (`admin_portal/`). `admin.rhemapod.com`. |
| `rhemapod-staging-hourly` | Cron (Docker) | `0.5c-512mb` | `expire_subscriptions`, `sweep_uploads`, `sweep_stream_jobs` at :07. |
| `rhemapod-staging-daily` | Cron (Docker) | `0.5c-512mb` | `purge_audit_log`, `purge_comment_snapshots` at 03:23 UTC. |

All in `frankfurt` (closest Render region to West Africa and Europe). **`region`
can't be changed after creation**; edit every `region:` line in `render.yaml`
before the first sync if your congregation is elsewhere (`oregon`, `ohio`,
`virginia`, `singapore`).

Auto-deploy: every push to `dev` redeploys the API, portal and cron images.

The mobile app is not hosted on Render. It just points at `https://api.rhemapod.com` (§7).

## 1. Before you start (one-time, outside Render)

1. **R2 staging buckets.** In Cloudflare R2 create `sermon-raw-staging` and
   `sermon-media-staging`. Block public access on both. Keep them separate from the
   `-dev` buckets your laptop uses, so staging data and local test data never mix.
2. **R2 API token** scoped to those two buckets only, with Object Read & Write.
   Note the access key ID, the secret, and the account endpoint
   `https://<account-id>.r2.cloudflarestorage.com`.
3. **CORS on `sermon-raw-staging`.** The portal uploads from the browser straight to R2:
   ```json
   [{"AllowedOrigins":["https://admin.rhemapod.com"],"AllowedMethods":["PUT"],
     "AllowedHeaders":["Content-Type"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3000}]
   ```
4. **Resend:** create a separate API key for staging, so you can revoke it on its own.
   `rhemapod.com` is already verified there.
5. **DNS access** for `rhemapod.com`. You'll add two CNAMEs in §5.

## 2. Get the Blueprint onto `dev`

Render deploys `dev`. `render.yaml`, `.env.render.example`, this guide and the
`DATABASE_URL` driver fix arrive on `chore/render-deploy`. Merge that branch into
`dev` the same way you merge everything else.

## 3. Create the services

1. Render dashboard → **New → Blueprint** → connect the `Nii-Okai/RhemaPod` repo →
   branch `dev`.
2. Render reads `render.yaml` and lists the resources from §0. It then asks for the
   four `sync: false` secrets on `rhemapod-api-staging`:
   `OBJECT_STORE_ENDPOINT_URL`, `OBJECT_STORE_ACCESS_KEY_ID`,
   `OBJECT_STORE_SECRET_ACCESS_KEY`, `SMTP_PASSWORD` (the values from §1).
3. **Apply.** Render creates the database and Key Value first, then builds the API image. The
   API's pre-deploy step migrates the empty database and runs the preflight, which
   checks that the database, Redis and R2 are reachable with those credentials. If
   a secret is wrong, **the deploy fails here and nothing goes live.** Fix the
   variable and redeploy.

The first API build takes a few minutes (it installs the uv lockfile in Docker). Later builds reuse the cache.

## 4. Check the portal → API wiring

The portal calls the API server-to-server over Render's private network, using
`API_BASE_URL=http://rhemapod-api-staging:8000`.

- Open the API service → **Connect → Internal** and confirm the host:port shown is
  exactly `rhemapod-api-staging:8000`. If Render shows a suffixed host, update
  `API_BASE_URL` in `render.yaml` (and in the portal's Environment tab) to match.
- Sanity check from the API's **Shell** tab: `curl -s localhost:8000/health/ready`
  should print `{"status":"ready", …}` with the database and Redis both `ok`.

## 5. Domains

Each service has `domains:` set, so Render shows the target for each one under **Settings → Custom Domains**.

| Record | Type | Value |
|---|---|---|
| `api.rhemapod.com` | CNAME | `rhemapod-api-staging.onrender.com` |
| `admin.rhemapod.com` | CNAME | `rhemapod-admin-staging.onrender.com` |

If DNS is on Cloudflare, set both records to **DNS only** (grey cloud) until Render shows the
certificate as issued. Then `curl -sI https://api.rhemapod.com/health/live` should return `200`.

The app's CSRF and CORS checks (`PORTAL_ORIGIN`, `ALLOWED_ORIGINS`,
`FRONTEND_BASE_URL`) expect the custom domains. **The portal won't accept logins
on its `onrender.com` URL.** That's intended, so wait for DNS.

## 6. Seed and verify

From `rhemapod-api-staging` → **Shell**:

```bash
python -m app.scripts.create_admin --email <your-email>   # prompts for a password
python -m app.scripts.seed_verses                          # Home's verse of the day
```

`seed_staff` creates the fixed staff list. Run it only if you want those
accounts on staging, and export its `STAFF_*_PASSWORD` variables inline in that shell
(`.env.render.example` §F). Never add them to the service. **Don't run `seed_dev` on staging.**

Then check each of the following:

1. Sign in at `https://admin.rhemapod.com` with the admin you just created.
2. **Real client IPs (`TRUSTED_PROXIES`).** In the portal's audit log, your login row's IP
   should be your public IP. If it shows a `10.x.x.x` address, Render's proxy isn't
   covered by `TRUSTED_PROXIES`. Every user then shares one per-IP rate-limit
   bucket (20 req/min for the whole app). Note the address it shows and fix
   `TRUSTED_PROXIES` before you invite testers. Keep it at `/8` or narrower; the app
   refuses anything broader.
3. **Staff client IPs.** `CLIENT_IP_HEADER` is unset on staging, so the API sees every portal request as
   coming from the portal itself and staff share one rate limit. That's fine for a handful of
   staff. Set it before production, once you've confirmed which header Render's
   edge sets with the real client IP.
4. Upload a short test sermon from the portal. That exercises the R2 CORS rule
   and presigned PUT. Playback falls back to presigned R2 URLs, because Stream is a stub on
   staging.
5. **Cron jobs:** open each one in the dashboard and press **Trigger Run**. Both should exit 0.

## 7. Point the mobile app at staging

- **Local dev client:** in `mobile/.env` set `EXPO_PUBLIC_API_BASE_URL=https://api.rhemapod.com`,
  then `npx expo start --dev-client --clear`. `EXPO_PUBLIC_*` values are baked into the bundle,
  so a plain reload isn't enough.
- **TestFlight / EAS builds:** set the same variable in that build profile's `env`
  (`eas.json`) or as an EAS environment variable. It's public by design: the URL is not a secret.
- Google and Apple sign-in work against staging as-is. The audience (aud) values in
  `GOOGLE_OAUTH_CLIENT_IDS` and the default `com.niitech.rhemapod` don't depend on the
  backend's hostname.

## 8. Day 2

- **Deploy:** merge to `dev`. Migrations run in the pre-deploy step, once per deploy rather than once per
  instance, before traffic moves. A failing migration or preflight leaves the previous version live.
- **Rollback:** Render dashboard → the service → **Events → Rollback**. Migrations are
  additive by house rule, so the previous image runs against the newer schema. A
  destructive migration breaks that assumption, so never ship one without a written down-path.
- **Scale:** add instances, not workers. `UVICORN_WORKERS` stays at 1 (DEPLOYMENT.md §3).
  Watch Postgres connections: each API instance can open `DB_POOL_SIZE + DB_MAX_OVERFLOW` = 10.
- **Logs:** each service's Logs tab shows the structlog JSON. Add a log stream in workspace
  settings when you pick a log platform.
- **Secrets:** rotate in the API service's Environment tab, then **Save, rebuild and deploy**.
  `SECRET_KEY` rotation logs out every user, because every JWT is signed with it.
- **House-rule deviation:** secrets live in Render's encrypted environment variables, not AWS
  Secrets Manager. For staging that's acceptable. Decide it explicitly for production
  (§9) rather than letting it carry over by default.

## 9. Promoting to production (not yet)

Production is a **separate** Blueprint (`rhemapod-prod-*`, its own database, Key Value
and buckets), not staging renamed. With `ENVIRONMENT=production` the API refuses to boot until
all of the following are in place:

- [ ] Cloudflare Stream: `CF_ACCOUNT_ID`, `CF_STREAM_API_TOKEN`, `CF_STREAM_CUSTOMER_SUBDOMAIN`,
      `CF_STREAM_WEBHOOK_SECRET`, `CF_STREAM_SIGNING_KEY_ID`, `CF_STREAM_SIGNING_KEY_PEM`
      (DEPLOYMENT.md §12).
- [ ] AWS Glacier Deep Archive: `ARCHIVE_STORE_*`, with storage class `DEEP_ARCHIVE` (DEPLOYMENT.md §12).
- [ ] Production R2 buckets. The preflight rejects names containing `-dev` or `-staging`, and
      raw and media must be different buckets.
- [ ] `DEBUG=false`, `REQUIRE_EMAIL_VERIFICATION=true`, https-only `ALLOWED_ORIGINS` and `FRONTEND_BASE_URL`.
- [ ] `TRUSTED_PROXIES` verified (§6.2), and `CLIENT_IP_HEADER` set on the portal (§6.3).
- [ ] **Backups match the privacy policy.** The policy will say 30 days
      (plan-account-deletion §A.7). Check how far back your Render Postgres plan can
      recover. If it's less than 30 days, add a nightly `pg_dump` to a private R2 bucket with a 30-day
      lifecycle rule, or change the published number. Don't leave them disagreeing.
- [ ] Apple revocation key (`.p8`) and its settings, once account deletion ships (that plan's AD2/AD5).
- [ ] Decide whether production secrets stay in Render's environment variables or move to AWS Secrets Manager.
- [ ] Postgres and API plans sized for real load. Larger instance types also unlock
      zero-downtime deploys with more than one API instance.
