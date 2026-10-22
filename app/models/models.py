import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    Index,
    JSON,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

from sqlalchemy import BigInteger, ForeignKey, Integer, SmallInteger, Text  # noqa: E402
from sqlalchemy.orm import relationship  # noqa: E402

from app.db.database import Base


class ContentTier(str, enum.Enum):
    FREE = "free"
    PAID = "paid"


class SermonStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    PUBLISHED = "published"
    REJECTED = "rejected"
    UNPUBLISHED = "unpublished"


class MediaType(str, enum.Enum):
    VIDEO = "video"
    AUDIO = "audio"


# Statuses a viewer is allowed to see. Anything else is editor/manager-only.
VIEWER_VISIBLE_STATUSES = (SermonStatus.PUBLISHED,)

class UserRole(str, enum.Enum):
    VIEWER = "viewer"
    EDITOR = "editor"
    MANAGER = "manager"
    ADMIN = "admin"


class Gender(str, enum.Enum):
    MALE = "male"
    FEMALE = "female"


class AuthProvider(str, enum.Enum):
    """OAuth identity provider a `UserIdentity` row is linked against. Only
    ``viewer``-role accounts ever gain one (ADR 0015) — staff always sign in
    via `/auth/login`."""

    GOOGLE = "google"
    APPLE = "apple"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(
        String(320), unique=True, index=True, nullable=False
    )
    # The single display field everywhere else in the backend (comments, announcement
    # approval logs, staff invite emails) still reads/writes this — unchanged by the
    # addition below. `first_name`/`last_name` are the Me-page profile-edit UI's own
    # fields (Isaac's ask, session 2026-10-09); saving them recomputes this as
    # f"{first_name} {last_name}" server-side (`comments_service.update_profile_name`),
    # through the exact same content-moderation rules `full_name` always has, so nothing
    # downstream needs to know these new columns exist.
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    first_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    gender: Mapped[Gender | None] = mapped_column(
        Enum(Gender, name="user_gender", native_enum=False, length=10),
        nullable=True,
    )
    # Avatar storage mirrors `Sermon.thumbnail_key`/`Series.thumbnail_key` — a key into
    # the same media bucket, resolved to a URL on read via the same presigned/CDN path
    # (`auth_service._avatar_url`), never a raw public object URL.
    avatar_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # Nullable since ADR 0015: a viewer who signs in only via Google/Apple has
    # no password at all until they explicitly set one (Forgot Password).
    # `security.verify_password(plain, None)` already runs a dummy verify for
    # exactly this case — see that function's docstring.
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", native_enum=False, length=20),
        default=UserRole.VIEWER,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # NULL until the account first completes its staff invite (``reset_password``
    # sets it, in the same transaction as the password write, when currently
    # NULL). DB-authoritative "is this account still pending?" — ``resend_invite``
    # gates on it. Replaced the no-TTL ``invite_pending`` Redis key (ADR 0005 §4).
    activated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # NULL until the address is proven: the emailed sign-up code, a completed
    # reset/invite link, or a Google/Apple sign-in. `/auth/login` refuses a
    # viewer while NULL (staff prove theirs through the invite). Pre-existing
    # rows were backfilled with `created_at` (grandfathered).
    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Set once when the user accepts the comments terms (timestamp only, no
    # version; plan P9). NULL = not accepted, posting is refused.
    comments_terms_accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UserIdentity(Base):
    """One row per (user, OAuth provider) link (ADR 0015 — Google/Apple
    sign-in). `(provider, provider_subject)` is the actual lookup key a
    sign-in resolves against — `provider_subject` is that provider's stable
    `sub` claim, never the email (an OAuth email can drift; `sub` doesn't).
    `(user_id, provider)` additionally caps it to at most one Google + one
    Apple identity per user. `email_at_link` is audit-only — never queried
    against, so a later email change on either side can't silently break the
    link."""

    __tablename__ = "user_identities"
    __table_args__ = (
        UniqueConstraint("provider", "provider_subject", name="uq_user_identities_provider_subject"),
        UniqueConstraint("user_id", "provider", name="uq_user_identities_user_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider: Mapped[AuthProvider] = mapped_column(
        Enum(AuthProvider, name="auth_provider", native_enum=False, length=20),
        nullable=False,
    )
    provider_subject: Mapped[str] = mapped_column(String(255), nullable=False)
    email_at_link: Mapped[str | None] = mapped_column(String(320), nullable=True)
    is_private_email: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Category(Base):
    """A flat content category, e.g. Teaching, Worship, Youth.

    Deliberately non-hierarchical: a single level keeps browsing predictable
    and avoids the cycle/depth handling a tree needs.
    """

    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str] = mapped_column(String(140), unique=True, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Speaker(Base):
    __tablename__ = "speakers"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

class Series(Base):
    """Optional container for sermons. A sermon with no series is standalone."""

    __tablename__ = "series"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Default tier for episodes that don't override it.
    tier: Mapped[ContentTier] = mapped_column(
        Enum(ContentTier, name="content_tier", native_enum=False, length=10),
        default=ContentTier.FREE,
        nullable=False,
    )
    status: Mapped[SermonStatus] = mapped_column(
        Enum(SermonStatus, name="sermon_status", native_enum=False, length=20),
        default=SermonStatus.DRAFT,
        nullable=False,
        index=True,
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    sermons: Mapped[list["Sermon"]] = relationship(
        "Sermon", back_populates="series", passive_deletes=True
    )


class Sermon(Base):
    __tablename__ = "sermons"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_key: Mapped[str | None] = mapped_column(String(512), nullable=True)

    speaker_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("speakers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    series_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("series.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # Episode ordering within a series. Null for standalone sermons. Need not be
    # contiguous — gaps are fine and display in ascending order.
    episode_number: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Explicit tier override. Null means "inherit from the series" (or free if
    # standalone). Resolved by effective_tier() in the service layer.
    tier: Mapped[ContentTier | None] = mapped_column(
        Enum(ContentTier, name="content_tier", native_enum=False, length=10),
        nullable=True,
    )

    status: Mapped[SermonStatus] = mapped_column(
        Enum(SermonStatus, name="sermon_status", native_enum=False, length=20),
        default=SermonStatus.DRAFT,
        nullable=False,
        index=True,
    )

    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Editorial curation flag for Home's "Prophet's Catalog" shelf — set manually
    # per sermon via a switch on the editor page, not derived from any other field.
    is_prophets_catalog: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )

    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # When it becomes publicly visible once PUBLISHED. Null = as soon as it is
    # published. Mirrors Announcement.publish_at exactly — same derived,
    # query-time visibility pattern (see content_service.sermon_visibility_
    # clause / sermon_publish_time_passed), no background worker. No
    # `expires_at` equivalent — sermons don't expire.
    publish_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        # Weighted full-text GIN index backing `search_service._search_filter`
        # (title weight 'A', description weight 'B' — must stay byte-identical
        # to that function's `_weighted_vector` call, or Postgres won't use
        # this index for the query's `@@` expression). Restores a declaration
        # silently dropped from this class after the index itself was created
        # (`d3e4f5a6b7c8_add_search_and_analytics.py`); the index was never
        # removed from the database, only from the ORM's view of it.
        # Postgres-only: SQLite (the default test suite) has neither GIN nor
        # `to_tsvector`, and `search_service` falls back to `LIKE` there.
        Index(
            "ix_sermons_fts",
            text(
                "(setweight(to_tsvector('english', coalesce(title, '')), 'A') || "
                "setweight(to_tsvector('english', coalesce(description, '')), 'B'))"
            ),
            postgresql_using="gin",
        ).ddl_if(dialect="postgresql"),
    )

    series: Mapped["Series | None"] = relationship("Series", back_populates="sermons")
    media_refs: Mapped[list["MediaRef"]] = relationship(
        "MediaRef", back_populates="sermon", cascade="all, delete-orphan", passive_deletes=True
    )
    tags: Mapped[list["SermonTag"]] = relationship(
        "SermonTag", back_populates="sermon", cascade="all, delete-orphan", passive_deletes=True
    )
    approval_log: Mapped[list["ApprovalLog"]] = relationship(
        "ApprovalLog", back_populates="sermon", cascade="all, delete-orphan", passive_deletes=True
    )


class MediaRef(Base):
    """A single playable rendition of a sermon. Phase 4 populates these; Phase 3
    stores a plain URL/key so the content workflow is testable without media
    processing."""

    __tablename__ = "media_refs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    sermon_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sermons.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type: Mapped[MediaType] = mapped_column(
        Enum(MediaType, name="media_type", native_enum=False, length=10), nullable=False
    )
    quality: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Which bucket this rendition lives in. Passthrough renditions point at the
    # raw bucket; transcoded ones at the media bucket. Null = media bucket.
    bucket: Mapped[str | None] = mapped_column(String(255), nullable=True)
    s3_key: Mapped[str] = mapped_column(String(512), nullable=False)
    hls_manifest_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # Cloudflare Stream video uid this rendition was ingested into (plan
    # §A.2, W1.1/W1.2/W1.3). Nullable: set once the ingest kicks off
    # (app/services/media_service._start_stream_ingest), null for renditions
    # that predate the Stream pipeline or that Stream does not ingest (audio
    # — served straight from S3, W1.6). On MediaRef rather than Sermon
    # because video and audio are separate Stream ingests here (separate
    # UploadJobs, separate raw masters) — a MediaRef row is already "one
    # playable rendition", which is exactly what one Stream asset is.
    stream_uid: Mapped[str | None] = mapped_column(
        String(32), nullable=True, unique=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    sermon: Mapped["Sermon"] = relationship("Sermon", back_populates="media_refs")


class SermonTag(Base):
    __tablename__ = "sermon_tags"

    sermon_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sermons.id", ondelete="CASCADE"), primary_key=True
    )
    tag: Mapped[str] = mapped_column(String(60), primary_key=True, index=True)

    sermon: Mapped["Sermon"] = relationship("Sermon", back_populates="tags")


class ApprovalLog(Base):
    """Append-only audit trail of every status transition on a sermon."""

    __tablename__ = "approval_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    sermon_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sermons.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_status: Mapped[str] = mapped_column(String(20), nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    sermon: Mapped["Sermon"] = relationship("Sermon", back_populates="approval_log")

# ═══════════════════════════════════════════════════════════════════════════════
# Phase 4: Media upload & processing
# ═══════════════════════════════════════════════════════════════════════════════

class UploadStatus(str, enum.Enum):
    AWAITING_UPLOAD = "awaiting_upload"   # pre-signed URL issued, file not yet there
    UPLOADED = "uploaded"                 # client confirmed; queued for processing
    PROCESSING = "processing"             # transcode running
    READY = "ready"                       # renditions written, media_refs created
    FAILED = "failed"                     # transcode or validation failed


class UploadJob(Base):
    """Tracks one media upload from pre-signed URL through transcode to ready.

    Kept separate from Sermon so a sermon can accumulate several uploads over
    its life (a re-upload, an audio-only addition) with independent state and
    an error message that survives for the editor to read.
    """

    __tablename__ = "upload_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    sermon_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sermons.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    raw_key: Mapped[str] = mapped_column(String(512), nullable=False)
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # Client-declared content length at presign time. Nullable: older jobs
    # predate the column and the client may omit it. BigInteger — media files
    # routinely exceed the INT4 ceiling (~2.1 GB).
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    media_type: Mapped[MediaType] = mapped_column(
        Enum(MediaType, name="media_type", native_enum=False, length=10), nullable=False
    )
    status: Mapped[UploadStatus] = mapped_column(
        Enum(UploadStatus, name="upload_status", native_enum=False, length=20),
        default=UploadStatus.AWAITING_UPLOAD,
        nullable=False,
        index=True,
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    # Stream-ingest bookkeeping (plan §A.2, W1.1) — deliberately separate from
    # `status` above, which tracks the pre-existing transcode/passthrough
    # pipeline and is untouched by any of this. `attempts` counts
    # `_start_stream_ingest` kickoff attempts; `started_at` is set right
    # before each kickoff; `finished_at` is set once the Stream ingest is
    # fully resolved (ready-and-archived, or error-and-archived — see
    # media_service._apply_stream_state). sweep_stream_jobs.py needs all
    # three to tell "still working" from "kickoff never even got a uid" from
    # "resolved" without guessing from timestamps alone.
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 5: Subscriptions & payments
# ═══════════════════════════════════════════════════════════════════════════════

class SubscriptionTier(str, enum.Enum):
    FREE = "free"
    MONTHLY = "monthly"
    ANNUAL = "annual"


class SubscriptionStatus(str, enum.Enum):
    ACTIVE = "active"
    CANCELLED = "cancelled"   # still entitled until valid_until
    EXPIRED = "expired"       # entitlement revoked
    PAST_DUE = "past_due"     # payment failed; provider is retrying


# Tiers that grant access to paid content while status permits.
PAID_TIERS = (SubscriptionTier.MONTHLY, SubscriptionTier.ANNUAL)
# Statuses under which a paid tier still grants access. PAST_DUE is included
# deliberately: the provider retries for days, and cutting a paying member off
# at the first failed charge is worse than a short grace period.
ENTITLED_STATUSES = (
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.CANCELLED,
    SubscriptionStatus.PAST_DUE,
)


class Subscription(Base):
    """One row per user, always. Free users have tier=free and no expiry."""

    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    tier: Mapped[SubscriptionTier] = mapped_column(
        Enum(SubscriptionTier, name="subscription_tier", native_enum=False, length=20),
        default=SubscriptionTier.FREE,
        nullable=False,
    )
    status: Mapped[SubscriptionStatus] = mapped_column(
        Enum(SubscriptionStatus, name="subscription_status", native_enum=False, length=20),
        default=SubscriptionStatus.ACTIVE,
        nullable=False,
        index=True,
    )
    # Null for free tier (never expires).
    valid_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Provider-neutral identifiers (customer/subscription), for a future native
    # IAP provider. Null until one is wired up.
    provider: Mapped[str | None] = mapped_column(String(40), nullable=True)
    provider_customer_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_subscription_id: Mapped[str | None] = mapped_column(
        String(255), unique=True, nullable=True, index=True
    )
    cancel_at_period_end: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ProcessedWebhook(Base):
    """Idempotency ledger. Providers redeliver events; each is applied once."""

    __tablename__ = "processed_webhooks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    event_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    event_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # The subscription this event resolved to, when it resolved to one at all
    # (``_find_subscription`` legitimately returns ``None`` for events matching
    # no local row). Bare nullable UUID — no FK, no index — deliberately: it
    # turns the dedup ledger into queryable "became paid / lapsed" history for
    # Phase 3, and nothing in Phase 2 reads it. GATE 5 chose bare-UUID over an
    # FK because the ``ON DELETE SET NULL`` branch is dead: nothing in the
    # codebase deletes a ``Subscription`` (cancellation is a status transition;
    # departed staff are ``is_active=false``), so the FK would buy only
    # write-time integrity for a column no hot path touches.
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("provider", "event_id", name="uq_webhook_provider_event"),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 6: Announcements
# ═══════════════════════════════════════════════════════════════════════════════

class AnnouncementStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    PUBLISHED = "published"
    REJECTED = "rejected"
    ARCHIVED = "archived"


class Announcement(Base):
    """A dated notice shown in the app's Announcements section.

    Visibility is computed at query time from status + publish_at + expires_at
    rather than by a background job flipping rows. One less moving part, and an
    announcement scheduled for 9am simply appears at 9am without a worker
    having to be alive at that moment.
    """

    __tablename__ = "announcements"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    # Short subtitle for list cards.
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Full rich-text/markdown content for the detail view.
    body: Mapped[str] = mapped_column(Text, nullable=False)
    image_key: Mapped[str | None] = mapped_column(String(512), nullable=True)

    status: Mapped[AnnouncementStatus] = mapped_column(
        Enum(AnnouncementStatus, name="announcement_status", native_enum=False, length=20),
        default=AnnouncementStatus.DRAFT,
        nullable=False,
        index=True,
    )
    # Pinned items sort to the top regardless of date.
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # When it becomes visible. Null = as soon as it is published.
    publish_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    # When it stops being visible. Null = never expires.
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        # The public list (`announcement_service.list_visible`) filters on
        # all three of these every request — restores a declaration that was
        # silently dropped from this class after the index itself was created
        # (`c2d3e4f5a6b7_add_announcements.py`); the index was never removed
        # from the database, only from the ORM's view of it.
        Index("ix_announcements_visible", "status", "publish_at", "expires_at"),
    )


class AnnouncementApprovalLog(Base):
    """Append-only audit trail of every announcement status transition.

    Mirrors ApprovalLog for sermons: who changed what, when, and why. Nothing
    is ever updated or deleted, so a rejection note survives for the editor to
    read after the fact.
    """

    __tablename__ = "announcement_approval_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    announcement_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("announcements.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    from_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_status: Mapped[str] = mapped_column(String(20), nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
            DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
        )


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 7: Analytics — playback tracking
# ═══════════════════════════════════════════════════════════════════════════════

class PlaybackSession(Base):
    """One row per user per sermon, updated as they watch.

    Deliberately not an append-only event log: this app needs "where did I get
    to" and "how many people finished this", both of which are cheap from a
    single upserted row and expensive from a stream of events. A full event
    pipeline can be added later if the questions get richer.
    """

    __tablename__ = "playback_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sermon_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sermons.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Furthest point reached, in seconds. Resume uses this.
    position_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Total watched, which can exceed duration on rewatches.
    watched_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    play_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    first_played_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_played_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("user_id", "sermon_id", name="uq_playback_user_sermon"),
        # `continue_watching` and `history` (analytics_service.py) both filter
        # on `user_id` and order by `last_played_at` — restores a declaration
        # silently dropped from this class after the index itself was created
        # (`d3e4f5a6b7c8_add_search_and_analytics.py`); the index was never
        # removed from the database, only from the ORM's view of it.
        Index("ix_playback_recent", "user_id", "last_played_at"),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Usage rollups (plan-admin-settings §A.4.1) — forward-only daily aggregates
# written by `record_progress` (ADMIN-SETTINGS S4), read by the admin reports
# API. Not an event log and not derived from `PlaybackSession` history: both
# tables have a genuine composite primary key (the first in this codebase —
# every other table so far uses a surrogate UUID `id` plus a UniqueConstraint
# for its natural key), because the whole point is an upsert keyed on that
# natural key, not a surrogate row per ping. See §A.2 for why no backfill is
# possible: `PlaybackSession` keeps one cumulative row per (user, sermon),
# with no history to rebuild a per-day series from.
# ═══════════════════════════════════════════════════════════════════════════════


class SermonPlayDaily(Base):
    """One row per (day, sermon), incremented in the same transaction as the
    `PlaybackSession` upsert. `sermon_id` is `ON DELETE CASCADE`, matching
    `PlaybackSession.sermon_id` (L718-723 above): a hard-deleted sermon takes
    its past counts with it.
    """

    __tablename__ = "sermon_play_daily"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    sermon_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sermons.id", ondelete="CASCADE"),
        primary_key=True,
    )
    plays: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    watched_seconds: Mapped[int] = mapped_column(
        BigInteger, default=0, nullable=False
    )


class ListenerDay(Base):
    """One row per (day, user) that user was active on — lets reports count
    distinct listeners per period from `COUNT(DISTINCT user_id)` over this
    table instead of summing per-bucket counts (a listener active on two days
    of one week must count once for that week, not twice). `user_id` is
    `ON DELETE CASCADE`, matching `PlaybackSession.user_id` (L712-717 above).
    Indexed on `user_id` alone, beyond the composite PK, so that cascade
    doesn't have to scan the whole table to find a deleted user's rows.
    """

    __tablename__ = "listener_day"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )


# ═══════════════════════════════════════════════════════════════════════════════
# System audit log (plan-admin-settings §A.3/§A.4.2)
# ═══════════════════════════════════════════════════════════════════════════════


class AuditAction(str, enum.Enum):
    """Bounded v1 event catalog (`plan-admin-settings.md` §A.3). Stored as
    varchar via `native_enum=False`/`values_callable` (D8), matching
    `ModerationAction` above — never a native Postgres enum (the receipt for
    why is migration `f3a9c7d2b4e1`). This step only defines the values and
    the table; call sites land in S7 (staff mutations), S8 (auth), S12
    (settings) and S13 (report export)."""

    LOGIN = "auth.login"
    LOGIN_FAILED = "auth.login_failed"
    LOGOUT = "auth.logout"
    PASSWORD_CHANGED = "auth.password_changed"
    PASSWORD_RESET = "auth.password_reset"
    STAFF_INVITED = "user.staff_invited"
    INVITE_RESENT = "user.invite_resent"
    ROLE_CHANGED = "user.role_changed"
    DEACTIVATED = "user.deactivated"
    REACTIVATED = "user.reactivated"
    SETTINGS_UPDATED = "settings.updated"
    REPORT_EXPORTED = "report.exported"


class AuditOutcome(str, enum.Enum):
    SUCCESS = "success"
    FAILURE = "failure"


class _InetAsString(TypeDecorator):
    """`postgresql.INET`, normalised back to a plain `str` on read.

    psycopg 3 (this app's Postgres driver) adapts a raw `inet` column to
    `ipaddress.IPv4Address`/`IPv6Address` by default — proven against a real
    Postgres container while building this column (S6). Left alone, that
    makes `AuditLog.ip`'s Python-side type differ by dialect (SQLite, with
    no such adapter, hands back a plain `str`), which would silently bite
    whatever reads this column later (S10's `AuditEntry` DTO, JSON
    serialization, equality checks). Binding takes a plain `str` straight
    through on every dialect, same as before; only the read side is
    overridden.
    """

    impl = String(45)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(INET())
        return dialect.type_descriptor(String(45))

    def process_result_value(self, value, dialect):
        return str(value) if value is not None else None


class AuditLog(Base):
    """Append-only system audit trail (§A.4.2). Deliberately **FK-free** on
    `actor_id` — unlike `ApprovalLog`/`AnnouncementApprovalLog` (actor FK
    RESTRICT) or `CommentModerationLog` (actor FK SET NULL) — because the
    snapshot columns (`actor_email`, `actor_role`) already carry what a join
    would otherwise provide, and a hard account erasure must not be blocked
    by, or silently null out, its own audit trail. `id` is a UUID (not a
    surrogate serial) so this table can be `UNION ALL`-ed with those three
    existing UUID-keyed domain logs by the read-time audit feed (S10, D9).
    `record()`/`record_detached()` in `app/services/audit_service.py` are
    the only writers; nothing else should construct this row directly.
    """

    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    action: Mapped[AuditAction] = mapped_column(
        Enum(
            AuditAction,
            name="audit_action",
            native_enum=False,
            length=40,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
    )
    outcome: Mapped[AuditOutcome] = mapped_column(
        Enum(
            AuditOutcome,
            name="audit_outcome",
            native_enum=False,
            length=10,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
    )
    # No FK — see class docstring. These three are the snapshot that survives
    # the actor's account being erased.
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    actor_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    actor_role: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Generic target reference (e.g. "user", "church_settings"); no FK, since
    # the referent type varies per action and some targets (church_settings)
    # aren't even user/sermon rows.
    target_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    target_label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Postgres-only INET; every other dialect (SQLite, in the test suite)
    # falls back to a plain varchar(45) — long enough for the longest IPv6
    # literal. First Postgres-only column type in this codebase (§A.4
    # preamble): `_InetAsString` (above) is the dialect-variant precedent
    # S11 (`church_settings`) follows for `jsonb` below and its own text
    # columns — plain `with_variant(INET, "postgresql")` would work for the
    # DDL alone, but leaves psycopg 3 handing back `ipaddress.IPv4Address`/
    # `IPv6Address` instead of `str` on Postgres only; see that class.
    ip: Mapped[str | None] = mapped_column(_InetAsString(), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Postgres-only JSONB; SQLite stores the same contract as a plain JSON
    # (TEXT-backed) column — queryable shape differs, but round-trips exactly.
    details: Mapped[dict] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        nullable=False,
        default=dict,
        server_default=text("'{}'"),
    )

    __table_args__ = (
        CheckConstraint(
            "action IN ("
            "'auth.login', 'auth.login_failed', 'auth.logout', "
            "'auth.password_changed', 'auth.password_reset', "
            "'user.staff_invited', 'user.invite_resent', 'user.role_changed', "
            "'user.deactivated', 'user.reactivated', "
            "'settings.updated', 'report.exported')",
            name="ck_audit_log_action",
        ),
        CheckConstraint(
            "outcome IN ('success', 'failure')",
            name="ck_audit_log_outcome",
        ),
        # (created_at DESC, id) — §A.4.2's own ordering, so the feed's
        # `ORDER BY created_at DESC, id` pagination (S10) is index-covered
        # on its leading, selective column without needing a backward scan.
        Index("ix_audit_log_created_at_id", created_at.desc(), id),
        Index("ix_audit_log_actor_id_created_at", "actor_id", "created_at"),
        Index("ix_audit_log_action_created_at", "action", "created_at"),
    )


class ChurchSettings(Base):
    """The church profile and the app content it drives (plan-admin-settings
    §A.4.3, D2/D2a/D3). Exactly one row: `id` is pinned to 1 by a CHECK, so
    the table is a typed singleton, not a key/value store. Seeded by its
    migration; never inserted at runtime.

    `version` is the optimistic-concurrency token: `PATCH /admin/settings`
    (S12) writes `... WHERE version = :v` and bumps it, so a stale editor
    gets a 409 instead of silently overwriting. `updated_by_id` has no FK,
    like `audit_log.actor_id`: erasing an account must not touch or be
    blocked by this row. Legal documents are hosted elsewhere and stored as
    URLs only (D2/D2a); `comment_guidelines` is inline text because viewers
    accept it in-app before their first comment.
    """

    __tablename__ = "church_settings"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, default=1)
    church_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    app_display_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tagline: Mapped[str | None] = mapped_column(String(200), nullable=True)
    about: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact_email: Mapped[str] = mapped_column(String(320), nullable=False)
    contact_phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    website_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    comment_guidelines: Mapped[str] = mapped_column(Text, nullable=False)
    terms_of_use_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    privacy_policy_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    copyright_notice: Mapped[str | None] = mapped_column(String(300), nullable=True)
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=1, server_default=text("1")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )

    __table_args__ = (
        CheckConstraint("id = 1", name="ck_church_settings_singleton"),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Sermon comments (plan-sermon-comments §A.3)
# ═══════════════════════════════════════════════════════════════════════════════


class CommentStatus(str, enum.Enum):
    VISIBLE = "VISIBLE"
    HIDDEN = "HIDDEN"


class CommentReportReason(str, enum.Enum):
    SPAM = "spam"
    HARASSMENT = "harassment"
    HATE = "hate"
    SEXUAL = "sexual"
    SELF_HARM = "self_harm"
    OTHER = "other"


class ModerationAction(str, enum.Enum):
    HIDE = "hide"
    RESTORE = "restore"
    HARD_DELETE = "hard_delete"
    SELF_DELETE = "self_delete"
    AUTO_HIDE = "auto_hide"
    DISMISS_REPORTS = "dismiss_reports"


class SermonComment(Base):
    __tablename__ = "sermon_comments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    sermon_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sermons.id", ondelete="CASCADE"), nullable=False
    )
    # CASCADE: erasing a user erases their comments.
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[CommentStatus] = mapped_column(
        Enum(CommentStatus, name="comment_status", native_enum=False, length=20),
        default=CommentStatus.VISIBLE,
        server_default=CommentStatus.VISIBLE.value,
        nullable=False,
    )
    hidden_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    hidden_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    hidden_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # True when the hide came from the report-threshold auto-hide (A.5), not a
    # moderator. Lets the admin queue surface wrongful auto-hides first.
    hidden_auto: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"), nullable=False
    )
    # Maintained in the same transaction as the report insert.
    report_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        # char_length() is Postgres-only; the legacy SQLite suite builds the
        # schema with create_all, so emit this CHECK on Postgres only. The
        # migration (the production path) always creates it.
        CheckConstraint(
            "char_length(body) BETWEEN 1 AND 1000", name="ck_sermon_comments_body_len"
        ).ddl_if(dialect="postgresql"),
        CheckConstraint(
            "status IN ('VISIBLE', 'HIDDEN')", name="ck_sermon_comments_status"
        ),
        Index(
            "ix_sermon_comments_sermon_status_created",
            "sermon_id", "status", text("created_at DESC"), "id",
        ),
        Index("ix_sermon_comments_user_created", "user_id", "created_at"),
        Index(
            "ix_sermon_comments_reported",
            "report_count",
            postgresql_where=text("report_count > 0"),
        ),
        Index("ix_sermon_comments_status_created", "status", "created_at"),
    )


class SermonCommentReport(Base):
    __tablename__ = "sermon_comment_reports"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    comment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sermon_comments.id", ondelete="CASCADE"),
        nullable=False,
    )
    reporter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    reason: Mapped[CommentReportReason] = mapped_column(
        Enum(
            CommentReportReason,
            name="comment_report_reason",
            native_enum=False,
            length=20,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
    )
    detail: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("comment_id", "reporter_id", name="uq_comment_report_reporter"),
        CheckConstraint(
            "reason IN ('spam', 'harassment', 'hate', 'sexual', 'self_harm', 'other')",
            name="ck_sermon_comment_reports_reason",
        ),
    )


class CommentModerationLog(Base):
    """Append-only moderation trail. Deliberately FK-free on comment/sermon/author
    so it survives hard delete of the comment, the sermon, or the author."""

    __tablename__ = "comment_moderation_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    comment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    # NULL for auto_hide, and after the actor's account is erased.
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[ModerationAction] = mapped_column(
        Enum(
            ModerationAction,
            name="comment_moderation_action",
            native_enum=False,
            length=20,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    sermon_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    body_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Reports cleared by a dismiss_reports action; NULL for every other action.
    cleared_report_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            "action IN ('hide', 'restore', 'hard_delete', 'self_delete', 'auto_hide', 'dismiss_reports')",
            name="ck_comment_moderation_log_action",
        ),
        CheckConstraint(
            "action NOT IN ('hide', 'hard_delete', 'dismiss_reports') OR reason IS NOT NULL",
            name="ck_comment_moderation_log_reason_required",
        ),
        CheckConstraint(
            "(action = 'dismiss_reports' AND cleared_report_count IS NOT NULL"
            " AND cleared_report_count > 0)"
            " OR (action <> 'dismiss_reports' AND cleared_report_count IS NULL)",
            name="ck_comment_moderation_log_cleared_count",
        ),
        CheckConstraint(
            "body_snapshot IS NULL OR action = 'hard_delete'",
            name="ck_comment_moderation_log_snapshot_hard_delete",
        ),
    )


class UserBlock(Base):
    """Viewer-level block. Surrogate ``id`` (plan P2) so the API can unblock and
    list without exposing user ids."""

    __tablename__ = "user_blocks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    blocker_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    blocked_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("blocker_id", "blocked_id", name="uq_user_blocks_pair"),
        CheckConstraint("blocker_id <> blocked_id", name="ck_user_blocks_no_self"),
    )


class SermonLike(Base):
    """A viewer's like on a sermon (Isaac's ask, session 2026-10-09: "the like
    button" needs a real counter and backend). Surrogate ``id`` for the same
    reason `UserBlock` has one — no API ever needs to address a row by its own
    id, but every other table in this codebase gets a real primary key rather
    than a composite one. One row per (user, sermon); liking twice is a no-op
    at the service layer (`likes_service.like_sermon`'s own `ON CONFLICT DO
    NOTHING`), not a 409 — the client's own idempotent PUT semantics."""

    __tablename__ = "sermon_likes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    sermon_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sermons.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("user_id", "sermon_id", name="uq_sermon_likes_pair"),
        Index("ix_sermon_likes_sermon_id", "sermon_id"),
    )


class SeriesLike(Base):
    """A viewer's like on a series — the series-page sibling of `SermonLike`,
    same shape and the same reasoning throughout."""

    __tablename__ = "series_likes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    series_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("series.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("user_id", "series_id", name="uq_series_likes_pair"),
        Index("ix_series_likes_series_id", "series_id"),
    )


class Playlist(Base):
    """A viewer-owned playlist (Isaac's ask, session 2026-10-10: a "Library"
    tab for creating playlists, Spotify's own flow as the reference). Deleting
    the owning user CASCADEs — a playlist has no meaning without its owner, no
    sharing/collaboration surface exists in this app."""

    __tablename__ = "playlists"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"), nullable=False)
    cover_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    items: Mapped[list["PlaylistItem"]] = relationship(
        "PlaylistItem",
        back_populates="playlist",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="PlaylistItem.position",
    )


class PlaylistItem(Base):
    """One sermon (or series episode — episodes ARE sermons, see
    `Sermon.series_id`) in a playlist, at a given `position`. No unique
    constraint on `(playlist_id, sermon_id)` — Spotify allows the same track
    twice in one playlist, and so does this. Deleting the sermon CASCADEs:
    a playlist entry has no meaning once its content is gone."""

    __tablename__ = "playlist_items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    playlist_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("playlists.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sermon_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sermons.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    playlist: Mapped["Playlist"] = relationship("Playlist", back_populates="items")

    __table_args__ = (
        Index("ix_playlist_items_playlist_id_position", "playlist_id", "position"),
    )


# Precomputed, not called inline inside `Verse` — the `text` *column* below would
# otherwise shadow the module-level `text()` SQL-literal function for the rest of that
# class body (a real bug, caught by the SQLite test suite: "'MappedColumn' object is
# not callable" on the line after `text` is declared).
_VERSE_TRANSLATION_DEFAULT = text("'kjv'")
_VERSE_ACTIVE_DEFAULT = text("true")


class Verse(Base):
    """A scripture verse in Home's "verse of the day" rotation (mobile `VerseStrip`).

    No editorial workflow, unlike `Announcement` — plain admin-managed rows, picked at
    read time by a daily-seeded shuffle (`verse_service.get_verse_of_the_day`), not a
    per-row publish schedule. `text` is sourced from bible-api.com (KJV, public domain)
    by the operational script `app.scripts.seed_verses`, not typed by hand.
    """

    __tablename__ = "verses"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    reference: Mapped[str] = mapped_column(String(100), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    translation: Mapped[str] = mapped_column(
        String(20), nullable=False, default="kjv", server_default=_VERSE_TRANSLATION_DEFAULT
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default=_VERSE_ACTIVE_DEFAULT
    )
    # Nullable, unlike every other content model's created_by — most rows here come
    # from the operational seed script, not a staff member in the admin portal, so
    # there is often no real human creator to attribute.
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
