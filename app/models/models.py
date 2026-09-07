import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from sqlalchemy import ForeignKey, Integer, Text  # noqa: E402
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


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(
        String(320), unique=True, index=True, nullable=False
    )
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", native_enum=False, length=20),
        default=UserRole.VIEWER,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
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

    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
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
    # Provider identifiers (Stripe customer/subscription). Null until they pay.
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
    )
