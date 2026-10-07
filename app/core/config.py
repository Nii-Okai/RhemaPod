import ipaddress
from functools import lru_cache
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Recognised deployment environments. An unrecognised value is rejected rather
# than silently treated as non-production — landing on "not production" is what
# disables the preflight below and exposes /docs.
KNOWN_ENVIRONMENTS = {"development", "test", "staging", "production"}

# Environments a browser — or an attacker — can reach directly. A subset of the
# production preflight (cleartext object-storage endpoints) must also hold here:
# staging routinely runs with real S3 credentials on a public hostname, so an
# http:// endpoint there leaks exactly as it would in production.
INTERNET_REACHABLE_ENVIRONMENTS = {"staging", "production"}

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


# Hosts that mark an S3_PUBLIC_ENDPOINT as a dev-only compose shim rather than
# a real object-storage origin.
_LOCAL_ENDPOINT_MARKERS = (
    "localhost", "127.0.0.1", "0.0.0.0", "::1",
    "minio:", "host.docker.internal", ".invalid",
)


def _forbid_cleartext_object_storage(settings: "Settings") -> list[str]:
    """The one home for "a cleartext / compose-shim object-storage endpoint is
    forbidden". Returns a list of problem strings (empty = clean).

    Called by both preflights: `internet_reachable_preflight` (so it also fires
    for staging, which `production_preflight` early-returns past) and
    `production_preflight` (so a prod boot fails on it directly, not only via
    the second validator).
    """
    problems: list[str] = []

    if settings.s3_endpoint_url and not settings.s3_endpoint_url.lower().startswith(
        "https://"
    ):
        problems.append(
            "S3_ENDPOINT_URL must use https outside development — an http "
            "endpoint sends credentials and objects in cleartext to the "
            "object store. Unset it for real AWS S3."
        )
    if settings.s3_public_endpoint:
        low = settings.s3_public_endpoint.lower()
        if low.startswith("http://") or any(m in low for m in _LOCAL_ENDPOINT_MARKERS):
            problems.append(
                "S3_PUBLIC_ENDPOINT must be a real https host, not a "
                "localhost/compose value — it is a dev-only shim for signing "
                "presigned URLs for a browser that cannot resolve the "
                "internal storage host. Unset it outside development."
            )
    return problems


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
    # Multi-session refresh rotation (plan §A.3 / status.md "W0.4 kickoff
    # decisions", D3): the immediately-previous jti of a session stays
    # acceptable for this long after rotation, so an app killed mid-refresh
    # (response never received/persisted) isn't an unrecoverable logout. A
    # SECOND presentation of that same previous jti — grace tolerates exactly
    # one extra use, not unlimited replay — is treated as reuse and revokes
    # that session (token_store.claim_and_rotate).
    refresh_grace_seconds: int = 60
    password_reset_expire_minutes: int = 30
      # Staff invite links (set-your-password) live longer than a self-service reset.
    invite_token_expire_hours: int = 48
    # Base URL of the frontend that renders the set-password / reset page.
    frontend_base_url: str = "http://localhost:3000"
    # --- Media / storage (Phase 4) ---
    # S3-compatible object storage (AWS S3, Cloudflare R2, MinIO).
    s3_endpoint_url: str | None = None          # None = real AWS S3
    # Host the BROWSER uses to reach object storage, when it differs from the
    # host THIS process uses (s3_endpoint_url). Presigned upload/download URLs
    # are signed for this host so the browser can follow them — SigV4 signs the
    # Host header, so a URL signed for the internal host is rejected when the
    # request arrives on the public one. This process still does its own reads
    # and writes (object_exists, delete) via s3_endpoint_url. Dev/compose only:
    # the API container reaches MinIO at http://minio:9000, the browser needs
    # http://localhost:9000. Leave unset for real AWS S3 (one host for both).
    s3_public_endpoint: str | None = None
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
    # Cap on concurrent open upload jobs (awaiting_upload / uploaded /
    # processing) per sermon. Retry-spam past this leaves unbounded jobs and
    # orphan raw-bucket objects; the ticket endpoint 429s at the cap.
    max_open_upload_jobs_per_sermon: int = 5
    # Light per-sermon rate-limit on upload-ticket minting (Redis, fails open).
    # The BFF hides the client IP, so the global per-IP limiter cannot see this.
    upload_ticket_rate_limit: int = 10
    upload_ticket_rate_window_seconds: int = 60
    # Hard cap on a cover-image object, re-checked against real bytes at
    # thumbnail-confirm time (the presign signature only pins content-type).
    max_thumbnail_bytes: int = 10 * 1024 * 1024   # 10 MB
    # How long a playback URL stays valid.
    stream_url_expire_seconds: int = 21600      # 6 hours
    # Optional CDN in front of the media bucket. NOT WIRED UP YET: there is no
    # CDN request-signing implementation in this codebase, so setting this
    # today does nothing but trip `production_preflight` below (and, for
    # staging, the preflight script) — see app/core/storage.py's
    # cdn_url_for(), which is where real signing belongs once it exists.
    cdn_base_url: str | None = None
    max_upload_bytes: int = 5 * 1024 * 1024 * 1024   # 5 GB
    # Run transcodes inline (dev/test) instead of via a background worker.
    transcode_inline: bool = True
    # False = passthrough: serve the uploaded file directly, no FFmpeg needed.
    # True  = produce an HLS ladder (requires FFmpeg + a background worker).
    # Legacy pre-Stream path: Cloudflare Stream (below) is now the intended
    # owner of adaptive bitrate going forward, per the mobile media pipeline
    # plan's decision not to build a self-hosted transcode worker. A sermon
    # with transcode_enabled=True produces multiple MediaRef rows (an
    # "ambiguous ladder" that _start_stream_ingest deliberately skips — see
    # media_service.py), so those renditions are never Stream-ingested and
    # are served via the old S3-presigned fallback forever. That fallback
    # lost its quality-tier gate when FREE_TIER_MAX_QUALITY was deleted
    # (W1.5) and nothing replaced it — a free-tier viewer can now reach any
    # quality tier on transcoded content. Not an authorization-boundary
    # break (paid-tier gating elsewhere is untouched), but real enough that
    # `production_preflight` below refuses to boot with this on until the
    # legacy path is either re-gated or retired.
    transcode_enabled: bool = False

    # --- Cloudflare Stream (mobile app media pipeline, plan §A.2) ---
    # Leave cf_account_id/cf_stream_api_token blank to use the local stub
    # provider (no Cloudflare account needed) — see app/core/stream.py.
    cf_account_id: str | None = None
    cf_stream_api_token: str | None = None
    # Needed to construct playback URLs (W1.5) — not read by the ingest path
    # built in this phase, but accepted now since it's already a provisioned,
    # verified credential (status.md "W0.1 Cloudflare credentials received").
    cf_stream_customer_subdomain: str | None = None
    # Generated by Cloudflare when the webhook notification URL is registered
    # (PUT /accounts/{id}/stream/webhook — see DEPLOYMENT.md). Required to
    # verify inbound ready/error events; the mock/stub webhook path (tests,
    # local dev) does not need it.
    cf_stream_webhook_secret: str | None = None
    # How long the presigned GET handed to Cloudflare's "copy from URL" ingest
    # stays valid. Generous — large masters take a while for Cloudflare to
    # pull, and an expired URL mid-pull fails the ingest outright.
    stream_ingest_url_expire_seconds: int = 21600      # 6 hours
    # Signing key for Stream's self-signed playback JWTs (W1.5 —
    # app/core/stream.py's CloudflareStreamProvider.signed_playback_url).
    # Both created together, once, via `POST /accounts/{id}/stream/keys`
    # (DEPLOYMENT.md §12) — Cloudflare returns the PEM exactly once, at
    # creation time, so it must be captured then. Still a placeholder as of
    # this writing (Isaac has not generated a signing key yet); until it is
    # set, get_stream/get_audio_download fall back to the pre-Stream
    # presigned-S3 path for any Stream-ingested rendition rather than 500ing
    # a playback request — see media_service._resolve_variant_url.
    cf_stream_signing_key_id: str | None = None
    # RSA private key, PEM-encoded. Most env-var mechanisms (shell exports,
    # docker-compose, Secrets Manager plaintext values) cannot carry literal
    # newlines cleanly, so this accepts "\n"-escaped input (one physical
    # line) and unescapes it — see normalize_signing_key_pem below.
    cf_stream_signing_key_pem: str | None = None

    # --- Glacier archival of raw masters (plan §A.2, L8 — not skippable) ---
    # Destination is /sermon_archives in the SAME raw bucket (status.md "W0.1
    # Glacier archive location confirmed"), already provisioned at this
    # storage class. The archival code sets StorageClass explicitly on copy
    # regardless of the bucket's own lifecycle config — see
    # app/core/storage.py's copy_object() callers.
    s3_archive_storage_class: str = "DEEP_ARCHIVE"

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

    # Sermon comments: auto-hide once this many DISTINCT reporters have
    # reported a comment (counted since the last moderator restore; plan
    # §A.5). Read at call time, so it is tunable without a redeploy of code.
    comments_auto_hide_threshold: int = Field(default=3, ge=1)

    # Max failed logins per IP+email window (enforced via Redis)
    login_rate_limit: int = 10
    login_rate_window_seconds: int = 60

    # Global request cap, enforced as a token bucket in
    # GlobalRateLimitMiddleware (status.md "MOBILE — W2.1 rate limiter
    # re-key"; replaces the old global_rate_limit/global_rate_window_seconds
    # fixed-window pair). Keyed per-identity, not per-endpoint:
    #   - a request with a valid, signature-verified access token (any type,
    #     any route) draws from that user's bucket (`user:{sub}`) — one
    #     budget shared across a person's devices.
    #   - everything else draws from the calling IP's bucket (`ip:{client}`).
    #     In this app that is, in practice, only the four unauthenticated
    #     auth endpoints (register/login/forgot-password/reset-password):
    #     the mobile app requires sign-in before any other route is
    #     reachable (plan L2), so there is no anonymous browsing traffic to
    #     share that bucket.
    # `*_burst` is bucket capacity (a request costs 1 token); `*_per_minute`
    # is the sustained refill rate. Either pair set to <= 0 disables that
    # bucket (mirrors the old `limit <= 0` escape).
    user_rate_limit_burst: int = 60
    user_rate_limit_per_minute: int = 120
    ip_rate_limit_burst: int = 20
    ip_rate_limit_per_minute: int = 20

    # Reverse proxies whose X-Forwarded-For header we trust to carry the real
    # client IP (plain IPs and CIDRs; see app/core/net.client_ip). Empty =
    # trust nothing = key rate limits on the immediate peer, the historical
    # behaviour. SECURITY: only list peers you actually control. Too broad a
    # list (worst case a world CIDR) makes X-Forwarded-For attacker-forgeable,
    # which turns every per-IP rate limit into a trivial bypass.
    trusted_proxies: list[str] = []
    # Reject request bodies larger than this before parsing (bytes).
    max_request_bytes: int = 2 * 1024 * 1024

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def is_internet_reachable(self) -> bool:
        """True for staging and production — see INTERNET_REACHABLE_ENVIRONMENTS."""
        return self.environment.lower() in INTERNET_REACHABLE_ENVIRONMENTS

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

    @property
    def stream_is_live(self) -> bool:
        return bool(self.cf_account_id and self.cf_stream_api_token)

    @property
    def stream_signing_is_configured(self) -> bool:
        return bool(self.cf_stream_signing_key_id and self.cf_stream_signing_key_pem)

    @field_validator("cf_stream_signing_key_pem")
    @classmethod
    def normalize_signing_key_pem(cls, v: str | None) -> str | None:
        """Undo the "\\n"-escaping described on the field, so callers always
        see a real multi-line PEM. A value with real newlines already
        (e.g. read from a mounted secret file) round-trips unchanged."""
        if v is None:
            return v
        return v.replace("\\n", "\n")

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

    @field_validator("s3_public_endpoint")
    @classmethod
    def s3_public_endpoint_is_a_clean_origin(cls, v: str | None) -> str | None:
        """Structural check on S3_PUBLIC_ENDPOINT, in EVERY environment.

        It is only ever a ``scheme://host[:port]`` the browser will follow to
        object storage — never carrying credentials, a path, a query, or a
        fragment. ``http://`` is allowed only for a localhost / compose host
        (the dev shim); anything else must be ``https://``. The production
        preflight's denylist stays as a second layer.
        """
        if v is None:
            return v

        parts = urlsplit(v)
        if parts.scheme not in ("http", "https"):
            raise ValueError("S3_PUBLIC_ENDPOINT must be an http:// or https:// URL")
        if not parts.hostname:
            raise ValueError("S3_PUBLIC_ENDPOINT must include a host")
        if parts.username or parts.password:
            raise ValueError(
                "S3_PUBLIC_ENDPOINT must not contain credentials (user:pass@)"
            )
        if parts.path not in ("", "/"):
            raise ValueError(
                "S3_PUBLIC_ENDPOINT must be scheme://host[:port] with no path"
            )
        if parts.query or parts.fragment:
            raise ValueError(
                "S3_PUBLIC_ENDPOINT must not contain a query or fragment"
            )

        host = parts.hostname.lower()
        dev_hosts = {
            "localhost", "127.0.0.1", "0.0.0.0", "::1",
            "minio", "host.docker.internal",
        }
        is_dev_host = (
            host in dev_hosts
            or host.endswith(".localhost")
            or host.endswith(".invalid")
        )
        if parts.scheme == "http" and not is_dev_host:
            raise ValueError(
                "S3_PUBLIC_ENDPOINT may only use http:// for a localhost/compose "
                "host (the dev-only presign shim); use https:// for a real host"
            )
        return v

    @field_validator("trusted_proxies")
    @classmethod
    def trusted_proxies_are_scoped(cls, v: list[str]) -> list[str]:
        """Validate every trusted-proxy entry, in EVERY environment.

        Runs regardless of ``environment`` — staging is frequently
        internet-reachable, so an over-broad entry there is exactly as
        exploitable as one in production. An entry that is too broad (a world
        CIDR, or a prefix short enough to span a large slice of the internet
        such as ``0.0.0.0/1`` + ``128.0.0.0/1``) makes ``X-Forwarded-For``
        attacker-forgeable and turns every per-IP rate limit into a one-header
        bypass.

        This CANNOT catch a proxy that is itself narrowly scoped but forwards
        unverified client input (a non-appending / header-spoofing proxy) — see
        the SECURITY note on the ``trusted_proxies`` field. Only list peers whose
        forwarding behaviour you control.
        """
        # An IPv4 entry must be /8 or narrower; IPv6 must be /32 or narrower.
        min_v4_prefix, min_v6_prefix = 8, 32
        for raw in v:
            entry = raw.strip()
            if not entry:
                continue
            try:
                network = ipaddress.ip_network(entry, strict=False)
            except ValueError:
                raise ValueError(
                    f"TRUSTED_PROXIES entry {entry!r} is not a valid IP or CIDR"
                )
            if network.prefixlen == 0:
                raise ValueError(
                    f"TRUSTED_PROXIES must not contain a world CIDR ({entry!r}) — "
                    "it makes X-Forwarded-For forgeable and every rate limit "
                    "bypassable"
                )
            min_prefix = min_v4_prefix if network.version == 4 else min_v6_prefix
            if network.prefixlen < min_prefix:
                raise ValueError(
                    f"TRUSTED_PROXIES entry {entry!r} is too broad "
                    f"(/{network.prefixlen}) — IPv{network.version} entries must "
                    f"be /{min_prefix} or narrower; a wide range makes "
                    "X-Forwarded-For forgeable and every per-IP rate limit "
                    "bypassable"
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
        if not self.stream_is_live:
            problems.append(
                "CF_ACCOUNT_ID and CF_STREAM_API_TOKEN are required "
                "(without them the stub Stream provider is used and sermon "
                "video never reaches Cloudflare)"
            )
        else:
            if not self.cf_stream_webhook_secret:
                problems.append(
                    "CF_STREAM_WEBHOOK_SECRET is required once Stream is live — "
                    "without it the webhook endpoint cannot verify inbound "
                    "Cloudflare Stream events"
                )
            if not self.stream_signing_is_configured:
                problems.append(
                    "CF_STREAM_SIGNING_KEY_ID and CF_STREAM_SIGNING_KEY_PEM are "
                    "required once Stream is live — without them get_stream/"
                    "get_audio_download cannot sign playback URLs for any "
                    "Stream-ingested rendition (media_service falling back to "
                    "presigned S3 in that case is a dev/staging convenience, "
                    "not something production should ever rely on)"
                )
        if self.transcode_enabled:
            problems.append(
                "TRANSCODE_ENABLED must be false in production — the legacy "
                "multi-rendition transcode path is never Stream-ingested "
                "(see the field's comment above) and its S3-presigned "
                "fallback has no quality-tier gate since FREE_TIER_MAX_QUALITY "
                "was removed"
            )
        if self.debug:
            problems.append("DEBUG must be false (it exposes API docs)")
        if any(o == "*" for o in self.allowed_origins):
            problems.append("ALLOWED_ORIGINS must not contain '*' with credentials")
        if any(o.startswith("http://") for o in self.allowed_origins):
            problems.append("ALLOWED_ORIGINS must use https in production")
        if self.frontend_base_url.startswith("http://"):
            problems.append("FRONTEND_BASE_URL must use https in production")
        # Cleartext / compose-shim object-storage endpoints: the rule and its
        # message text live in `_forbid_cleartext_object_storage`.
        # `internet_reachable_preflight` runs the same helper so the check also
        # fires for staging (which this validator early-returns past).
        problems.extend(_forbid_cleartext_object_storage(self))
        if not self.database_url.startswith(("postgresql+psycopg://", "postgresql://")):
            problems.append("DATABASE_URL must point at PostgreSQL")
        # trusted_proxies format / breadth is validated in every environment by
        # trusted_proxies_are_scoped (a field validator) — not repeated here.
        if self.cdn_base_url:
            problems.append(
                "CDN_BASE_URL is set but this codebase has no CDN request-signing "
                "implementation (no signing key/keypair setting exists). "
                "app/core/storage.py's cdn_url_for() always falls back to the "
                "presigned S3 URL for exactly this reason, so enabling it today "
                "only adds a config footgun with no CDN benefit — a bare CDN URL "
                "built from an object key carries no access control, and object "
                "keys are deterministic and public (see media_key()). Remove "
                "CDN_BASE_URL until real CDN signing is implemented, or extend "
                "this check alongside cdn_url_for() once it is."
            )

        if problems:
            raise ValueError(
                "Production preflight failed:\n  - " + "\n  - ".join(problems)
            )
        return self

    @model_validator(mode="after")
    def internet_reachable_preflight(self) -> "Settings":
        """Cleartext object-storage checks that must hold for staging as well as
        production.

        ``production_preflight`` above early-returns for every non-production
        environment, so on a staging box with real S3 keys an ``http://``
        ``S3_ENDPOINT_URL`` (or a compose-shim ``S3_PUBLIC_ENDPOINT``) would
        otherwise sail through. Message text mirrors the old production-only
        wording so existing error-matching keeps working. Runs for production
        too — it is a second layer there, not a replacement.
        """
        if not self.is_internet_reachable:
            return self

        problems = _forbid_cleartext_object_storage(self)

        if problems:
            raise ValueError(
                "Environment preflight failed (staging/production):\n  - "
                + "\n  - ".join(problems)
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
