import ipaddress
import os
from functools import lru_cache
from typing import Annotated
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Recognised deployment environments. An unrecognised value is rejected rather
# than silently treated as non-production — landing on "not production" is what
# disables the preflight below and exposes /docs.
KNOWN_ENVIRONMENTS = {"development", "test", "staging", "production"}

# Environments a browser — or an attacker — can reach directly: staging
# routinely runs with real credentials on a public hostname, so this exists
# for any future check that must fire for staging as well as production.
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


# Bucket-name substrings that mark a dev/staging bucket. A production config
# pointing at one of these is almost certainly a copy-paste of the dev
# override rather than the real prod bucket (plan §A.2.4).
_NON_PRODUCTION_BUCKET_MARKERS = ("-dev", "-staging")


def _r2_endpoint_host_is_valid(endpoint_url: str) -> bool:
    """True if `endpoint_url`'s host is a Cloudflare R2 account endpoint —
    either the standard form or the EU-jurisdiction form (decision (e)),
    e.g. `<account>.r2.cloudflarestorage.com` or
    `<account>.eu.r2.cloudflarestorage.com`. Used only by the production
    preflight (plan §A.2.4); dev/staging may point at any https endpoint."""
    host = urlsplit(endpoint_url).netloc.lower()
    return host.endswith(".r2.cloudflarestorage.com")


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
    # Seconds. 2s fails fast in local dev and same-VPC production; a managed
    # free tier (Render Key Value) can take longer than that just to connect.
    redis_connect_timeout_seconds: float = Field(default=2.0, gt=0)
    redis_socket_timeout_seconds: float = Field(default=2.0, gt=0)

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
    # Self-registered (email/password) viewers confirm their address with a
    # 6-digit emailed code before they can sign in. Google/Apple sign-ins skip
    # it (the provider already verified the email). Off only for the test suite.
    require_email_verification: bool = True
    email_verification_expire_minutes: int = 15
    # Wrong guesses allowed against one code before it is burned (a 6-digit
    # code is only 10^6 wide, so guessing must be capped per code, not per IP).
    email_verification_max_attempts: int = 5
    # Base URL of the frontend that renders the set-password / reset page.
    frontend_base_url: str = "http://localhost:3000"
    # --- Media / storage (Phase 4) ---
    # Live object store: Cloudflare R2 (decision (a) — S3 now names the
    # archive vendor only, see archive_store_* below). R2's account-scoped
    # endpoint always needs to be set to go live; unset means the local stub
    # (app/core/storage.py's LocalStorage). Region/addressing/checksum mode
    # are fixed for R2 in get_storage() rather than configurable here — see
    # plan §A.1.
    object_store_endpoint_url: str | None = None
    object_store_access_key_id: str | None = None
    object_store_secret_access_key: str | None = None
    # "-dev" defaults (plan §A.2.1) so a production deploy that forgets to
    # override the bucket names fails the "-dev"/"-staging" bucket-name
    # refusal below instead of silently writing real sermon media into a
    # bucket named for development.
    object_store_raw_bucket: str = "sermon-raw-dev"
    object_store_media_bucket: str = "sermon-media-dev"
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
    # Decimal 5 GB (P1), not 5 GiB — below R2's single-PUT cap of
    # 5,363,466,240 bytes, and it keeps the portal's "5 GB" copy literally
    # true. See media_service.py's 413 message, which formats this the same
    # decimal way.
    max_upload_bytes: int = 5_000_000_000
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

    # --- Cold-tier archive: AWS S3 Deep Archive (plan L2, §A.2.1) ---
    # A genuine cross-vendor move, not a same-account storage-class change:
    # copy R2 -> AWS, verify, then (once ARCHIVE_DELETE_SOURCE is on) delete
    # the R2 copy. Unset access_key_id/secret_access_key means the local
    # stub (app/core/storage.py's LocalArchiveStore) — see archive_is_live
    # below and get_archive_store()'s wiring to these fields.
    archive_store_bucket: str | None = None
    # No fixed default, unlike object_store_endpoint_url's R2 "auto" region
    # (P4) — this is a real AWS region the archive bucket was created in and
    # varies per deployment.
    archive_store_region: str | None = None
    archive_store_access_key_id: str | None = None
    archive_store_secret_access_key: str | None = None
    archive_store_storage_class: str = "DEEP_ARCHIVE"
    # Whether the sweep is allowed to delete the R2 source copy once a
    # verified archive copy exists. Refused outright unless BOTH stores are
    # live — see archive_delete_requires_live_stores below (plan §A.2.2);
    # `sweep_archives` (R1.9) re-checks this in code as a second line of
    # defense.
    archive_delete_source: bool = False
    # Floor of 1 day: 0 would let a source be deleted the instant it's
    # archived, with no window to catch a bad copy before the R2 original is
    # gone.
    archive_source_retention_days: int = Field(default=14, ge=1)
    # How long a sweep's claim on a media_archives row is honoured before
    # another sweep run is allowed to take it over (plan §A.3.2's fencing
    # lease).
    archive_lease_minutes: int = 120

    # --- Subscriptions (Phase 5) ---
    # How long an entitlement decision is cached in Redis.
    entitlement_cache_seconds: int = 300

    # --- Email (SMTP — production uses Resend's SMTP relay, DEPLOYMENT.md §7) ---
    # Unset -> console backend (logs the message). Required in production.
    # SMTP_FROM_EMAIL may carry a display name: "RhemaPod <no-reply@rhemapod.com>".
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

    # System audit log retention (plan-admin-settings §A.7, values Isaac
    # approved at AS0). `auth.*` rows are hard-deleted past this age.
    audit_auth_retention_days: int = Field(default=365, ge=1)
    # Every other `audit_log` row keeps its row (who/what/when of a role
    # change, a settings edit, etc.) but has `ip`/`user_agent` nulled past
    # this age — the network identifier goes, the decision trail doesn't.
    audit_network_retention_days: int = Field(default=365, ge=1)

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
    # The admin database import (`POST /admin/data/import`) is the one JSON
    # body allowed past `max_request_bytes`: an export file is the whole
    # document. Admin only; the BFF applies the same ceiling.
    max_import_bytes: int = 25 * 1024 * 1024

    # --- Social sign-in (ADR 0015) ---
    # Google ships first and must be real (Isaac's decision): client IDs are
    # supplied once he's created them in Google Cloud Console. Comma-separated
    # (not JSON, unlike allowed_origins) — NoDecode below opts these two
    # fields out of pydantic-settings' default JSON-decode-from-env attempt,
    # which would otherwise reject a bare comma-separated value outright.
    google_oauth_client_ids: Annotated[list[str], NoDecode] = []
    # com.niitech.rhemapod is the mobile app's bundle id / Android package.
    apple_oauth_audiences: Annotated[list[str], NoDecode] = ["com.niitech.rhemapod"]
    oauth_google_enabled: bool = True
    # Apple ships second — Isaac is enrolling in the Apple Developer Program
    # on his own timeline. Flip this once that's done; not flipped here.
    oauth_apple_enabled: bool = False
    oauth_jwks_default_ttl_seconds: int = 3600

    @field_validator("database_url", "database_replica_url")
    @classmethod
    def _force_psycopg_driver(cls, v: str | None) -> str | None:
        """Managed Postgres hosts (Render, Heroku-style) hand out
        `postgres://` / `postgresql://` URLs with no driver. SQLAlchemy would
        then pick psycopg2 — not installed, and sync — so name the async-capable
        psycopg 3 driver explicitly. A URL that already names a driver is left
        alone."""
        if v is None:
            return v
        for bare in ("postgres://", "postgresql://"):
            if v.startswith(bare):
                return "postgresql+psycopg://" + v[len(bare):]
        return v

    @field_validator("google_oauth_client_ids", "apple_oauth_audiences", mode="before")
    @classmethod
    def _parse_comma_separated(cls, v: object) -> list[str]:
        if isinstance(v, str):
            return [item.strip() for item in v.split(",") if item.strip()]
        return v  # type: ignore[return-value]

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
        return bool(self.object_store_access_key_id and self.object_store_secret_access_key)

    @property
    def archive_is_live(self) -> bool:
        """Region is required here (unlike storage_is_live's live store,
        whose region is hardcoded "auto" — P4): a real AWS client built with
        no region either fails to construct or silently resolves to
        whatever boto3's default-region chain finds, which is exactly the
        kind of "wrong bucket, wrong region" surprise get_archive_store()'s
        stub-in-dev / refuse-in-production behaviour exists to avoid."""
        return bool(
            self.archive_store_access_key_id
            and self.archive_store_secret_access_key
            and self.archive_store_region
        )

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

    @field_validator("object_store_endpoint_url")
    @classmethod
    def object_store_endpoint_is_https(cls, v: str | None) -> str | None:
        """OBJECT_STORE_ENDPOINT_URL must be https in EVERY environment (plan
        §A.2.2), not just staging/production. Local dev now points at a real
        Cloudflare R2 bucket (decision L3) instead of a compose-shim MinIO
        endpoint, so there is no legitimate http case left to allow — an
        http endpoint sends credentials and objects in cleartext.
        """
        if v is not None and not v.lower().startswith("https://"):
            raise ValueError(
                "OBJECT_STORE_ENDPOINT_URL must use https in every "
                "environment, including development — local dev points at "
                "a real R2 bucket now, not a compose MinIO endpoint."
            )
        return v

    @field_validator("archive_store_storage_class")
    @classmethod
    def archive_storage_class_is_known(cls, v: str) -> str:
        allowed = ("DEEP_ARCHIVE", "GLACIER")
        if v not in allowed:
            raise ValueError(
                f"ARCHIVE_STORE_STORAGE_CLASS must be one of {allowed}, got {v!r}"
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
        Reaching production is a different matter: an in-memory storage stub
        would silently drop every upload, a console email backend would
        silently swallow invite/reset mail, and so on for each external
        dependency below. Failing to boot is the correct response — a silent
        fallback here is the most dangerous failure mode in the system.
        """
        if not self.is_production:
            return self

        problems: list[str] = []

        if not self.storage_is_live:
            problems.append(
                "OBJECT_STORE_ACCESS_KEY_ID and OBJECT_STORE_SECRET_ACCESS_KEY are required "
                "(without them uploads silently go to an in-memory stub)"
            )
        elif not self.object_store_endpoint_url:
            problems.append(
                "OBJECT_STORE_ENDPOINT_URL is required once storage credentials "
                "are live — the live store is Cloudflare R2 only (decision (a)), "
                "and an unset endpoint would leave boto3 to default to real "
                "AWS S3, the wrong vendor entirely"
            )
        elif not _r2_endpoint_host_is_valid(self.object_store_endpoint_url):
            problems.append(
                "OBJECT_STORE_ENDPOINT_URL host must be "
                "*.r2.cloudflarestorage.com, got "
                f"{urlsplit(self.object_store_endpoint_url).netloc!r}"
            )
        if not self.archive_is_live:
            problems.append(
                "ARCHIVE_STORE_ACCESS_KEY_ID, ARCHIVE_STORE_SECRET_ACCESS_KEY "
                "and ARCHIVE_STORE_REGION are all required (without them "
                "get_archive_store() stays on the in-process stub and no "
                "sermon master ever reaches the cold-archive tier)"
            )
        elif not self.archive_store_bucket:
            problems.append(
                "ARCHIVE_STORE_BUCKET is required once archive credentials "
                "are live — sweep_archives has nowhere to copy to without it"
            )
        if self.archive_store_storage_class != "DEEP_ARCHIVE":
            problems.append(
                "ARCHIVE_STORE_STORAGE_CLASS must be DEEP_ARCHIVE in "
                "production (GLACIER is a legal config value but not the "
                "one this plan's Object Lock / retention design was built "
                f"against) — got {self.archive_store_storage_class!r}"
            )
        for field_name, bucket in (
            ("OBJECT_STORE_RAW_BUCKET", self.object_store_raw_bucket),
            ("OBJECT_STORE_MEDIA_BUCKET", self.object_store_media_bucket),
            ("ARCHIVE_STORE_BUCKET", self.archive_store_bucket),
        ):
            if bucket and any(marker in bucket for marker in _NON_PRODUCTION_BUCKET_MARKERS):
                problems.append(
                    f"{field_name} ({bucket!r}) looks like a dev/staging "
                    "bucket name — production must point at its own bucket, "
                    "never one named \"-dev\" or \"-staging\""
                )
        if (
            self.object_store_raw_bucket
            and self.object_store_raw_bucket == self.object_store_media_bucket
        ):
            problems.append(
                "OBJECT_STORE_RAW_BUCKET and OBJECT_STORE_MEDIA_BUCKET must "
                "not be the same bucket"
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
        if self.oauth_google_enabled and not self.google_oauth_client_ids:
            problems.append(
                "GOOGLE_OAUTH_CLIENT_IDS is required while OAUTH_GOOGLE_ENABLED "
                "is true (without it every Google ID token fails audience "
                "verification, and /auth/oauth/google is unusable)"
            )
        if self.oauth_apple_enabled and not self.apple_oauth_audiences:
            problems.append(
                "APPLE_OAUTH_AUDIENCES is required while OAUTH_APPLE_ENABLED "
                "is true (without it every Apple identity token fails "
                "audience verification, and /auth/oauth/apple is unusable)"
            )
        if not self.require_email_verification:
            problems.append(
                "REQUIRE_EMAIL_VERIFICATION must be true (it exists only so the "
                "test suite can register-then-login without the emailed code)"
            )
        if self.debug:
            problems.append("DEBUG must be false (it exposes API docs)")
        if any(o == "*" for o in self.allowed_origins):
            problems.append("ALLOWED_ORIGINS must not contain '*' with credentials")
        if any(o.startswith("http://") for o in self.allowed_origins):
            problems.append("ALLOWED_ORIGINS must use https in production")
        if self.frontend_base_url.startswith("http://"):
            problems.append("FRONTEND_BASE_URL must use https in production")
        # Cleartext object-storage endpoints are refused by the
        # object_store_endpoint_is_https field validator above, which runs
        # in EVERY environment (plan §A.2.2) — Settings construction never
        # reaches this far with one set, so there is nothing to repeat here.
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
                "keys are deterministic and public (see media_key()). This "
                "includes a *.r2.dev URL: R2.1 leaves every bucket's public "
                "R2.dev subdomain disabled, so one would be just as unsigned "
                "and just as wrong here. Remove CDN_BASE_URL until real CDN "
                "signing is implemented, or extend this check alongside "
                "cdn_url_for() once it is."
            )

        if problems:
            raise ValueError(
                "Production preflight failed:\n  - " + "\n  - ".join(problems)
            )
        return self

    @model_validator(mode="after")
    def no_legacy_s3_env_vars(self) -> "Settings":
        """A lingering `S3_*` environment variable is almost always a
        leftover from before decision (a)'s object_store_*/archive_store_*
        rename (plan §A.2.2). pydantic-settings silently ignores env vars
        that match no field name, so a developer's shell or a deploy
        manifest that still exports (say) S3_ENDPOINT_URL would have it
        silently do nothing rather than fail loudly — exactly the kind of
        drift that leaves someone debugging "why is this using the stub"
        with a stale variable sitting right there. Runs in EVERY
        environment, not just production; this validator itself is meant to
        be removed one release cycle after the rename fully lands.

        Checks the process environment only, not `.env` — deployed
        environments (where this matters most) inject real environment
        variables and have no `.env` file at all (see `model_config`
        above), so this is a complete check there. A stray `S3_*` line
        sitting only in a developer's gitignored `.env` is a lower-stakes
        miss this validator does not catch.
        """
        legacy = sorted(k for k in os.environ if k.startswith("S3_"))
        if legacy:
            raise ValueError(
                "Legacy S3_* environment variable(s) still set: "
                f"{', '.join(legacy)} — rename to the OBJECT_STORE_*/"
                "ARCHIVE_STORE_* equivalents (decision (a)). "
                "pydantic-settings silently ignores unmatched env vars, so "
                "these do nothing today and must be removed, not renamed "
                "in place."
            )
        return self

    @model_validator(mode="after")
    def archive_delete_requires_live_stores(self) -> "Settings":
        """ARCHIVE_DELETE_SOURCE=true is refused unless BOTH the live store
        and the archive store are live — in EVERY environment, not only
        production (plan §A.2.2). Deleting a raw master from R2 on the word
        of a stub archive means the "verified copy" that deletion is
        supposed to depend on was never actually written anywhere.
        `sweep_archives` (plan §A.3.2/A.3.4) re-checks this in code as a
        second line of defense, independent of this validator.
        """
        if self.archive_delete_source and not (self.storage_is_live and self.archive_is_live):
            raise ValueError(
                "ARCHIVE_DELETE_SOURCE is true but the live store and/or "
                "the archive store is still a stub — refusing to enable "
                "source deletion without both being real, live credentials."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
