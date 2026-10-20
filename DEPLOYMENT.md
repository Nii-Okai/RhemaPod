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
real. This is deliberate: a silent fallback — an in-memory storage stub, a
console email backend, debug mode left on — is the most dangerous failure
mode in the system.

Required when `ENVIRONMENT=production`:

| Variable | Why |
|---|---|
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Otherwise uploads go to an in-memory stub |
| `SMTP_HOST`, `SMTP_FROM_EMAIL` | Otherwise invite and reset emails are only logged |
| `SECRET_KEY` | 32+ chars, from a secrets manager |
| `ALLOWED_ORIGINS` | https only, no `*` |
| `FRONTEND_BASE_URL` | https |
| `DEBUG=false` | Otherwise API docs are public |

Inject these from AWS Secrets Manager / GCP Secret Manager / Vault — not a file
on disk.

`S3_PUBLIC_ENDPOINT` is a **dev-only** shim (see §8). The preflight refuses to
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

Same story for the local `docker compose` dev stack: the `api` container is a
static built image with no source volume mount, and nothing runs migrations on
boot there either. After merging to `main` (or pulling), run
`scripts/sync-dev.sh` — rebuilds `api` and runs `alembic upgrade head` against
the persistent dev Postgres. Skipping it serves stale code against a stale
schema, silently.

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

Three jobs **must** run on a schedule in **every** deployed environment:

```bash
# Hourly — safety net for webhooks that never arrived. Without it a missed
# customer.subscription.deleted grants access indefinitely.
uv run python -m app.scripts.expire_subscriptions

# Hourly — fails upload jobs abandoned mid-PUT (tab closed, network dropped).
# Without it those jobs sit in `awaiting_upload` forever and count toward the
# per-sermon open-job cap, which can lock a sermon out of new uploads for up
# to STALE_UPLOAD_HOURS (default 24h).
uv run python -m app.scripts.sweep_uploads

# Hourly — safety net for Cloudflare Stream webhooks that never arrived, and
# retries a Stream ingest whose initial kickoff never got a uid. Without it a
# missed "ready" event leaves a sermon's video permanently un-ingested, and a
# failed Glacier archive copy (§12) is never retried. See §12.
uv run python -m app.scripts.sweep_stream_jobs
```

One more runs **daily** (plan-admin-settings §A.7, ADR 0018):

```bash
# Daily — audit-log retention as Isaac approved it: deletes auth.* rows
# older than AUDIT_AUTH_RETENTION_DAYS (365) and nulls ip/user_agent on every
# other row older than AUDIT_NETWORK_RETENTION_DAYS (365). Refuses to run if
# either variable is unset. Without it, login IPs are kept indefinitely,
# contradicting the published retention.
uv run python -m app.scripts.purge_audit_log
```

It is not part of the compose `sweeps` loop; schedule it on the same real
scheduler as the jobs above.

**Local / self-host:** the compose `sweeps` profile runs all three on a
1-hour `sleep` loop:

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

Stripe was removed — see [ADR 0016](docs/adr/0016-remove-stripe.md).

## 7. Email (Resend)

`app/core/email.py` already has a working, provider-agnostic SMTP backend
(`_send_smtp_blocking`), gated by `settings.email_is_live`
(`SMTP_HOST` + `SMTP_FROM_EMAIL` both set — see §2; the production preflight
already refuses to boot without them). **Resend supports SMTP relay
directly**, so nothing in the send path changes — this is configuration only.

1. Create a Resend account and verify a sending domain (Resend gives you DNS
   records — SPF/DKIM — to add at your registrar; verification can take a
   few minutes to propagate). **Isaac does this step himself** — account
   creation, domain verification and API key generation are not things this
   codebase or its agents can do on your behalf.
2. Generate an API key in the Resend dashboard.
3. Set the five `SMTP_*` variables (see `.env.example` for the placeholder
   block):

   | Variable | Value |
   |---|---|
   | `SMTP_HOST` | `smtp.resend.com` |
   | `SMTP_PORT` | `587` (STARTTLS) or `465` (implicit TLS) — `email.py` handles both |
   | `SMTP_USERNAME` | the literal string `resend` |
   | `SMTP_PASSWORD` | your Resend API key |
   | `SMTP_FROM_EMAIL` | a verified sender address on your verified domain |

No code change, no new dependency. `send_staff_invite` and
`send_password_reset` (both in `email.py`) are unaffected — they call the
same `_send` seam regardless of which SMTP provider is configured behind it.

## 8. S3 / CORS

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

## 9. Edge caching and the `Authorization` header

Seven public GET routes return a **different body depending on whether the
caller is authenticated staff**:

```
/api/v1/catalog/categories
/api/v1/categories            /api/v1/categories/{id}
/api/v1/speakers              /api/v1/speakers/{id}
/api/v1/series                /api/v1/series/{id}
```

They carry `sermon_count` / `episode_count` fields. An anonymous or `viewer`
caller gets a **published-only** count; an `editor`/`manager`/`admin` token
gets the true all-status count (so the admin portal's delete-confirmation
copy and people-screen totals are accurate). See `staff_sees_full_counts` in
`app/services/content_service.py`.

Consequence for any shared HTTP cache or CDN (CloudFront, a reverse-proxy
cache) in front of the API: it **must** vary on `Authorization` for these
routes — `Vary: Authorization`, or a cache-key policy that includes the
header — or it can serve a staff full-count body (which leaks unpublished
content volume) to an anonymous client. The `openapi.json` marks these
routes with optional `HTTPBearer` security, which is the signal to key on.
The API itself sets no cache headers on them; the count queries bypass the
`cache_aside` layer, so this is purely an edge-layer concern.

## 10. Operational behaviour when Redis is down

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

## 11. What is still deferred

- **Transcoding** is passthrough: the uploaded MP4 is served directly. Fine for
  launch; revisit when bandwidth cost or mobile buffering justifies an HLS
  ladder and the worker fleet it needs.
- **Search** is not implemented (Phase 7). Catalog filtering is database-backed.
- **Read replica** is supported via `DATABASE_REPLICA_URL` but unset by default.
- **Metrics/tracing**: structured JSON logs with correlation IDs are in place.
  Ship them to your log platform; add OpenTelemetry when you need spans.

## 12. Cloudflare Stream and Glacier Deep Archive (mobile app media pipeline)

Plan §A.2: on `POST /uploads/{job_id}/confirm`, the server presigns the raw S3
master and hands Cloudflare Stream a "copy from URL" ingest job
(`app/core/stream.py`); once Stream reports the video ready (or error), the
same master is copied into `/sermon_archives/` in the raw bucket at S3 Glacier
Deep Archive storage class (`app/core/storage.py`'s `copy_object` /
`archive_key`). The admin portal's upload UI is unchanged — see §8 for the
existing presigned-PUT flow, which this does not touch.

### Cloudflare Stream setup

1. Create a Cloudflare account, enable Stream, and mint an API token scoped to
   Stream only. **Isaac does this step himself** — same reason as the Resend
   step in §7: account creation and credential custody are not things this
   codebase or its agents can do on your behalf.
2. Set `CF_ACCOUNT_ID`, `CF_STREAM_API_TOKEN`, `CF_STREAM_CUSTOMER_SUBDOMAIN`
   (see `.env.example`). Without both `CF_ACCOUNT_ID` and
   `CF_STREAM_API_TOKEN`, `app/core/stream.get_provider()` returns the local
   stub — the production preflight refuses to boot on it (§2).
3. Register the webhook notification URL:

   ```bash
   curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/stream/webhook" \
     -H "Authorization: Bearer $CF_STREAM_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"notificationUrl": "https://<your-api>/api/v1/media/stream/webhook"}'
   ```

   The response's `result.secret` is the value for `CF_STREAM_WEBHOOK_SECRET`
   — copy it immediately, Cloudflare does not show it again (re-running the
   `PUT` rotates it, which is also how to rotate it later). The production
   preflight refuses to boot with Stream live but this unset — without it the
   webhook endpoint cannot verify inbound events and must reject all of them.
4. Verify locally with the real test master before relying on it: the seam's
   `get_status(uid=...)` is a plain authenticated `GET`, so a working token
   proves itself against any known video uid in the account (see status.md
   "W1.1-W1.4 stream pipeline core" for this build's own live check).
5. Generate a Stream signing key (needed for `get_stream`/`get_audio_download`
   to hand out playback URLs, W1.5 — **Isaac does this step himself**, same
   reasoning as above):

   ```bash
   curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/stream/keys" \
     -H "Authorization: Bearer $CF_STREAM_API_TOKEN"
   ```

   The response's `result.id` and `result.pem` are `CF_STREAM_SIGNING_KEY_ID`
   and `CF_STREAM_SIGNING_KEY_PEM` — copy both immediately, Cloudflare shows
   the PEM only this once (there is no "re-fetch the private key" call; a
   lost PEM means minting a new key, not recovering the old one). Fold the
   PEM's real newlines into literal `\n` for `.env`/compose (see
   `.env.example`'s comment). Until both are set, the production preflight
   refuses to boot with Stream otherwise live (§2), and in every other
   environment `get_stream`/`get_audio_download` fall back to the pre-Stream
   presigned-S3 path for any Stream-ingested rendition rather than failing
   the request — see `app/services/media_service.py`'s
   `_resolve_variant_url`.

### Glacier Deep Archive setup

1. Confirm (or create) `/sermon_archives` as a prefix in the **raw** bucket,
   at S3 Glacier Deep Archive storage class. **Isaac does this step
   himself**, same reasoning as above — this was done for the mobile plan's
   GATE M2 (status.md "W0.1 Glacier archive location confirmed").
2. Nothing else to provision: the archival code sets `StorageClass` explicitly
   on every copy (`app/core/storage.py`'s `S3Storage.copy_object`), so it does
   not depend on a bucket-level lifecycle rule ever firing. A lifecycle rule
   is still sensible defense-in-depth for anything that somehow lands in that
   prefix without going through this code path, but is not what makes the
   archive real.
3. IAM: the credentials in `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` need
   `s3:GetObject` and `s3:PutObject` on `/sermon_archives/*` in addition to
   the grants in §8 (the copy is a same-bucket `GetObject` + `PutObject`
   under the hood, issued as one `CopyObject`/managed-copy call).

### Restoring an archived master (Deep Archive retrieval)

Deep Archive objects are **not** readable directly — a restore request must
complete first. There is no Expedited tier for Deep Archive; only two:

| Tier | Typical latency |
|---|---|
| `Standard` | ~12 hours |
| `Bulk` (cheapest) | ~48 hours |

[Amazon S3: Understanding archive retrieval options](https://docs.aws.amazon.com/AmazonS3/latest/userguide/restoring-objects-retrieval-options.html)

To restore one sermon's archived master (kept for 7 days once restored, then
reverts to Deep Archive-only — raise `Days` for a longer window):

```bash
aws s3api restore-object \
  --bucket <raw-bucket> \
  --key "sermon_archives/<sermon-id>/<filename>" \
  --restore-request '{"Days": 7, "GlacierJobParameters": {"Tier": "Standard"}}'
```

Poll for completion with `head-object` — `Restore` in the response moves from
`ongoing-request="true"` to `ongoing-request="false", expiry-date=...` once
the object is readable:

```bash
aws s3api head-object --bucket <raw-bucket> --key "sermon_archives/<sermon-id>/<filename>"
```

This is insurance against losing the Cloudflare Stream original, not a hot
backup — plan this into any incident response as an hours-not-minutes
recovery path, not something to reach for mid-outage expecting immediate
results.

### Operational behaviour

`app/scripts/sweep_stream_jobs.py` (§5) covers two failure modes: a Stream
"ready"/"error" webhook that never arrived, and an archive copy that failed
after Stream did report ready. Both are retried automatically on the hourly
sweep; neither is a silent failure — failed archive attempts log at `ERROR`
(`stream_sweep_archive_failed` / a propagated `StorageError` on the webhook
path, surfaced as a 500 so Cloudflare redelivers).

## 13. Client IP and User-Agent for the audit trail

The audit log (ADR 0018) records the client IP and User-Agent of every login,
logout and staff change. Behind the admin portal's BFF, every backend request
comes from the BFF itself, so two settings are required for staff rows to
record the **browser's** IP:

| Where | Variable | Value |
|---|---|---|
| Admin portal | `CLIENT_IP_HEADER` | The header your edge (nginx, load balancer) **sets from the TCP peer**, e.g. `x-real-ip`. It must be overwritten by the edge on every request, never passed through from the client, or clients can choose their recorded IP. |
| Backend | `TRUSTED_PROXIES` | The BFF's address or narrow subnet, as a JSON list, e.g. `["10.0.3.12"]`. IPv4 entries must be /8 or narrower (the app refuses to boot otherwise). |

With both set, the BFF forwards one validated `X-Forwarded-For` and the backend
trusts it only from the BFF. A browser-supplied `X-Forwarded-For` is ignored.
Without `CLIENT_IP_HEADER`, staff rows record the BFF's own IP and the backend
logs `client_ip_fallback` on every request; that warning's volume is the sign
the chain is misconfigured. The same two settings also make the login rate
limiter key per staff member instead of per BFF.

The User-Agent needs no configuration: the BFF forwards the browser's,
stripped of control characters and cut to 512 characters.

`docker-compose.yml` has no admin portal service and sets neither variable;
plain `npm run dev` against a local backend records `127.0.0.1`, which is
expected.
