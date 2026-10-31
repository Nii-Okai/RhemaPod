import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.core.text_safety import normalise_text, raw_length_exceeded
from app.models.models import (
    CommentReportReason,
    CommentStatus,
    ContentTier,
    MediaType,
    SermonStatus,
)
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
    # Isaac's ask, session 2026-10-09: the series-page Like button needs a real
    # counter. Computed the same way episode_count is (a correlated subquery in
    # the read query, see `content_service._series_public_stmt`) — every series
    # read carries it, list and detail alike, same as episode_count/category_name
    # above; nothing about this field is detail-only. `liked_by_me` is `false`
    # for an anonymous viewer (no user to have liked anything).
    like_count: int = 0
    liked_by_me: bool = False


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
    is_prophets_catalog: bool = False
    # publish_at is intentionally NOT settable here. Only a manager/admin may
    # gate a sermon's public visibility, and only via the publish review
    # action (`PublishRequest` below) — never at creation, for any role. See
    # ADR / plan: sermon-schedule-publish-authz.


class SermonUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    speaker_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    series_id: uuid.UUID | None = None
    episode_number: int | None = Field(default=None, ge=0)
    tier: ContentTier | None = None
    tags: list[str] | None = Field(default=None, max_length=30)
    is_prophets_catalog: bool | None = None
    # publish_at is intentionally NOT editable here. Only a manager/admin may
    # gate a sermon's public visibility, and only via the publish review
    # action (`PublishRequest` below) — never through the general editor,
    # for any role. See ADR / plan: sermon-schedule-publish-authz.


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
    # Verbatim `Sermon.episode_number` on every route except the public
    # `GET /series/{id}/episodes` read, which renumbers this field to a
    # contiguous 1..N display sequence (content_service.renumber_for_display)
    # without touching the database column. Staff routes (`GET
    # /sermons?series_id=`) always carry the real, editor-owned number.
    episode_number: int | None
    tier: ContentTier
    locked: bool
    # When it becomes visible once published — None means "as soon as it is
    # published". Mirrors AnnouncementListItem.publish_at, which is public for
    # the same reason: this DTO is only ever returned for a sermon that has
    # already cleared sermon_visibility_clause, so a returned publish_at is
    # always already in the past (or unset) — nothing premature leaks.
    publish_at: datetime | None = None
    # Which rendition this sermon actually has (a sermon carries exactly one —
    # video or audio, never both — mobile download UI's own assumption). None
    # on every list endpoint except GET /series/{id}/episodes, the only caller
    # that passes `to_list_item` a value for it today (offline downloads need
    # to know the type per episode without a second request) — deliberately
    # not resolved for every other list endpoint's rows (that's an eager-load
    # per call site this field doesn't need yet).
    media_type: Literal["audio", "video"] | None = None


class UpcomingSermon(BaseModel):
    """The next scheduled sermon — PUBLISHED with a future `publish_at` — for Home's
    "next message" countdown. Deliberately thin: the title, its cover art (Nii's call,
    2026-10-21: the countdown shows the sermon's own art), when it goes live, and the
    names a card needs. No description or media, so nothing playable leaks ahead of
    the release."""

    id: uuid.UUID
    title: str
    publish_at: datetime
    thumbnail_url: str | None = None
    speaker_name: str | None = None
    series_title: str | None = None
    episode_number: int | None = None


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
    # Isaac's ask, session 2026-10-09: the sermon-page Like button needs a real
    # counter. Detail-only (unlike `SeriesPublic`'s own like fields, which also
    # cover list rows) — `SermonListItem` already splits list from detail, so
    # there's no shared-schema reason to compute this for every catalog row the
    # way series' own single list+detail schema does. `liked_by_me` is `false`
    # for an anonymous viewer.
    like_count: int = 0
    liked_by_me: bool = False


class LikeState(BaseModel):
    """Response for a like/unlike action — the caller's own `ActionButton`
    reflects both halves (the glyph from `liked`, the number from
    `like_count`) off one response, not a second round trip."""

    liked: bool
    like_count: int


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
    is_prophets_catalog: bool = False


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


class PublishRequest(BaseModel):
    # Optional schedule for the publish action, set by the reviewing
    # manager/admin. None (the default, and what an omitted/empty body
    # resolves to) means "publish now" — this fully replaces whatever
    # `publish_at` the row may already carry; there is no partial update or
    # reschedule/cancel here (out of scope for this round — see plan).
    publish_at: datetime | None = None


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
    # Display name of `created_by`, resolved the same way `review_claimed_by`
    # is (batch User lookup) — shown on the queue card so a reviewer can see
    # who submitted the sermon without following a link. None if the author's
    # full_name is blank (display_name's existing fallback).
    created_by_name: str | None = None
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


class AudioDownloadResponse(BaseModel):
    """GET .../download/audio (W1.6) — a short-lived signed URL for the
    audio rendition only, for offline download. Deliberately minimal: no
    `type`/`variants` list like StreamResponse, since this endpoint can only
    ever answer with audio (L6, locked — never a video path)."""

    sermon_id: uuid.UUID
    url: str
    expires_in: int


class VideoDownloadResponse(BaseModel):
    """GET .../download/video — a short-lived signed URL for the video
    rendition only, for offline download (L6's "audio-only, ever" revisited:
    Isaac's ask, session 2026-10-08 — video downloads now ship, with weaker
    at-rest protection than audio's own JS-level encryption gets; see
    `media_service.get_video_download`'s own docstring). Same minimal shape
    as `AudioDownloadResponse` deliberately — each sermon carries exactly one
    rendition, never both, so no caller ever needs the two responses to
    disagree in shape."""

    sermon_id: uuid.UUID
    url: str
    expires_in: int


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 5: Subscriptions
# ═══════════════════════════════════════════════════════════════════════════════
from app.models.models import SubscriptionStatus as _SubStatus  # noqa: E402
from app.models.models import SubscriptionTier as _SubTier  # noqa: E402


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
    `Subscription`; there is nothing truthful to put here and Phase 2 shows no
    dollar figure anywhere in the portal. `current_period_end` is the model's
    `valid_until` column (null on free / fully-lapsed rows).
    `provider_customer_id` is null until a payment provider populates it.
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
    """Card shape for the announcements list.

    `publish_at` is the start of the announcement's display range (validated
    against `expires_at`, the end, in `announcement_service.update`); the
    mobile client formats the pair as "Mon DD – Mon DD", or "Mon DD → —" when
    `expires_at` is null (open-ended).
    """

    id: uuid.UUID
    title: str
    description: str | None
    image_url: str | None
    pinned: bool
    publish_at: datetime | None
    created_at: datetime
    expires_at: datetime | None = None


class AnnouncementDetail(AnnouncementListItem):
    body: str
    # Redeclared without ListItem's default: unchanged from before this field
    # existed on ListItem — still required here (and on AnnouncementAdminItem,
    # which inherits it); only the list card gets the additive, defaulted
    # field. Pydantic orders inherited fields by the base class's declaration
    # position, so this now serialises ahead of `body` in the generated
    # schema regardless of source order here — a harmless ordering-only
    # diff in openapi.json (same fields, same requiredness, same types).
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
    # Grouped matches for a non-empty `q` — the mobile search screen draws
    # sermons/series/speakers as three sections. Populated only when `q` is
    # non-empty; with no `q` (filtered-browse mode) these stay empty, same as
    # today. Capped at a small fixed limit each (not paginated) — `limit`/
    # `offset` above keep applying to `results` (sermons) only. `*_total` is
    # the true match count, uncapped, so the client can show "See all N".
    series: list[SeriesPublic] = Field(default_factory=list)
    series_total: int = 0
    speakers: list[SpeakerPublic] = Field(default_factory=list)
    speakers_total: int = 0


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
    """All-time platform figures for the Dashboard. Every number is a count
    over the live tables at request time (not the daily rollups), so it
    covers history from before the rollups existed."""

    total_users: int
    # Mobile app accounts (role viewer); `active_members` excludes deactivated.
    members: int = 0
    active_members: int = 0
    active_subscribers: int
    published_sermons: int
    total_plays: int
    unique_viewers: int
    completions: int
    completion_rate: float
    plays_last_7_days: int
    watch_hours: float = 0.0


class SermonStatusCounts(BaseModel):
    """Sermons per workflow status, in the caller's scope (an editor's own
    sermons; everyone's for a manager/admin). Zero-filled."""

    draft: int = 0
    pending_review: int = 0
    under_review: int = 0
    approved: int = 0
    published: int = 0
    rejected: int = 0
    unpublished: int = 0
    total: int = 0


class ReportPeriod(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: date = Field(alias="from", serialization_alias="from")
    to: date
    granularity: Literal["day", "week", "month"]


class ReportKpis(BaseModel):
    """Period totals. `listeners` is distinct accounts over the whole period
    (not a sum of bucket counts). `new_listeners` and `signups` (viewer
    accounts created) are accurate for any period; the other measures exist
    only from `data_available_from` on."""

    plays: int
    completions: int
    watch_hours: float
    listeners: int
    new_listeners: int
    signups: int


class ReportBucket(BaseModel):
    """One bucket, half-open `[start, end)`. Weekly buckets cut at ISO
    Mondays and monthly at the 1st; the first and last are clipped to the
    period."""

    start: date
    end: date
    plays: int
    completions: int
    watch_hours: float
    listeners: int
    new_listeners: int
    signups: int


class ReportTopSermon(BaseModel):
    sermon_id: uuid.UUID
    title: str
    plays: int
    completions: int
    watch_hours: float


class UsageReport(BaseModel):
    """`GET /admin/analytics/report` (plan-admin-settings §A.5).
    `data_available_from` is the earliest day with any rollup data: plays,
    completions and watch time are forward-only from then (§A.2). Null when
    there is no rollup data yet."""

    period: ReportPeriod
    data_available_from: date | None
    kpis: ReportKpis
    series: list[ReportBucket]
    top_sermons: list[ReportTopSermon]


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
# Notes retired (Isaac's ask, session 2026-10-02): replaced by sermon comments.
# NoteCreate/NoteUpdate/NotePublic deliberately not carried forward from
# feat/r2-storage during the merge — bringing them back would contradict the
# whole point of the comments feature (ADR-0012 "Retire Notes").
# ═══════════════════════════════════════════════════════════════════════════════
# Verses (Home's "verse of the day" — see app/scripts/seed_verses.py)
# ═══════════════════════════════════════════════════════════════════════════════
class VerseCreate(BaseModel):
    reference: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1)
    translation: str = Field(default="kjv", max_length=20)
    is_active: bool = True


class VerseUpdate(BaseModel):
    reference: str | None = Field(default=None, min_length=1, max_length=100)
    text: str | None = Field(default=None, min_length=1)
    translation: str | None = Field(default=None, max_length=20)
    is_active: bool | None = None


class VersePublic(BaseModel):
    """What `GET /verses/today` returns — no `is_active`/`created_by`/timestamps,
    same split Announcements draws between its public and staff shapes."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reference: str
    text: str
    translation: str


class VerseAdminItem(VersePublic):
    is_active: bool
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime | None


# ═══════════════════════════════════════════════════════════════════════════════
# Playlists (Isaac's ask, session 2026-10-10: a "Library" tab for user-created
# playlists, Spotify's own playlist flow as the reference). Private by default;
# every write is owner-only and `GET /playlists` lists only the viewer's own.
# `GET /playlists/{id}` is also readable by a signed-in non-owner when
# `is_public` is true and no block exists in either direction (share links,
# ADR 0021 Phase 2); private, missing and blocked are one identical 404.
# Making a playlist public runs the comment content rules on name/description.
# A playlist item always points at a `Sermon` row — series episodes ARE
# sermons (`Sermon.series_id`), so "sermons and episodes" needs no second
# content type or polymorphic column, unlike the Like tables' sermon/series
# split.
# ═══════════════════════════════════════════════════════════════════════════════
class PlaylistCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=300)
    is_public: bool = False


class PlaylistUpdate(BaseModel):
    """Every field optional — a PATCH only touches what the client sends,
    same convention `SeriesUpdate`/`ProfileDetailsUpdate` already use."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=300)
    is_public: bool | None = None

    @model_validator(mode="after")
    def _no_explicit_null_for_required_columns(self) -> "PlaylistUpdate":
        # Omit a field to leave it alone; an explicit null would hit a NOT NULL column.
        for field in ("name", "is_public"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class PlaylistItemPublic(BaseModel):
    id: uuid.UUID
    position: int
    added_at: datetime
    sermon: SermonListItem


class PlaylistPublic(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    is_public: bool
    cover_url: str | None
    owner_name: str | None
    item_count: int
    total_duration_seconds: int
    created_at: datetime
    updated_at: datetime | None


class PlaylistDetail(PlaylistPublic):
    """Items are pre-filtered to what's currently visible to the viewer —
    a sermon unpublished after being added just quietly drops out of the
    list (same "invisible content never renders" rule every other catalog
    read follows), without deleting the underlying `PlaylistItem` row, so it
    reappears if the sermon is republished."""

    is_owner: bool
    items: list[PlaylistItemPublic]


class PlaylistItemAdd(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sermon_id: uuid.UUID


class PlaylistItemOrderRequest(BaseModel):
    """Every current item id, in the caller's desired order — same
    all-or-nothing shape `EpisodeOrderRequest` uses for episode reordering."""

    model_config = ConfigDict(extra="forbid")

    item_ids: list[uuid.UUID]


class PlaylistCoverUploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=3, max_length=120)


class PlaylistCoverTicket(BaseModel):
    """Pre-signed PUT for a playlist cover image — same direct-to-storage
    pattern the profile avatar and sermon/series thumbnails already use."""

    upload_url: str
    method: str = "PUT"
    headers: dict[str, str] = Field(default_factory=dict)
    expires_in: int
    cover_key: str


class PlaylistCoverResponse(BaseModel):
    cover_url: str | None


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


# ═══════════════════════════════════════════════════════════════════════════════
# Church settings (plan-admin-settings §A.4.3 / §A.5)
# ═══════════════════════════════════════════════════════════════════════════════

SETTINGS_URL_MAX = 2048

# Editable text fields: name -> (max length, multiline). Lengths match the
# `church_settings` columns. The comment guidelines are not editable: they
# are served from `app/content/comment_guidelines.txt`.
SETTINGS_TEXT_FIELDS: dict[str, tuple[int, bool]] = {
    "church_name": (200, False),
    "app_display_name": (100, False),
    "tagline": (200, False),
    "about": (5000, True),
    "contact_phone": (40, False),
    "address": (500, True),
    "copyright_notice": (300, False),
}
SETTINGS_URL_FIELDS = ("website_url", "terms_of_use_url", "privacy_policy_url")
# Columns that are NOT NULL: a PATCH may change them but never clear them.
SETTINGS_REQUIRED_FIELDS = ("contact_email",)
SETTINGS_EDITABLE_FIELDS = (
    *SETTINGS_TEXT_FIELDS, *SETTINGS_URL_FIELDS, "contact_email",
)


class ChurchSettingsPublic(BaseModel):
    """`GET /settings/public` — what the mobile app reads, unauthenticated.
    No `updated_by_id` or `updated_at`. `version` plus the guidelines digest
    form the weak ETag. `comment_guidelines` comes from the static
    file `app/content/comment_guidelines.txt`, not from the row. The mobile
    app renders contact email, comment guidelines and the two legal URLs in
    v1; the other fields are returned but not yet shown."""

    model_config = ConfigDict(from_attributes=True)

    church_name: str | None
    app_display_name: str | None
    tagline: str | None
    about: str | None
    contact_email: str
    contact_phone: str | None
    website_url: str | None
    address: str | None
    comment_guidelines: str
    terms_of_use_url: str | None
    privacy_policy_url: str | None
    copyright_notice: str | None
    # The admin portal's sign-in screen photo (a time-limited URL), or null
    # for the portal's built-in artwork. Changed through
    # `/admin/settings/sign-in-image*`, not the PATCH.
    sign_in_image_url: str | None = None
    version: int


class ChurchSettingsAdmin(ChurchSettingsPublic):
    """`GET/PATCH /admin/settings` — the public fields plus who last saved
    and when. `updated_by` is that account's email, `"Deleted account"` once
    it is gone, or null before the first edit."""

    updated_at: datetime
    updated_by: str | None


class ChurchSettingsUpdate(BaseModel):
    """Partial update. Omit a field to leave it unchanged; send `null` to
    clear an optional one (`contact_email` can be changed but never cleared;
    the comment guidelines are not editable and a body carrying them is a
    422). `version` must be the one the editor loaded: a stale value is a
    409, never a silent overwrite.

    Text is normalised like comments (NFC, control characters stripped,
    whitespace trimmed); an optional field left empty after that is stored
    as null. URLs must be absolute `https`.
    """

    model_config = ConfigDict(extra="forbid")

    version: int = Field(ge=1)
    church_name: str | None = None
    app_display_name: str | None = None
    tagline: str | None = None
    about: str | None = None
    contact_email: EmailStr | None = None
    contact_phone: str | None = None
    website_url: str | None = None
    address: str | None = None
    terms_of_use_url: str | None = None
    privacy_policy_url: str | None = None
    copyright_notice: str | None = None

    @field_validator(*SETTINGS_TEXT_FIELDS)
    @classmethod
    def _clean_text(cls, v: str | None, info) -> str | None:
        if v is None:
            return None
        cap, multiline = SETTINGS_TEXT_FIELDS[info.field_name]
        if raw_length_exceeded(v, cap):
            raise ValueError(f"Must be at most {cap} characters")
        cleaned = normalise_text(v, multiline=multiline)
        if len(cleaned) > cap:
            raise ValueError(f"Must be at most {cap} characters")
        return cleaned or None

    @field_validator(*SETTINGS_URL_FIELDS)
    @classmethod
    def _https_url(cls, v: str | None) -> str | None:
        if v is None:
            return None
        from urllib.parse import urlsplit

        v = v.strip()
        if not v:
            return None
        if len(v) > SETTINGS_URL_MAX:
            raise ValueError(f"Must be at most {SETTINGS_URL_MAX} characters")
        if any(c.isspace() or ord(c) < 0x20 or ord(c) == 0x7F for c in v):
            raise ValueError("Must not contain spaces or control characters")
        parts = urlsplit(v)
        if parts.scheme != "https" or not parts.hostname:
            raise ValueError("Must be an absolute https:// URL")
        return v

    @model_validator(mode="after")
    def _required_fields_not_cleared(self) -> "ChurchSettingsUpdate":
        for name in SETTINGS_REQUIRED_FIELDS:
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be empty")
        return self

    def changes(self) -> dict[str, str | None]:
        """The fields the caller actually sent, `version` excluded."""
        return {
            name: (str(getattr(self, name)) if getattr(self, name) is not None else None)
            for name in SETTINGS_EDITABLE_FIELDS
            if name in self.model_fields_set
        }


class AuditEntry(BaseModel):
    """One row of the unified audit feed (`GET /admin/audit`,
    plan-admin-settings §A.5, D9): `audit_log` plus the three domain logs
    that predate it, in one shape.

    `source` names the table a row came from. Legacy rows report `outcome`
    `success`, carry no `ip`/`user_agent`, and resolve `actor_label` from
    the actor's current account ("Deleted account" once it is gone,
    "System" for automatic comment hides); `audit_log` rows carry the email
    snapshot taken at write time. `summary` is a server-built sentence."""

    source: Literal[
        "audit_log", "approval_log", "announcement_approval_log", "comment_moderation_log"
    ]
    id: uuid.UUID
    created_at: datetime
    action: str
    outcome: Literal["success", "failure"]
    actor_id: uuid.UUID | None
    actor_label: str
    actor_role: str | None
    target_type: str | None
    target_id: uuid.UUID | None
    target_label: str | None
    ip: str | None
    user_agent: str | None
    details: dict
    summary: str


# ═══════════════════════════════════════════════════════════════════════════════
# Sermon comments (viewer side)
# ═══════════════════════════════════════════════════════════════════════════════
COMMENT_BODY_MAX = 1000
COMMENT_DETAIL_MAX = 500


class CommentCreate(BaseModel):
    """Only `body` is accepted. `sermon_id` comes from the URL path and the
    author from the token; any other key is a 422.

    Length, URL and blocklist rules are enforced in the service, after the
    rate-limit budget is charged, so a rejected attempt still costs budget
    (plan pin A6)."""

    model_config = ConfigDict(extra="forbid")

    body: str


class CommentReportCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: CommentReportReason
    detail: str | None = None

    @field_validator("detail")
    @classmethod
    def _clean_detail(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if raw_length_exceeded(v, COMMENT_DETAIL_MAX):
            raise ValueError(f"Detail must be at most {COMMENT_DETAIL_MAX} characters")
        cleaned = normalise_text(v)
        if len(cleaned) > COMMENT_DETAIL_MAX:
            raise ValueError(f"Detail must be at most {COMMENT_DETAIL_MAX} characters")
        return cleaned or None


class CommentPublic(BaseModel):
    """What a viewer sees. Deliberately carries no user id, email or role:
    the author is only ever "First L."; `is_mine` marks the caller's own rows.
    `status` and `hidden_label` are meaningful only when `is_mine`."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    sermon_id: uuid.UUID
    author_display_name: str
    body: str
    created_at: datetime
    is_mine: bool
    status: CommentStatus
    hidden_label: Literal["under_review", "removed_by_moderator"] | None = None


class BlockPublic(BaseModel):
    """`id` is the block row's own id, never the blocked user's."""

    id: uuid.UUID
    display_name: str
    created_at: datetime


class BlockCreated(BaseModel):
    """Result of blocking by comment id. `id` is null only when there was
    nothing to block (the caller's own comment, or a block removed
    concurrently)."""

    id: uuid.UUID | None = None


# ── Moderation (admin side) ──────────────────────────────────────────────────
MODERATION_REASON_MAX = 300  # C2 deviation 4: the DB column is uncapped text


def _clean_moderation_reason(v: str) -> str:
    """Shared reason validation: raw-length check first (M-1, so a huge payload is
    rejected before normalisation), then normalise, then the post-normalisation
    cap. Returns the cleaned text, which may be empty."""
    if raw_length_exceeded(v, MODERATION_REASON_MAX):
        raise ValueError(f"Reason must be at most {MODERATION_REASON_MAX} characters")
    cleaned = normalise_text(v)
    if len(cleaned) > MODERATION_REASON_MAX:
        raise ValueError(f"Reason must be at most {MODERATION_REASON_MAX} characters")
    return cleaned


class ModerationReason(BaseModel):
    """Request body for hide, hard delete and dismiss-reports. The reason is required, trimmed,
    normalised like any user text, and capped at 300 characters. It is stored
    in the moderation log and is never written to application logs."""

    model_config = ConfigDict(extra="forbid")

    reason: str

    @field_validator("reason")
    @classmethod
    def _clean_reason(cls, v: str) -> str:
        cleaned = _clean_moderation_reason(v)
        if not cleaned:
            raise ValueError("A reason is required")
        return cleaned


class CommentAdminForEditor(CommentPublic):
    """Moderation-queue row as an EDITOR sees it. A separate schema (not a
    nullable field) so the author's email and id are absent from the payload,
    per Isaac's C1 decision 3."""

    status: CommentStatus
    hidden_at: datetime | None = None
    hidden_reason: str | None = None
    hidden_auto: bool
    report_count: int
    sermon_title: str


class CommentAdmin(CommentAdminForEditor):
    """Moderation-queue row for MANAGER and ADMIN: adds who wrote it and who
    hid it (the moderator's id is not shown to EDITORs)."""

    hidden_by_id: uuid.UUID | None = None
    author_id: uuid.UUID
    author_email: str
