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

## 3. Deploy sequence

```bash
uv sync --frozen                        # reproducible install
uv run alembic upgrade head             # migrations (run once, not per instance)
uv run python -m app.scripts.preflight  # fails the deploy if anything is wrong
uv run uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

Run migrations as a separate step before rolling instances — concurrent
`alembic upgrade` from several starting containers will race.

Behind a reverse proxy terminating TLS. The app sets HSTS in production but
does not terminate TLS itself.

## 4. Health probes

| Path | Use | Behaviour |
|---|---|---|
| `/health/live` | liveness probe | Checks nothing external — a database blip must not kill healthy containers |
| `/health/ready` | readiness probe / load balancer | 503 when the database or Redis is unreachable, so traffic drains |

## 5. Scheduled jobs

```bash
# Hourly — safety net for webhooks that never arrived
uv run python -m app.scripts.expire_subscriptions
```

Without this, a missed `customer.subscription.deleted` grants access
indefinitely.

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
