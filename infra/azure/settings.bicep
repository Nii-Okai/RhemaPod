// Settings every environment shares, imported by params/<env>.bicepparam.
// Same values as render.yaml's `rhemapod-dev` env group except where noted.
// Secrets never go here: they live in each environment's Key Vault and are
// listed by name only (DEPLOYMENT-AZURE.md §4).

@export()
var commonSettings = {
  LOG_LEVEL: 'INFO'
  GOOGLE_OAUTH_CLIENT_IDS: '827558560538-it16fls8iu36e9c3fcp13beaf9u54ooe.apps.googleusercontent.com,827558560538-ujevidt1217i6a2gu8fm9sn8je755kta.apps.googleusercontent.com,827558560538-jfpd1k7eq6bej6q481ohb2co70t56h9r.apps.googleusercontent.com'
  OAUTH_GOOGLE_AUTH_CODE_ENABLED: 'true'
  GOOGLE_OAUTH_WEB_CLIENT_ID: '827558560538-jfpd1k7eq6bej6q481ohb2co70t56h9r.apps.googleusercontent.com'
  OAUTH_APPLE_ENABLED: 'true'
  APPLE_REVOCATION_BACKEND: 'http'
  APPLE_TEAM_ID: 'FAND2W5VMM'
  APPLE_KEY_ID: 'F8JN4PAKLB'
  // Resend over HTTPS, as on Render. Azure doesn't block 587, so SMTP would
  // also work; keeping one transport means one thing to debug.
  EMAIL_TRANSPORT: 'resend_api'
  SMTP_HOST: 'smtp.resend.com'
  SMTP_PORT: '587'
  SMTP_USERNAME: 'resend'
  SMTP_FROM_EMAIL: 'RhemaPod <no-reply@rhemapod.com>'
  SMTP_USE_TLS: 'true'
  DB_POOL_SIZE: '5'
  DB_MAX_OVERFLOW: '5'
  // The in-process loops are off on Azure: the scheduled jobs below run the
  // same code on a real schedule, even while the API is scaled to zero.
  RETENTION_SCHEDULER_ENABLED: 'false'
  CAPTIONS_SCHEDULER_ENABLED: 'false'
  PUSH_SCHEDULER_ENABLED: 'false'
  SENTRY_TRACES_SAMPLE_RATE: '0.1'
}

// Key Vault secret names (→ env var names upper-cased, dashes → underscores).
// database-url and redis-url are written by the deployment itself.
@export()
var commonSecrets = [
  'secret-key'
  'object-store-endpoint-url'
  'object-store-access-key-id'
  'object-store-secret-access-key'
  'smtp-password'
  'resend-api-key'
  'apple-private-key'
  'google-oauth-client-secret'
]

// Production refuses to boot without Cloudflare Stream and the Glacier
// archive (DEPLOYMENT.md §12).
@export()
var productionOnlySecrets = [
  'cf-stream-api-token'
  'cf-stream-webhook-secret'
  'cf-stream-signing-key-id'
  'cf-stream-signing-key-pem'
  'archive-store-access-key-id'
  'archive-store-secret-access-key'
]

// DEPLOYMENT.md §5. Each run is a short-lived container, billed per second.
@export()
var hourlyJobs = [
  { name: 'sweep-uploads', cron: '5 * * * *', module: 'app.scripts.sweep_uploads' }
  { name: 'sweep-stream', cron: '15 * * * *', module: 'app.scripts.sweep_stream_jobs' }
  { name: 'expire-subs', cron: '25 * * * *', module: 'app.scripts.expire_subscriptions' }
  // Full retention pass: audit ip/UA, auth.* rows, comment snapshots.
  { name: 'retention', cron: '40 3 * * *', module: 'app.scripts.purge_audit_log' }
]

// Captions and pushes need minutes, not hours. Production only by default:
// in dev/test Stream is a stub and every-5-minute runs would eat the free
// Container Apps allowance.
@export()
var frequentJobs = [
  { name: 'sweep-captions', cron: '*/5 * * * *', module: 'app.scripts.sweep_captions' }
  { name: 'send-pushes', cron: '*/5 * * * *', module: 'app.scripts.send_pushes' }
]
