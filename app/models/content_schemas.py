import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.models import ContentTier, MediaType, SermonStatus
from app.models.models import MediaType as _MediaType  # noqa: E402
from app.models.models import UploadStatus as _UploadStatus  # noqa: E402

# ── Categories ────────────────────────────────────────────────────────────────
class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=1, max_length=140, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    slug: str | None = Field(
        default=None, min_length=1, max_length=140,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
    )


class CategoryPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str


# ── Speakers ──────────────────────────────────────────────────────────────────
class SpeakerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    bio: str | None = None


class SpeakerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    bio: str | None = None


class SpeakerPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    bio: str | None


# ── Series ────────────────────────────────────────────────────────────────────
class SeriesCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    category_id: uuid.UUID | None = None
    tier: ContentTier = ContentTier.FREE


class SeriesUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    category_id: uuid.UUID | None = None
    tier: ContentTier | None = None


class SeriesPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None
    category_id: uuid.UUID | None
    tier: ContentTier
    status: SermonStatus
    thumbnail_url: str | None = None


# ── Sermons ───────────────────────────────────────────────────────────────────
class SermonCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    speaker_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    series_id: uuid.UUID | None = None
    episode_number: int | None = Field(
        default=None, ge=0,
        description=(
            "Leave unset and the next number in the series is assigned "
            "automatically. Set it explicitly only when reordering."
        ),
    )
    tier: ContentTier | None = None  # None = inherit from series / free
    tags: list[str] = Field(default_factory=list, max_length=30)


class SermonUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    speaker_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    series_id: uuid.UUID | None = None
    episode_number: int | None = Field(default=None, ge=0)
    tier: ContentTier | None = None
    tags: list[str] | None = Field(default=None, max_length=30)


class MediaRefPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: MediaType
    quality: str | None
    s3_key: str
    hls_manifest_key: str | None


class SermonListItem(BaseModel):
    """Catalog card. `locked` is computed per-user, not derived from tier alone.

    Speaker/category/series names are denormalised onto the card so a list view
    renders in one request instead of N lookups per row.
    """

    id: uuid.UUID
    title: str
    description: str | None
    thumbnail_url: str | None
    duration_seconds: int | None
    speaker_id: uuid.UUID | None
    speaker_name: str | None = None
    category_id: uuid.UUID | None
    category_name: str | None = None
    series_id: uuid.UUID | None
    series_title: str | None = None
    episode_number: int | None
    tier: ContentTier
    locked: bool


class SermonAdminListItem(SermonListItem):
    """Staff-facing card. Carries the workflow fields a CMS table needs, which
    the public card deliberately omits (created_by would leak staff identity)."""

    status: SermonStatus
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime | None


class SermonDetail(SermonListItem):
    status: SermonStatus
    tags: list[str]
    media_refs: list[MediaRefPublic]
    published_at: datetime | None
    created_at: datetime
    # The editor screen's "saved N min ago" stamp needs a server-side baseline
    # on first load, before any client-side autosave has run.
    updated_at: datetime | None = None


# ── Approval workflow ─────────────────────────────────────────────────────────
class RejectRequest(BaseModel):
    note: str | None = None


class ApprovalLogItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    from_status: str | None
    to_status: str
    actor_id: uuid.UUID
    note: str | None
    created_at: datetime


class StatusResponse(BaseModel):
    id: uuid.UUID
    status: SermonStatus




class UploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=3, max_length=120)
    media_type: _MediaType = _MediaType.VIDEO
    size_bytes: int | None = Field(default=None, ge=1)


class UploadTicket(BaseModel):
    """Everything the client needs to PUT the file straight to object storage."""

    job_id: uuid.UUID
    upload_url: str
    method: str = "PUT"
    headers: dict[str, str] = Field(default_factory=dict)
    expires_in: int
    raw_key: str


class UploadConfirm(BaseModel):
    """Sent when the client finishes its PUT.

    The browser can read duration from the file before uploading, which is the
    only practical source for it while transcoding is passthrough — nothing
    server-side opens the media.
    """

    duration_seconds: int | None = Field(default=None, ge=1, le=86400)


class UploadJobPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    sermon_id: uuid.UUID
    media_type: _MediaType
    status: _UploadStatus
    # Carried so a page reloaded mid-upload can still identify the row: the
    # UploadJob response is otherwise the only thing tying a job id to its file.
    original_filename: str | None = None
    content_type: str | None = None
    size_bytes: int | None = None
    error_message: str | None
    created_at: datetime


class StreamVariant(BaseModel):
    type: _MediaType
    quality: str | None
    url: str


class StreamResponse(BaseModel):
    sermon_id: uuid.UUID
    expires_in: int
    variants: list[StreamVariant]


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 5: Subscriptions
# ═══════════════════════════════════════════════════════════════════════════════
from app.models.models import SubscriptionStatus as _SubStatus  # noqa: E402
from app.models.models import SubscriptionTier as _SubTier  # noqa: E402


class CheckoutRequest(BaseModel):
    tier: _SubTier = _SubTier.MONTHLY

    @field_validator("tier")
    @classmethod
    def must_be_paid(cls, v: _SubTier) -> _SubTier:
        if v == _SubTier.FREE:
            raise ValueError("Choose a paid tier to start a checkout")
        return v


class CheckoutResponse(BaseModel):
    checkout_url: str
    session_id: str


class PortalResponse(BaseModel):
    portal_url: str


class SubscriptionPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tier: _SubTier
    status: _SubStatus
    valid_until: datetime | None
    cancel_at_period_end: bool
    # Convenience for clients: the single question the UI actually asks.
    is_entitled: bool


# ═══════════════════════════════════════════════════════════════════════════════
# Thumbnails
# ═══════════════════════════════════════════════════════════════════════════════
class ThumbnailUploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=3, max_length=120)


class ThumbnailTicket(BaseModel):
    """Pre-signed PUT for a cover image, same direct-to-storage pattern as media."""

    upload_url: str
    method: str = "PUT"
    headers: dict[str, str] = Field(default_factory=dict)
    expires_in: int
    thumbnail_key: str


class ThumbnailResponse(BaseModel):
    thumbnail_url: str | None


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 6: Announcements
# ═══════════════════════════════════════════════════════════════════════════════
from app.models.models import AnnouncementStatus as _AnnStatus  # noqa: E402


class AnnouncementCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=500)
    body: str = Field(min_length=1)
    pinned: bool = False
    publish_at: datetime | None = None
    expires_at: datetime | None = None

    @field_validator("expires_at")
    @classmethod
    def expiry_after_publish(cls, v, info):
        publish_at = info.data.get("publish_at")
        if v and publish_at and v <= publish_at:
            raise ValueError("expires_at must be after publish_at")
        return v


class AnnouncementUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=500)
    body: str | None = Field(default=None, min_length=1)
    pinned: bool | None = None
    publish_at: datetime | None = None
    expires_at: datetime | None = None


class AnnouncementListItem(BaseModel):
    """Card shape for the announcements list."""

    id: uuid.UUID
    title: str
    description: str | None
    image_url: str | None
    pinned: bool
    publish_at: datetime | None
    created_at: datetime


class AnnouncementDetail(AnnouncementListItem):
    body: str
    expires_at: datetime | None


class AnnouncementAdminItem(AnnouncementDetail):
    """Staff view — adds the fields viewers never see."""

    status: _AnnStatus
    is_visible: bool
    created_by: uuid.UUID


class AnnouncementStatusResponse(BaseModel):
    id: uuid.UUID
    status: _AnnStatus


class AnnouncementRejectRequest(BaseModel):
    note: str | None = None


class AnnouncementApprovalLogItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    from_status: str | None
    to_status: str
    actor_id: uuid.UUID
    note: str | None
    created_at: datetime


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 7: Search & analytics
# ═══════════════════════════════════════════════════════════════════════════════
class SearchResults(BaseModel):
    query: str
    total: int
    limit: int
    offset: int
    results: list[SermonListItem]


class ProgressUpdate(BaseModel):
    position_seconds: int = Field(ge=0)
    # Seconds watched since the last ping. The client sends the delta so the
    # server can total watch time without trusting a cumulative figure.
    watched_delta: int = Field(default=0, ge=0, le=3600)
    completed: bool | None = None


class ProgressPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sermon_id: uuid.UUID
    position_seconds: int
    watched_seconds: int
    completed: bool
    play_count: int
    last_played_at: datetime


class ContinueWatchingItem(SermonListItem):
    position_seconds: int
    percent_complete: int | None
    last_played_at: datetime


class TopSermonStat(BaseModel):
    sermon_id: uuid.UUID
    title: str
    plays: int
    unique_viewers: int
    completions: int
    completion_rate: float


class OverviewStats(BaseModel):
    total_users: int
    active_subscribers: int
    published_sermons: int
    total_plays: int
    unique_viewers: int
    completions: int
    completion_rate: float
    plays_last_7_days: int


# ═══════════════════════════════════════════════════════════════════════════════
# Pagination
# ═══════════════════════════════════════════════════════════════════════════════
from typing import Generic, TypeVar  # noqa: E402

_T = TypeVar("_T")


class Page(BaseModel, Generic[_T]):
    """Standard list envelope. `total` is the count before limit/offset, so a
    client can render 'showing 20 of 340' and size its pager correctly."""

    items: list[_T]
    total: int
    limit: int
    offset: int
