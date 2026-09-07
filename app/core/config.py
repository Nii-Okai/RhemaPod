from functools import lru_cache
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Recognised deployment environments. An unrecognised value is rejected rather
# than silently treated as non-production — landing on "not production" is what
# disables the preflight below and exposes /docs.
KNOWN_ENVIRONMENTS = {"development", "test", "staging", "production"}

# Substrings that mark a SECRET_KEY as a placeholder rather than a real secret.
# The first entry is the exact value shipped in .env.example.
_PLACEHOLDER_SECRET_MARKERS = (
    "replace-with-a-long-random-string-at-least-32-chars",
    "replace-with",
    "change-me",
    "changeme",
    "change_me",
    "your-secret",
    "placeholder",
    "example-secret",
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Local/dev only. .env is gitignored; .env.example is committed docs of
        # the variable names and must never be a runtime config source. Deployed
        # environments inject real environment variables / secrets-manager values
        # and have no .env file at all.
        env_file=".env",
        env_file_encoding="utf-8",
    )

    app_name: str = "Rhema Pod"
    environment: str = "development"
    debug: bool = False
    log_level: str = "INFO"

    # In production, inject via a secrets manager rather than .env
    secret_key: str = Field(min_length=32)


    database_url: str
    # Optional read replica; falls back to primary when unset
    database_replica_url: str | None = None
    db_pool_size: int = 10
    db_max_overflow: int = 20

    redis_url: str = "redis://localhost:6379/0"

    allowed_origins: list[str] = ["http://localhost:3000"]

    # Auth / JWT
    jwt_algorithm: str = "HS256"
    jwt_issuer: str = "sermon-platform"
    jwt_audience: str = "sermon-platform-api"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    password_reset_expire_minutes: int = 30
      # Staff invite links (set-your-password) live longer than a self-service reset.
    invite_token_expire_hours: int = 48
    # Base URL of the frontend that renders the set-password / reset page.
    frontend_base_url: str = "http://localhost:3000"
    # --- Media / storage (Phase 4) ---
    # S3-compatible object storage (AWS S3, Cloudflare R2, MinIO).
    s3_endpoint_url: str | None = None          # None = real AWS S3
    s3_region: str = "eu-north-1"
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_raw_bucket: str = "sermon-raw"
    s3_media_bucket: str = "sermon-media"
    # How long a browser has to complete a direct upload.
    # A 2 GB file on a modest connection takes well over 15 minutes; too short
    # a window expires the URL mid-upload and loses the whole transfer.
    upload_url_expire_seconds: int = 14400      # 4 hours
    # Uploads that never completed are swept after this long.
    stale_upload_hours: int = 24
    # How long a playback URL stays valid.
    stream_url_expire_seconds: int = 21600      # 6 hours
    # Optional CDN in front of the media bucket. When set, playback URLs are
    # signed against this host instead of the bucket directly.
    cdn_base_url: str | None = None
    max_upload_bytes: int = 5 * 1024 * 1024 * 1024   # 5 GB
    # Run transcodes inline (dev/test) instead of via a background worker.
    transcode_inline: bool = True
    # False = passthrough: serve the uploaded file directly, no FFmpeg needed.
    # True  = produce an HLS ladder (requires FFmpeg + a background worker).
    transcode_enabled: bool = False

    # --- Subscriptions / payments (Phase 5) ---
    # Leave stripe_secret_key blank to use the mock provider (no Stripe needed).
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    stripe_price_monthly: str | None = None
    stripe_price_annual: str | None = None
    # How long an entitlement decision is cached in Redis.
    entitlement_cache_seconds: int = 300

    # --- Email (SMTP) ---
    # Unset -> console backend (logs the message). Required in production.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_use_tls: bool = True

    # Max failed logins per IP+email window (enforced via Redis)
    login_rate_limit: int = 10
    login_rate_window_seconds: int = 60

    # Global per-IP request cap (0 disables).
    global_rate_limit: int = 300
    global_rate_window_seconds: int = 60
    # Reject request bodies larger than this before parsing (bytes).
    max_request_bytes: int = 2 * 1024 * 1024

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    # Backend readiness — used by the production preflight below.
    @property
    def storage_is_live(self) -> bool:
        return bool(self.s3_access_key_id and self.s3_secret_access_key)

    @property
    def payments_are_live(self) -> bool:
        return bool(self.stripe_secret_key and self.stripe_webhook_secret)

    @property
    def email_is_live(self) -> bool:
        return bool(self.smtp_host and self.smtp_from_email)

    @field_validator("environment")
    @classmethod
    def environment_is_known(cls, v: str) -> str:
        if v.lower() not in KNOWN_ENVIRONMENTS:
            raise ValueError(
                "ENVIRONMENT must be one of "
                f"{sorted(KNOWN_ENVIRONMENTS)}, got {v!r} — an unrecognised value "
                "would silently disable the production preflight"
            )
        return v

    @field_validator("secret_key")
    @classmethod
    def secret_key_is_real(cls, v: str) -> str:
        """Reject placeholder / low-entropy signing keys, in EVERY environment.

        This is a field validator, so it runs regardless of `environment` and
        regardless of whether a dotenv file was found — a deploy that forgets to
        inject SECRET_KEY fails to boot instead of signing tokens with a value
        anyone can read out of the repo.
        """
        lowered = v.lower()
        for marker in _PLACEHOLDER_SECRET_MARKERS:
            if marker in lowered:
                raise ValueError(
                    "SECRET_KEY looks like a placeholder — generate a real one, "
                    'e.g. python -c "import secrets; print(secrets.token_urlsafe(48))"'
                )
        if len(set(v)) < 8:
            raise ValueError(
                "SECRET_KEY has too little entropy (fewer than 8 distinct "
                "characters) — use a random value, not a repeated pattern"
            )
        return v

    @model_validator(mode="after")
    def production_preflight(self) -> "Settings":
        """Refuse to start in production on stub backends or unsafe config.

        The stubs exist so tests and local development need no cloud accounts.
        Reaching production is a different matter: a MockProvider in production
        would accept ANY unsigned webhook, letting anyone grant themselves a
        subscription. Failing to boot is the correct response — a silent
        fallback here is the most dangerous failure mode in the system.
        """
        if not self.is_production:
            return self

        problems: list[str] = []

        if not self.payments_are_live:
            problems.append(
                "STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required "
                "(without them the mock provider accepts unsigned webhooks)"
            )
        if not (self.stripe_price_monthly and self.stripe_price_annual):
            problems.append("STRIPE_PRICE_MONTHLY and STRIPE_PRICE_ANNUAL are required")
        if not self.storage_is_live:
            problems.append(
                "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required "
                "(without them uploads silently go to an in-memory stub)"
            )
        if not self.email_is_live:
            problems.append(
                "SMTP_HOST and SMTP_FROM_EMAIL are required "
                "(without them invite and reset emails are only logged)"
            )
        if self.debug:
            problems.append("DEBUG must be false (it exposes API docs)")
        if any(o == "*" for o in self.allowed_origins):
            problems.append("ALLOWED_ORIGINS must not contain '*' with credentials")
        if any(o.startswith("http://") for o in self.allowed_origins):
            problems.append("ALLOWED_ORIGINS must use https in production")
        if self.frontend_base_url.startswith("http://"):
            problems.append("FRONTEND_BASE_URL must use https in production")
        if not self.database_url.startswith(("postgresql+psycopg://", "postgresql://")):
            problems.append("DATABASE_URL must point at PostgreSQL")

        if problems:
            raise ValueError(
                "Production preflight failed:\n  - " + "\n  - ".join(problems)
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
