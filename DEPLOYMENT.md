# Production deployment

## 1. Rotate the leaked credentials first

`.env` was committed to the repository with live AWS keys. Treat them as
compromised:

1. AWS console → IAM → the key `***REMOVED-AWS-ACCESS-KEY***` → **deactivate, then delete**.
2. Create a replacement key and store it in your secrets manager, not `.env`.
3. Purge `.env` from git history (`git filter-repo --path .env --invert-paths`)
   and force-push, or rotate everything and accept the history.
4. `.env` is now in `.gitignore`. Commit `.env.example` instead.

Deleting the file from the working tree is not enough — it remains in history.

## 2. Configuration

The app **refuses to start** in production unless every external dependency is
real. This is deliberate: the stub payment provider accepts unsigned webhooks,
so a silent fallback would let anyone grant themselves a subscription.

Required when `ENVIRONMENT=production`:

| Variable | Why |
|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Otherwise the mock provider accepts unsigned webhooks |
| `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL` | Checkout cannot price a plan without them |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Otherwise uploads go to an in-memory stub |
| `SMTP_HOST`, `SMTP_FROM_EMAIL` | Otherwise invite and reset emails are only logged |
| `SECRET_KEY` | 32+ chars, from a secrets manager |
| `ALLOWED_ORIGINS` | https only, no `*` |
| `FRONTEND_BASE_URL` | https |
| `DEBUG=false` | Otherwise API docs are public |

Inject these from AWS Secrets Manager / GCP Secret Manager / Vault — not a file
on disk.

`S3_PUBLIC_ENDPOINT` is a **dev-only** shim (see §7). The preflight refuses to
boot in production if it is set to a localhost/compose value; leave it unset.

## 3. Deploy sequence

```bash
uv sync --frozen                        # reproducible install
uv run alembic upgrade head             # migrations (run once, not per instance)
uv run python -m app.scripts.preflight  # fails the deploy if anything is wrong
uv run uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

Run migrations as a separate step before rolling instances — concurrent
`alembic upgrade` from several starting containers will race.

### API schema (`openapi.json`)

`uv run python -m app.scripts.dump_openapi` regenerates `openapi.json` at the
repo root; commit the result. The admin portal's TypeScript typegen reads this
file, so it must stay in sync with the routers — `tests/test_openapi_dump.py`
fails if a backend change has not been re-dumped. The dump is built in-process
and needs no running server, database, or Redis (and no `DEBUG=true`).

### Container form

The image entrypoint runs **uvicorn only** — no `alembic upgrade head` on
container boot — so the same sequence becomes three explicit invocations. Every
invocation takes an env file (or injected env vars) carrying at least
`SECRET_KEY` and `DATABASE_URL` (see §2 for the full production set); never bake
secrets into the image.

```bash
# 1. Build (or pull) the image
docker build -t fastapi-sermon:"$(git rev-parse --short HEAD)" .

# 2. Migrations — one off, before any app container starts. Same override shape
#    as an ECS one-off task or a k8s Job.
docker run --rm --env-file deploy.env fastapi-sermon:<tag> alembic upgrade head

# 3. Preflight, then start the app container(s)
docker run --rm --env-file deploy.env fastapi-sermon:<tag> \
  python -m app.scripts.preflight
docker run -d --env-file deploy.env -p 8000:8000 \
  -e UVICORN_WORKERS=1 fastapi-sermon:<tag>
```

One uvicorn process per container (`UVICORN_WORKERS` defaults to 1); scale out
with replicas, not workers. The container listens on port 8000 (fixed — matches
`EXPOSE` and the `HEALTHCHECK`). The image `HEALTHCHECK` probes `/health/live`
(liveness — checks nothing external).

Locally, `docker-compose.yml` wires the same steps. First provide a signing key
— compose has **no default** for `SECRET_KEY` and refuses to start without one:

```bash
cp .env.docker.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"   # paste into .env as SECRET_KEY=
# or, without a file:
#   export SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
```

Then `docker compose run --rm migrate` (or `docker compose run --rm api alembic
upgrade head`) for step 2, then `docker compose up`. This trades away the
"zero-setup `docker compose up`" property on purpose: the key must be real random
bytes (the config validator rejects placeholders) and is never committed. The
`migrate` service is behind a `migrate` profile, so it never runs on `docker
compose up`.

Behind a reverse proxy terminating TLS. The app sets HSTS in production but
does not terminate TLS itself.

## 4. Health probes

| Path | Use | Behaviour |
|---|---|---|
| `/health/live` | liveness probe | Checks nothing external — a database blip must not kill healthy containers |
| `/health/ready` | readiness probe / load balancer | 503 when the database or Redis is unreachable, so traffic drains |

## 5. Scheduled jobs

Two jobs **must** run on a schedule in **every** deployed environment:

```bash
# Hourly — safety net for webhooks that never arrived. Without it a missed
# customer.subscription.deleted grants access indefinitely.
uv run python -m app.scripts.expire_subscriptions

# Hourly — fails upload jobs abandoned mid-PUT (tab closed, network dropped).
# Without it those jobs sit in `awaiting_upload` forever and count toward the
# per-sermon open-job cap, which can lock a sermon out of new uploads for up
# to STALE_UPLOAD_HOURS (default 24h).
uv run python -m app.scripts.sweep_uploads
```

**Local / self-host:** the compose `sweeps` profile runs both on a 1-hour
`sleep` loop:

```bash
docker compose --profile sweeps up -d sweeps
```

It is not started by `docker compose up` — it is opt-in.

**Deployed environments:** run each job on a real scheduler — an ECS scheduled
task, a Kubernetes `CronJob`, or plain `cron` on the box. The compose loop is a
dev convenience, not a production job runner: it has no failure alerting, no
retry/backoff, and no concurrency lock (two overlapping runs against the same
DB are currently harmless but not guaranteed to stay so). A proper job runner
with alerting and a lock is tracked on the production-readiness track and is
out of scope here.

## 6. Stripe setup

1. Create the monthly and annual prices; put their IDs in the env.
2. Add a webhook endpoint pointing at
   `https://<your-api>/api/v1/subscriptions/webhook`.
3. Subscribe to: `checkout.session.completed`, `invoice.paid`,
   `invoice.payment_failed`, `customer.subscription.updated`,
   `customer.subscription.deleted`.
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

Verify locally first: `stripe listen --forward-to
localhost:8000/api/v1/subscriptions/webhook`.

## 7. S3 / CORS

The IAM policy needs `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on both
buckets, plus `s3:ListBucket` on the buckets themselves (without it S3 returns
403 instead of 404 for missing keys).

Browser uploads need a CORS rule on the raw bucket:

```json
[{
  "AllowedOrigins": ["https://app.example.com"],
  "AllowedMethods": ["PUT"],
  "AllowedHeaders": ["Content-Type"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}]
```

Both buckets must block all public access — playback uses signed URLs.

### Local dev: MinIO in compose

`docker compose up` now runs a `minio` service plus a one-shot `createbuckets`
that makes `sermon-raw` and `sermon-media`. This exists so the browser-direct
presigned PUT is exercised for real — the in-process `LocalStorage` stub fakes
both the URL and the object's existence, so a broken upload still `confirm`s.

Two dev-only wrinkles, both handled in `docker-compose.yml`:

- **Presigned-URL host.** The API container reaches MinIO at `http://minio:9000`
  (`S3_ENDPOINT_URL`), but the browser must PUT to a host it can resolve.
  `S3Storage` keeps two boto3 clients: one bound to `S3_ENDPOINT_URL` for its
  own reads/writes (`object_exists`, `delete`), and one bound to
  `S3_PUBLIC_ENDPOINT` (`http://localhost:9000`) used only to sign the
  presigned URLs the browser follows. Signing for the browser's host is
  required — SigV4 signs the `Host` header even for query-string auth, so a URL
  signed for `minio:9000` is rejected with `SignatureDoesNotMatch` when the PUT
  lands on `localhost:9000`. Presigning is offline HMAC, so the presign client
  never needs to reach its endpoint. `S3_PUBLIC_ENDPOINT` is **dev-only** — the
  config preflight refuses to boot in production if it is a localhost/compose
  value. On real AWS S3 both sides use one host, so leave it unset.
- **Browser CORS.** The MinIO server is started with
  `MINIO_API_CORS_ALLOW_ORIGIN=${PORTAL_ORIGIN:-http://localhost:3000}`, which
  allows the portal's dev origin to PUT cross-origin. Change `PORTAL_ORIGIN` in
  `.env` if the portal runs elsewhere. (MinIO's server-wide CORS allow-list is
  used rather than a per-bucket `mc cors` rule — `mc cors` support varies by
  release; the server env var is stable.)

## 8. Operational behaviour when Redis is down

Redis backs refresh-token rotation, the one-shot reset/invite ledger, and login
rate limiting. The failure posture is split on purpose:

| Path | Redis unreachable | Why |
|---|---|---|
| `POST /auth/login`, `/auth/refresh` | **503**, no token issued | An access/refresh pair whose jti was never recorded cannot be revoked |
| `POST /auth/logout`, `/auth/change-password`, `PATCH /users/{id}/role` | **503** | Returning 200 for a session revocation that never reached Redis is a lie to the client |
| `POST /auth/reset-password` | **503**, password unchanged | The one-shot token cannot be atomically consumed, so it cannot be honoured |
| Login rate limiter | **fails open** — request allowed | Blocking every login because Redis blinked is worse than briefly not throttling; an outage is not an attack signal |

All 503s carry the correlation ID and a generic message. `/health/ready`
already returns 503 while Redis is unreachable, so a load balancer drains the
instance; the per-request behaviour above covers the window before it does.

## 9. What is still deferred

- **Transcoding** is passthrough: the uploaded MP4 is served directly. Fine for
  launch; revisit when bandwidth cost or mobile buffering justifies an HLS
  ladder and the worker fleet it needs.
- **Search** is not implemented (Phase 7). Catalog filtering is database-backed.
- **Read replica** is supported via `DATABASE_REPLICA_URL` but unset by default.
- **Metrics/tracing**: structured JSON logs with correlation IDs are in place.
  Ship them to your log platform; add OpenTelemetry when you need spans.
