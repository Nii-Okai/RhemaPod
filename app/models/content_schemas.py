import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.models import ContentTier, MediaType, SermonStatus
from app.models.models import MediaType as _MediaType  # noqa: E402
from app.models.models import UploadStatus as _UploadStatus  # noqa: E402

# Largest page any list endpoint will serve. Lives here (models layer) so both
# the service `.limit()` clamps and the request schemas that must not accept
# more ids than a client could ever paginate can share one definition without a
# service -> schema import cycle.
MAX_PAGE_SIZE = 100

# ── Categories ────────────────────────────────────────────────────────────────
def _clean_category_name(v: str) -> str:
    """Normalise a category name written by an editor/manager.

    `category_name` is echoed on the *unauthenticated* `list_series` /
    `get_series` responses (and the sermon catalog DTOs), and editors may now
    write it, so the raw string is sanitised at the edge:

    * strip leading/trailing whitespace, collapse internal whitespace runs to a
      single space;
    * reject (ValueError -> 422) any C0/C1 control character, DEL, or the angle
      brackets `<` / `>`.

    `slug` needs no equivalent — its `Field` pattern already server-side
    constrains it to `[a-z0-9-]`.
    """
    cleaned = " ".join(v.split())
    if not cleaned:
        raise ValueError("A category name is required")
    if any(
        ord(c) < 0x20 or 0x7F <= ord(c) <= 0x9F or c in "<>"
        for c in cleaned
    ):
        raise ValueError("Category name must not contain control characters or < >")
    return cleaned


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=1, max_length=140, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

    @field_validator("name")
    @classmethod
    def clean_name(cls, v: str) -> str:
        return _clean_category_name(v)


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    slug: str | None = Field(
        default=None, min_length=1, max_length=140,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
    )

    @field_validator("name")
    @classmethod
    def clean_name(cls, v: str | None) -> str | None:
        return v if v is None else _clean_category_name(v)


class CategoryPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    # Number of sermons attached to this category. Computed in the list/detail
    # query (a correlated count subquery), so the portal's category pills no
    # longer need an N+1 `limit=1` `total` probe per row.
    sermon_count: int


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
    # Number of sermons attached to this speaker. Computed in the list/detail
    # query (a correlated count subquery) — replaces the portal's per-row probe.
    sermon_count: int


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
    # Minimal series publish: manager/admin only, and only draft <-> published.
    # Deliberately lighter than the sermon/announcement review workflow — a
    # series is not a review artifact (Isaac's call). Reuses the sermon_status
    # enum, which is what the `series.status` column stores.
    status: SermonStatus | None = None


class SeriesPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str | None
    category_id: uuid.UUID | None
    tier: ContentTier
    status: SermonStatus
    thumbnail_url: str | None = None
    # Number of episodes (sermons) in this series, and the resolved category
    # name (null when uncategorised). Both computed in the list/detail query so
    # the portal's series grid drops its per-card count + category-join probes.
    episode_count: int
    category_name: str | None


class EpisodeOrderRequest(BaseModel):
    """Full ordered list of a series' episode (sermon) ids for a bulk reorder.

    Ceiling: ``MAX_PAGE_SIZE`` ids. The drag client assembles this list from
    ``GET /sermons?series_id=``, which is itself capped at ``MAX_PAGE_SIZE`` per
    page, and this endpoint requires the *complete* ordered set — so a series
    with more episodes than that cannot be reordered through the portal at all.
    Reordering a >``MAX_PAGE_SIZE``-episode series is out of scope for this
    batch; the cap makes that limit an explicit 422 rather than a silent
    partial write.
    """

    episode_ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_PAGE_SIZE)


class EpisodeOrderItem(BaseModel):
    """One row of the reordered episode list — the minimum the client needs to
    apply the new order locally."""

    id: uuid.UUID
    episode_number: int


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
    # When it becomes publicly visible once published. Settable while the
    # sermon is still editable (draft/rejected), same as
    # AnnouncementCreate.publish_at. None = visible as soon as it is
    # published. Mirrors the announcement field exactly; no "must be in the
    # future" check — AnnouncementCreate doesn't enforce one either.
    publish_at: datetime | None = None


class SermonUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    speaker_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    series_id: uuid.UUID | None = None
    episode_number: int | None = Field(default=None, ge=0)
    tier: ContentTier | None = None
    tags: list[str] | None = Field(default=None, max_length=30)
    publish_at: datetime | None = None


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
    # When it becomes visible once published — None means "as soon as it is
    # published". Mirrors AnnouncementListItem.publish_at, which is public for
    # the same reason: this DTO is only ever returned for a sermon that has
    # already cleared sermon_visibility_clause, so a returned publish_at is
    # always already in the past (or unset) — nothing premature leaks.
    publish_at: datetime | None = None


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


class SermonAdminDetail(SermonDetail):
    """Staff-facing detail. Mirrors the `SermonAdminListItem` split: the editor
    screen's "saved N min ago" stamp needs a server-side `updated_at` baseline,
    which the public `SermonDetail` (anonymous `/catalog/sermons/{id}`) must
    not carry.

    `tier` keeps the inherited meaning — the *resolved* effective tier (sermon
    tier, else series tier, else free), same as `SermonDetail`. The editor
    screen also needs the raw column to drive the tier radio, so that is a
    separate field: `tier_override` is `Sermon.tier` verbatim — NULL when the
    sermon inherits from its series (or the free default), otherwise the
    explicit choice. Reassigning `tier`'s meaning in a subclass was an LSP trap
    that the Series/Announcements editors would have cloned.
    """

    # Raw `Sermon.tier` column: None = inherit from series / free default.
    tier_override: ContentTier | None = None
    updated_at: datetime | None


# ── Approval workflow ─────────────────────────────────────────────────────────
class RejectRequest(BaseModel):
    # A rejection MUST carry a reason — it's the only place the editor learns
    # what to fix. Required, and non-empty after stripping surrounding
    # whitespace; the stored note is the trimmed value. `ApprovalLog.note` is an
    # unbounded Text column, so the 2000-char cap is a sanity bound, not a
    # schema constraint.
    note: str = Field(min_length=1, max_length=2000)

    @field_validator("note")
    @classmethod
    def not_blank(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("A rejection note is required")
        return stripped


class ApprovalLogItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    from_status: str | None
    to_status: str
    actor_id: uuid.UUID
    # Display name of the actor: users.full_name when set, else None (the
    # client renders "a reviewer" / "—"). Deliberately NOT the email
    # local-part — that leaked an inferred corporate address to an editor
    # reading their own sermon's log.
    actor_name: str | None = None
    note: str | None
    created_at: datetime


class StatusResponse(BaseModel):
    id: uuid.UUID
    status: SermonStatus


class PublishResponse(StatusResponse):
    """`publish` adds the number the success toast shows ("Published to the app
    · N subscribers")."""

    # Count of active paid subscriptions at publish time: `Subscription` rows
    # with a paid tier (monthly/annual) in an entitled status (active,
    # cancelled, past_due). A row whose paid period has lapsed but which the
    # `expire_lapsed` sweep has not yet demoted is still counted.
    notified_subscriber_count: int


class ReviewQueueItem(BaseModel):
    """One sermon awaiting review, carrying the timing and readiness fields the
    W10 queue screen needs: "waiting N days", the >48h alert, and whether any
    renditions exist to review yet. Ordered oldest-submitted-first by the queue
    endpoint (longest wait at the top)."""

    id: uuid.UUID
    title: str
    description: str | None
    duration_seconds: int | None
    speaker_id: uuid.UUID | None
    speaker_name: str | None = None
    category_id: uuid.UUID | None
    category_name: str | None = None
    series_id: uuid.UUID | None
    series_title: str | None = None
    # Sermon.thumbnail_key resolved to a fetchable URL (mirrors
    # SermonListItem.thumbnail_url / SermonAdminListItem.thumbnail_url). None
    # for an audio-only sermon or one with no thumbnail confirmed yet — the
    # queue card falls back to a placeholder client-side.
    thumbnail_url: str | None = None
    # Sermon.created_by verbatim (mirrors SermonAdminListItem.created_by /
    # AnnouncementAdminItem.created_by). Lets the client grey out
    # Start-review/Approve/Reject on a manager's own sermon — self-approval is
    # already blocked server-side (content_service.transition 403s it), but the
    # queue had no way to show that state proactively before a failed attempt.
    created_by: uuid.UUID
    # `series_id is None` already tells the client whether this is a standalone
    # sermon — the sibling list DTOs (SermonListItem / SermonAdminListItem)
    # carry no such bool, so neither does this one.
    # Sermon.episode_number verbatim (mirrors SermonListItem.episode_number).
    # None for a standalone or an unnumbered series sermon; drives the queue
    # card's "· ep N" chip.
    episode_number: int | None = None
    # Resolved effective tier: sermon tier, else series tier, else free.
    tier: ContentTier
    # pending_review, under_review, or approved (an approved sermon stays in the
    # queue until it is published — Batch 6 #12).
    status: SermonStatus
    # created_at of the most recent ApprovalLog row that moved this sermon to
    # pending_review — i.e. when the editor last submitted it. Drives the
    # "waiting N days" copy and the >48h alert, and is the queue's sort key.
    submitted_at: datetime | None
    # Number of MediaRef rows attached to the sermon (0 = nothing uploaded).
    renditions_ready: int
    # For under_review / approved items: the display name of the manager who
    # most recently claimed the sermon (ran start-review or took it over). Not
    # necessarily whoever ran `approve` — an admin or a peer manager may have.
    # None for pending_review.
    review_claimed_by: str | None = None
    # For under_review / approved items: the raw user id of that reviewer, so the
    # client can match it against the session user id instead of string-matching
    # `review_claimed_by` (namesakes, null names). None for pending_review.
    review_claimed_by_id: uuid.UUID | None = None




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


class SubscriptionAdminItem(BaseModel):
    """One row of the staff-facing subscriptions read (plan §A.3, §W20).

    A staff-readable enumeration of the paying membership: `Subscription`
    joined to `User` for `user_name` / `user_email`. Manager+ only, paginated.

    Deliberately carries **no** monetary field — no `amount`, `price`,
    `currency` or MRR (resolved decision 2). No amount is stored on
    `Subscription` and the webhook never parses one; there is nothing truthful
    to put here and Phase 2 shows no dollar figure anywhere in the portal.
    `current_period_end` is the model's `valid_until` column (null on free /
    fully-lapsed rows). `provider_customer_id` is null until the member's first
    payment lands via webhook — the frontend hides "Open in Stripe" when it is.
    """

    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str | None
    user_email: str
    tier: _SubTier
    status: _SubStatus
    current_period_end: datetime | None
    provider_customer_id: str | None
    created_at: datetime


class SubscriptionCounts(BaseModel):
    """The three aggregate tiles on the Subscriptions screen (plan §A.3).

    `active_paid` is `subscription_service.count_active_paid_subscribers` —
    the one definition already behind the analytics overview and the publish
    toast, not a second one written for this screen. `monthly` / `annual` split
    that same population (paid tier, `status IN (active, cancelled)`) by tier,
    so `active_paid == monthly + annual` holds by construction.
    """

    active_paid: int
    monthly: int
    annual: int


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
    # Same shape as ApprovalLogItem.actor_name (users.full_name when set, else
    # None — never the email local-part). The announcement editor isn't built
    # yet, but the field is cheap to fill and keeps the two approval-log DTOs
    # symmetric.
    actor_name: str | None = None
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


class NewListenersBucket(BaseModel):
    """One week in the "New listeners" series (plan §A.2, M1).

    `week_start` is the Monday (UTC) that opens the bucket; `count` is the
    number of distinct registered accounts whose *earliest* play across all
    sermons fell in that week. Reach, not engagement — the word "plays" does
    not belong on this series.
    """

    week_start: date
    count: int


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
