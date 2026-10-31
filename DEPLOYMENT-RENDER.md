# Deploying RhemaPod to Render (dev, free plans)

A hosted copy of the **local dev stack**: same configuration, same R2 `-dev`
buckets, same Resend key, Stream and archive on their stubs, all on Render's free
plans. Production is a separate exercise (§9).

- `render.yaml` defines every resource. It's a Render Blueprint.
- `.env.render.example` lists every variable and where each one comes from.
- Your filled secrets go in `.env.render` at the repo root. That file is gitignored
  and holds the same values your local stack uses.

## 0. What the Blueprint creates

| Resource | Render type | Plan | Notes |
|---|---|---|---|
| `rhemapod-dev-db` | Postgres 17 | `free` | 1 GB, no backups, **expires 30 days after creation** (§8). One free database per workspace. |
| `rhemapod-dev-kv` | Key Value | `free` | `noeviction`. No persistence, so a restart signs every user out. **Open to external connections** (see "Redis on free plans" below). |
| `rhemapod-dev-api` | Web (Docker) | `free` | FastAPI on `api.rhemapod.com`. Runs migrations and preflight on every start. |
| `rhemapod-dev-admin` | Web (Node 24) | `free` | Next.js admin portal (`admin_portal/`) on `admin.rhemapod.com`. |

Everything is in `frankfurt`. **You can't change a region after creation**, so edit
every `region:` line before the first sync if you want somewhere else.

Every push to `dev` redeploys both web services.

### What free plans change

- **Cold starts.** A free web service sleeps after about 15 idle minutes. The next request
  waits roughly a minute while it wakes, and the API also runs migrations and preflight
  on start. In the mobile app, the first call after a quiet spell can time out, so
  retry it.
- **No pre-deploy step.** Migrations run inside the API's start command. That's only
  safe because a free service is always exactly one instance. Don't copy it to a paid,
  scaled setup.
- **No cron jobs.** Free has no cron plan, so the hourly and daily sweeps don't run
  (§8).
- **No Shell tab.** One-off scripts run from your laptop against the database's
  external URL (§6).
- **Redis on free plans.** The free API couldn't reach the free Key Value instance over the
  private network: preflight reported `redis TimeoutError` with the correct internal URL, both
  resources Available in Frankfurt. So the Key Value instance allows `0.0.0.0/0`, and the API's
  `REDIS_URL` is the **external** `rediss://` (TLS) URL, which you paste in yourself (§3). Free Key Value
  also takes about 2s to accept a connection, so the env group raises
  `REDIS_CONNECT_TIMEOUT_SECONDS` / `REDIS_SOCKET_TIMEOUT_SECONDS` to 10. The app's 2s
  default otherwise times out. Redis is
  then reachable from the internet, guarded only by its password. Acceptable for dev. On a paid
  plan, go back to `ipAllowList: []` and the internal URL.
- **Monthly hour cap.** Free instance hours are capped per workspace each month. Two
  web services that sleep when idle stay well under it.

## 1. Before you start

1. **R2 CORS.** The portal uploads from the browser straight to `sermon-raw-dev`. Add
   `https://admin.rhemapod.com` to that bucket's CORS `AllowedOrigins`, next to the
   localhost origins already there:
   ```json
   [{"AllowedOrigins":["http://localhost:3000","https://admin.rhemapod.com"],
     "AllowedMethods":["PUT"],"AllowedHeaders":["Content-Type"],
     "ExposeHeaders":["ETag"],"MaxAgeSeconds":3000}]
   ```
2. **`.env.render`.** This file already exists at the repo root, filled with your local dev
   values: `SECRET_KEY`, the three R2 values and the Resend key. To rebuild it, copy those five
   keys from `.env` / `docker-compose.override.yml` into a copy of `.env.render.example` §D.
3. **DNS access** for `rhemapod.com`, for the two CNAMEs in §5.

**Email goes over HTTPS, not SMTP.** Render free web services block outbound SMTP
(ports 25/465/587) since 2025-09-26, so `smtp.resend.com:587` times out. The Blueprint sets
`EMAIL_TRANSPORT=resend_api` (POST to `https://api.resend.com/emails` on 443). Set
`RESEND_API_KEY` on the API service to the same value as `SMTP_PASSWORD`; `SMTP_FROM_EMAIL`
is reused as the From address. Preflight shows `email resend_api: api.resend.com`.

The deployed dev stack and your laptop share the same R2 buckets and Resend key.
Uploads from either one land in the same `-dev` buckets. That's intended for a dev deployment.

## 2. Get the Blueprint onto `dev`

Render deploys `dev`. This guide, `render.yaml`, `.env.render.example` and the
`DATABASE_URL` driver fix arrive on `chore/render-deploy`. Merge that branch into
`dev` the way you merge everything else.

## 3. Create the services

1. Render dashboard → **New → Blueprint** → connect `Nii-Okai/RhemaPod` → branch `dev`.
2. Render lists the four resources from §0 and asks for the `sync: false` secrets on
   `rhemapod-dev-api`: the five in `.env.render`, plus `REDIS_URL`, which is the **External** URL from
   rhemapod-dev-kv → Connect. Copy them from `.env.render`. Alternatively, apply first, then use
   **rhemapod-dev-api → Environment → Add from .env** and paste the file's contents.
3. **Apply.** Render creates the database and Key Value, builds the API image, and starts
   the container. The container then runs `alembic upgrade head`, then the preflight
   (database, Redis and R2 reachable with these credentials), then uvicorn. A wrong secret
   leaves the service failing to start. Its Logs tab shows the exact preflight line
   that failed.

The first API build takes a few minutes. Later builds reuse the cache.

## 4. Check the portal → API wiring

The portal's server calls the API at its **public** URL, `API_BASE_URL=https://api.rhemapod.com`.
Free services can't reach each other over Render's private network: with the internal
`http://rhemapod-dev-api:8000` the portal logged `bff_auth_upstream_unreachable` and showed
"The service is unavailable". On paid plans, switch back to the internal address. It's faster,
and it doesn't leave Render's network.

This means the portal only works once `api.rhemapod.com` resolves (§5).

Readiness check from your laptop: `curl -s https://api.rhemapod.com/health/ready` should report
`"status":"ready"` with the database and Redis both `ok`.

## 5. Domains

| Record | Type | Value |
|---|---|---|
| `api.rhemapod.com` | CNAME | `rhemapod-dev-api.onrender.com` |
| `admin.rhemapod.com` | CNAME | `rhemapod-dev-admin.onrender.com` |

On Cloudflare DNS, use **DNS only** (grey cloud) until Render shows each certificate as issued.
After that, `curl -sI https://api.rhemapod.com/health/live` should return `200`.

The portal's CSRF origin and the API's CORS/reset-link settings expect these hostnames.
**Logins on the `onrender.com` portal URL are rejected**, so wait for DNS.

These are the hostnames production will want later. When production arrives, either
move them across or put dev on `api-dev.` / `admin-dev.` instead (§9).

## 6. Seed and verify

There's no Shell tab on free, so run the one-off scripts from your laptop:

1. **rhemapod-dev-db → Info → Access Control.** Add your current public IP. Then copy the
   **External Database URL**.
2. From the repo root:
   ```bash
   export DATABASE_URL='<external database URL>'      # postgresql://… is fine; the app rewrites it
   uv run python -m app.scripts.create_admin --email <your-email>   # prompts for a password
   uv run python -m app.scripts.seed_verses
   ```
   The exported `DATABASE_URL` overrides the one in `.env`. Everything else (`SECRET_KEY`
   and so on) comes from your local `.env`, which is the same set of values. Optional:
   `seed_dev` works here too, because `ENVIRONMENT=development`.
3. **Remove your IP from Access Control** when you're done.

Then check each of the following:

1. Sign in at `https://admin.rhemapod.com`.
2. **Real client IPs.** The audit log row for your login should show your public IP. If it shows a
   `10.x.x.x` address, Render's proxy isn't covered by `TRUSTED_PROXIES`. Every user then
   shares one per-IP rate limit (20 requests per minute for everyone). Fix that before you
   hand the app to testers. Entries must be `/8` or narrower; the app refuses anything broader.
3. **Staff rate limit.** `CLIENT_IP_HEADER` is unset, so the API sees every staff member as the
   portal itself and they share one rate limit. That's fine for a handful of staff.
4. Upload a short test sermon. That exercises R2 CORS and the presigned PUT. Playback uses presigned R2
   URLs, because Stream is a stub, exactly as it does locally.
5. API docs are public at `https://api.rhemapod.com/docs`, because `DEBUG=true`. That's acceptable
   for dev. It is the first thing to turn off on anything real.

## 7. Point the mobile app at it

- **Dev client:** in `mobile/.env` set `EXPO_PUBLIC_API_BASE_URL=https://api.rhemapod.com`, then
  `npx expo start --dev-client --clear`. `EXPO_PUBLIC_*` values are baked into the bundle,
  so a plain reload isn't enough.
- **TestFlight / EAS builds:** put the same variable in that build profile's `env`.
- Google sign-in works as-is. Apple sign-in and account deletion are on `dev`. The env group
  sets `OAUTH_APPLE_ENABLED=true` plus the Apple revocation config (`APPLE_REVOCATION_BACKEND=http`,
  `APPLE_TEAM_ID`, `APPLE_KEY_ID`). **One secret is yours to add:** `APPLE_PRIVATE_KEY` on
  rhemapod-dev-api → Environment, set to the full text of `AuthKey_F8JN4PAKLB.p8` (paste the file
  as is; Render keeps the newlines). Without it the start-time preflight fails and the deploy
  doesn't go live. Then run `python -m app.scripts.check_apple_key` from the service's Shell tab:
  `invalid_grant` there means Apple accepted the key (DEPLOYMENT.md §14).

## 8. Living with free plans

- **Database expiry.** Free Postgres expires 30 days after creation, and Render deletes it after a
  short grace period. Before then, either upgrade it in place (`plan: 0.1c-256mb` in `render.yaml`)
  or `pg_dump` it, recreate it, and restore. There are no automated backups on free; if the data
  matters, `pg_dump` it yourself using the external URL as in §6.
- **Scheduled jobs aren't running.** In practice:
  - Stale uploads stay `awaiting_upload` and count toward the five-open-jobs cap per sermon.
  
  The retention purges are the exception: the API runs them in-process once a day
  (`RETENTION_SCHEDULER_ENABLED=true` in `render.yaml`): `ip`/`user_agent` nulled after 30 days,
  `auth.*` audit rows deleted after 365, moderation snapshots cleared after 90. Free web
  services spin down when idle, so the 24 h sleep rarely completes; in practice it runs about
  once per wake, after a short startup delay. That's acceptable because the UPDATEs are
  idempotent and lock-guarded. The real fix is a Render cron job (or an ECS scheduled task) that
  runs the CLI, with `RETENTION_SCHEDULER_ENABLED=false`. See the ADR 0018 addendum.
  
  For a dev stack the rest is fine. To run them by hand, use the same laptop + external URL
  approach: `uv run python -m app.scripts.sweep_uploads` (likewise `expire_subscriptions`,
  `sweep_stream_jobs`, `purge_audit_log`, `purge_comment_snapshots`).
- **Sessions reset on restart.** Free Key Value doesn't persist, so a restart or redeploy of the
  Key Value instance signs everyone out.
- **Deploys:** merge to `dev`. Migrations run when the new container starts. **Rollback:** the
  service's Events → Rollback. Migrations are additive by house rule, so an older image runs
  against a newer schema.
- **Dropping `comment_guidelines` (`a7c3e9f1b2d4`).** Migrate-then-start in the single
  container means a window of a few seconds where the previous instance still maps the dropped
  column and errors on settings reads; the 300s cache masks most of it. Acceptable for dev. Prod
  runs this as two releases (code, then migration); see DEPLOYMENT.md §3. Rollback is
  `alembic downgrade d9e0f1a2b3c4` before redeploying an older image (the Events → Rollback
  note above does not cover this destructive migration). Exports taken before this revision
  can't be imported after it.
- **Secrets:** change them on rhemapod-dev-api → Environment, then Save, rebuild and deploy. Because
  `SECRET_KEY` is shared with local dev, tokens minted locally are valid against the deployed API
  and vice versa. Give the deployment its own key if that ever matters.

Restoring a database or importing an admin data export can bring back
accounts erased since the snapshot; see the "Restores, imports and erased
accounts" section (15) in `DEPLOYMENT.md` for the re-erasure steps.

## 9. Moving beyond dev (later)

A real staging or production environment is a separate Blueprint, not this one with the plans bumped.
Its starting points:

- **Paid plans.** That brings back the pre-deploy step (migrations run once per deploy, not
  per instance start), Shell, cron jobs, Postgres backups and persistent Key Value.
- **Own credentials.** Its own buckets, R2 token, Resend key and a fresh `SECRET_KEY`. Never the dev values.
- **Production configuration.** `ENVIRONMENT=production` and `DEBUG=false`. The production check then
  refuses to boot without Cloudflare Stream (`CF_*`) and the Glacier archive (`ARCHIVE_STORE_*`)
  (DEPLOYMENT.md §12), and without bucket names free of `-dev`/`-staging`.
- **Backups vs the privacy policy.** The published backup retention is 30 days; make the backup window match it.
- **Client IPs.** `TRUSTED_PROXIES` verified, and `CLIENT_IP_HEADER` set on the portal.
- **Apple key.** Reuse the `.p8` or create a separate one per environment; either way set
  `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY` there (DEPLOYMENT.md §14).
- **Secret storage.** Decide whether secrets stay in Render's environment variables or move to AWS Secrets Manager.

## 10. Share static site (open.rhemapod.com)

Serves the https share links (ADR 0021, `plans/plan-share-links.md`): the Universal Link / App Link
association files and a static fallback page. No API calls, no admin surface.

| Item | Value |
|---|---|
| Service | `rhemapod-open`, Render Static Site, `free` |
| Source | `open_site/` (hand-written HTML/CSS/JS, no build step) |
| Definition | `render.yaml` (routes and headers live there) |
| Branch | tracks `dev` until a prod stack exists (then move it to the prod branch) |

Any merge to `dev` that touches `open_site/` redeploys the permanent share host. Review those diffs.

### DNS

- Add **one** record: `CNAME open -> <rhemapod-open>.onrender.com`. Render shows the exact target when you add the custom domain.
- On Cloudflare keep it **DNS only (grey cloud)**. A proxied record breaks certificate issuance and can rewrite the AASA response.
- Change no other record. `rhemapod.com` and `www` are not used by this site.

### Validate the association files

Run these after the first deploy and after any change to `open_site/.well-known/`.

```
curl -sI https://open.rhemapod.com/.well-known/apple-app-site-association
curl -sI https://open.rhemapod.com/.well-known/assetlinks.json
curl -s  https://app-site-association.cdn-apple.com/a/v1/open.rhemapod.com
curl -s "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://open.rhemapod.com&relation=delegate_permission/common.handle_all_urls"
```

Expect: 200, `Content-Type: application/json`, no redirect, for both files. Apple's CDN returns the same
body as the origin (it can lag by hours). Google lists `com.niitech.rhemapod` with the EAS SHA-256.
On a device, `adb shell pm get-app-links com.niitech.rhemapod` shows `open.rhemapod.com: verified`.
Also check that `/privacy` returns a 301 to `admin.rhemapod.com/privacy`, and that `/sermon/<any-uuid>`
returns the fallback page with `X-Robots-Tag: noindex`.

Do this before any native build: a wrong AASA at build time can leave links dead until the next app update.

### Before the first Play release (L1)

Append the Play app-signing SHA-256 (Play Console, App integrity) to
`open_site/.well-known/assetlinks.json`, keeping the EAS one. Nothing else changes. Verify with the
DAL API above (both fingerprints listed) and `pm get-app-links` on a Play-installed build. Tracked in
`plans/plan-share-links.md` §L1 and rides `[HUMAN_GATE M11]`.

### Rollback

Delete `rhemapod-open` and remove the `open` CNAME, or just empty the path components in AASA and the
assetlinks statements and redeploy to stop app interception without removing the site (iOS honours it
after Apple's CDN refreshes). See the plan's Rollback section.
