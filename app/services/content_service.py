"""Content service: catalog reads, CRUD, tier resolution, approval workflow.

Design notes
------------
* Catalog listings return ALL published sermons — visible but gated. The
  `locked` flag is computed per user; playback is refused later (Phase 4)
  when a locked sermon's stream is requested.
* Tier resolves: explicit sermon tier > series tier > free.
* Approval transitions are validated by app.services.approval and every
  transition writes an append-only ApprovalLog row.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from sqlalchemy.exc import IntegrityError  # noqa: E402

from app.models.models import MediaRef, Speaker  # noqa: E402

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.redis import cache_aside, get_redis
from app.models.content_schemas import (
    ApprovalLogItem,
    ReviewQueueItem,
    SermonAdminDetail,
    SermonCreate,
    SermonDetail,
    SermonListItem,
    SermonUpdate,
)
from app.models.models import (
    VIEWER_VISIBLE_STATUSES,
    ApprovalLog,
    Category,
    ContentTier,
    Sermon,
    Speaker,
    SermonStatus,
    SermonTag,
    Series,
    User,
    UserRole,
)
from app.services.approval import resolve_transition

settings = get_settings()
log = get_logger("content")

CATALOG_TTL_SECONDS = 300  # 5 minutes
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}

MAX_PAGE_SIZE = 100


async def next_episode_number(db: AsyncSession, series_id: uuid.UUID) -> int:
    """Next episode number for a series: one past the highest in use.

    Editors shouldn't have to track this by hand. A number can still be set
    explicitly when reordering, so this only fills the blank.

    Not collision-proof under simultaneous creates — two editors adding an
    episode at the same instant could both get the same number. Harmless here
    (ordering is by number, duplicates just sort adjacently) and cheaper than
    the locking the alternative would need.
    """
    highest = (await db.execute(
        select(func.max(Sermon.episode_number)).where(Sermon.series_id == series_id)
    )).scalar_one_or_none()
    return (highest or 0) + 1


class ContentError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def display_name(full_name: str | None, email: str | None) -> str | None:
    """Best human label for a user: full_name, else the email local-part, else
    None. One definition for every DTO that denormalises an actor's name."""
    if full_name and full_name.strip():
        return full_name.strip()
    if email and "@" in email:
        return email.split("@", 1)[0]
    return email or None


# ── Tier & locked resolution ──────────────────────────────────────────────────
def effective_tier(sermon: Sermon, series: Series | None) -> ContentTier:
    if sermon.tier is not None:
        return sermon.tier
    if series is not None:
        return series.tier
    return ContentTier.FREE


def _thumbnail_url(key: str | None) -> str | None:
    """Turn a stored thumbnail key into a fetchable URL.

    Prefers the CDN when configured (cacheable, no signing cost); otherwise
    signs a time-limited URL against the media bucket. Buckets stay private
    either way — we never expose a raw object URL.
    """
    if not key:
        return None
    if settings.cdn_base_url:
        return f"{settings.cdn_base_url.rstrip('/')}/{key}"
    from app.core import storage as storage_module

    try:
        return storage_module.get_storage().presigned_download_url(
            settings.s3_media_bucket, key, settings.stream_url_expire_seconds
        )
    except Exception:
        log.warning("thumbnail_url_failed", key=key)
        return None


def to_list_item(
    sermon: Sermon,
    tier: ContentTier,
    has_subscription: bool,
    names: "RefNames | None" = None,
) -> SermonListItem:
    names = names or RefNames()
    return SermonListItem(
        id=sermon.id,
        title=sermon.title,
        description=sermon.description,
        thumbnail_url=_thumbnail_url(sermon.thumbnail_key),
        duration_seconds=sermon.duration_seconds,
        speaker_id=sermon.speaker_id,
        speaker_name=names.speakers.get(sermon.speaker_id),
        category_id=sermon.category_id,
        category_name=names.categories.get(sermon.category_id),
        series_id=sermon.series_id,
        series_title=names.series.get(sermon.series_id),
        episode_number=sermon.episode_number,
        tier=tier,
        locked=(tier == ContentTier.PAID and not has_subscription),
    )


@dataclass
class RefNames:
    """Speaker/category/series names for a batch of sermons, so a list view
    resolves them in three queries rather than three per row."""

    speakers: dict = field(default_factory=dict)
    categories: dict = field(default_factory=dict)
    series: dict = field(default_factory=dict)


async def load_ref_names(db: AsyncSession, sermons: list[Sermon]) -> RefNames:
    speaker_ids = {s.speaker_id for s in sermons if s.speaker_id}
    category_ids = {s.category_id for s in sermons if s.category_id}
    series_ids = {s.series_id for s in sermons if s.series_id}

    names = RefNames()
    if speaker_ids:
        rows = (await db.execute(
            select(Speaker.id, Speaker.name).where(Speaker.id.in_(speaker_ids))
        )).all()
        names.speakers = {i: n for i, n in rows}
    if category_ids:
        rows = (await db.execute(
            select(Category.id, Category.name).where(Category.id.in_(category_ids))
        )).all()
        names.categories = {i: n for i, n in rows}
    if series_ids:
        rows = (await db.execute(
            select(Series.id, Series.title).where(Series.id.in_(series_ids))
        )).all()
        names.series = {i: t for i, t in rows}
    return names


async def series_for(db: AsyncSession, sermons: list[Sermon]) -> dict:
    """Series rows keyed by id, for resolving inherited tiers in bulk."""
    ids = {s.series_id for s in sermons if s.series_id}
    if not ids:
        return {}
    rows = (await db.execute(select(Series).where(Series.id.in_(ids)))).scalars().all()
    return {s.id: s for s in rows}


async def _has_subscription(db: AsyncSession, user: User | None) -> bool:
    """Does this user currently have access to paid content?

    Delegates to the subscription service, which caches the answer in Redis —
    this sits on the hot path for every catalog read and every playback.
    Imported lazily to avoid a circular import at module load.
    """
    from app.services import subscription_service

    return await subscription_service.is_entitled(db, user)


# ── Catalog reads (cached) ────────────────────────────────────────────────────
async def list_published_sermons(
    db: AsyncSession, user: User | None
) -> list[SermonListItem]:
    """All published sermons, newest first. Cached by tier, since the raw list
    is identical for everyone; the per-user `locked` flag is applied after."""
    has_sub = await _has_subscription(db, user)
    cache_key = "catalog:published:v1"

    async def _load() -> list[dict]:
        stmt = (
            select(Sermon)
            .where(Sermon.status == SermonStatus.PUBLISHED)
            .order_by(Sermon.published_at.desc().nullslast())
        )
        rows = (await db.execute(stmt)).scalars().all()
        series_map = await _series_map(db, rows)
        out = []
        for s in rows:
            tier = effective_tier(s, series_map.get(s.series_id))
            # Cache the tier-resolved shape without the user-specific lock.
            item = to_list_item(s, tier, has_subscription=True)
            d = item.model_dump(mode="json")
            d["tier"] = tier.value
            out.append(d)
        return out

    cached = await cache_aside(cache_key, CATALOG_TTL_SECONDS, _load)

    # Apply the per-user lock to the cached, tier-resolved list.
    items: list[SermonListItem] = []
    for d in cached:
        tier = ContentTier(d["tier"])
        d = {**d, "locked": (tier == ContentTier.PAID and not has_sub)}
        items.append(SermonListItem.model_validate(d))
    return items


async def _series_map(db: AsyncSession, sermons: list[Sermon]) -> dict[uuid.UUID, Series]:
    ids = {s.series_id for s in sermons if s.series_id is not None}
    if not ids:
        return {}
    rows = (await db.execute(select(Series).where(Series.id.in_(ids)))).scalars().all()
    return {s.id: s for s in rows}


async def invalidate_catalog_cache() -> None:
    try:
        await get_redis().delete("catalog:published:v1")
    except Exception:
        log.warning("catalog_cache_invalidation_failed")


# ── Editor-ownership rule (one definition, two representations) ────────────────
# The rule: an editor may only touch sermons they created; a manager or admin
# may touch any. It is needed both as a row-level check on an already-loaded
# Sermon (staff_scope_hides) and as a SQL predicate for list queries
# (editor_scope_filter). These two are twins — change one, change the other —
# and everything else routes through them rather than re-inlining the test.
def staff_scope_hides(sermon: Sermon, requester: User) -> bool:
    """Row-level form: does the editor-scoping rule hide this sermon from
    `requester`? A caller that hits this returns 404, never 403 — an editor
    must not be able to tell someone else's sermon exists. `created_by` NULL
    fails safe (hidden from an editor)."""
    return requester.role == UserRole.EDITOR and sermon.created_by != requester.id


def editor_scope_filter(requester: User):
    """Query-level twin of `staff_scope_hides`: the SQLAlchemy predicate that
    confines an editor to their own sermons, or None for manager/admin (no
    restriction)."""
    if requester.role == UserRole.EDITOR:
        return Sermon.created_by == requester.id
    return None


def ensure_editor_can_access(
    sermon: Sermon, requester: User, *, action: str, hide: bool = False
) -> None:
    """Enforce the editor-ownership rule, raising the right typed error.

    `hide=True`  -> 404 "Sermon not found" (don't disclose existence).
    `hide=False` -> 403 "You can only <action> your own sermons".

    This is the single place the 403/404 message-and-status choice is made, so
    the four callers that used to inline `role == EDITOR and created_by != id`
    now differ only in `action`/`hide`.
    """
    if not staff_scope_hides(sermon, requester):
        return
    if hide:
        raise ContentError("Sermon not found", status_code=404)
    raise ContentError(f"You can only {action} your own sermons", status_code=403)


# ── Sermon detail ─────────────────────────────────────────────────────────────
async def _assemble_sermon_detail(
    db: AsyncSession, sermon: Sermon, user: User | None
) -> SermonDetail:
    """Shared tail of the public and staff sermon-detail reads: resolve the
    effective tier + entitlement and build the `SermonDetail`.

    `sermon` must already have `media_refs` and `tags` eager-loaded. Callers
    apply their own access guard first — published-visibility for the public
    read, editor-ownership for the staff read; those axes are orthogonal and
    are deliberately NOT folded in here.
    """
    series = None
    if sermon.series_id is not None:
        series = await db.get(Series, sermon.series_id)
    tier = effective_tier(sermon, series)
    has_sub = await _has_subscription(db, user)

    base = to_list_item(sermon, tier, has_sub)
    return SermonDetail(
        **base.model_dump(),
        status=sermon.status,
        tags=[t.tag for t in sermon.tags],
        media_refs=sermon.media_refs,
        published_at=sermon.published_at,
        created_at=sermon.created_at,
    )


async def _load_sermon_with_detail_rels(
    db: AsyncSession, sermon_id: uuid.UUID
) -> Sermon | None:
    stmt = (
        select(Sermon)
        .where(Sermon.id == sermon_id)
        .options(selectinload(Sermon.media_refs), selectinload(Sermon.tags))
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_sermon_detail(
    db: AsyncSession, sermon_id: uuid.UUID, user: User | None
) -> SermonDetail:
    """Public catalog detail read: published sermons only for viewers. Staff
    can see any status here too, but the workflow-aware read for the editor
    screen is `get_sermon_for_staff` (which also enforces editor ownership)."""
    sermon = await _load_sermon_with_detail_rels(db, sermon_id)
    if sermon is None:
        raise ContentError("Sermon not found", status_code=404)

    # Viewers only see published content; editors/managers can see any of their
    # own work-in-progress via the editor endpoints, not here.
    is_staff = user is not None and user.role in (
        UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN
    )
    if sermon.status not in VIEWER_VISIBLE_STATUSES and not is_staff:
        raise ContentError("Sermon not found", status_code=404)

    return await _assemble_sermon_detail(db, sermon, user)


async def get_sermon_for_staff(
    db: AsyncSession, sermon_id: uuid.UUID, requester: User
) -> SermonAdminDetail:
    """Load one sermon in ANY status for the staff editor screen.

    Unlike `get_sermon_detail` (published-only for viewers), this is the
    workflow-aware read: an editor gets their own draft/rejected/pending work,
    a manager or admin gets anyone's. An editor asking for another editor's
    sermon gets 404, not 403. Carries `updated_at` (the "saved N min ago"
    baseline) via `SermonAdminDetail`; the public `SermonDetail` does not.
    """
    sermon = await _load_sermon_with_detail_rels(db, sermon_id)
    if sermon is None or staff_scope_hides(sermon, requester):
        raise ContentError("Sermon not found", status_code=404)

    detail = await _assemble_sermon_detail(db, sermon, requester)
    data = detail.model_dump()
    # Staff DTO carries the RAW tier column (NULL = inherit from series), not
    # the resolved effective tier the public `SermonDetail` exposes. See the
    # SermonAdminDetail docstring.
    data["tier"] = sermon.tier
    return SermonAdminDetail(**data, updated_at=sermon.updated_at)


# ── CRUD ──────────────────────────────────────────────────────────────────────
async def create_sermon(db: AsyncSession, data: SermonCreate, creator: User) -> Sermon:
    if data.series_id is not None and await db.get(Series, data.series_id) is None:
        raise ContentError("series_id does not exist", status_code=400)

    # Fill the episode number automatically when the sermon joins a series and
    # the editor hasn't set one.
    episode_number = data.episode_number
    if data.series_id is not None and episode_number is None:
        episode_number = await next_episode_number(db, data.series_id)

    sermon = Sermon(
        title=data.title,
        description=data.description,
        speaker_id=data.speaker_id,
        category_id=data.category_id,
        series_id=data.series_id,
        episode_number=episode_number,
        tier=data.tier,
        status=SermonStatus.DRAFT,
        created_by=creator.id,
    )
    for tag in {t.strip().lower() for t in data.tags if t.strip()}:
        sermon.tags.append(SermonTag(tag=tag))
    db.add(sermon)
    await db.commit()
    await db.refresh(sermon)
    log.info("sermon_created", sermon_id=str(sermon.id), by=str(creator.id))
    return sermon


async def update_sermon(
    db: AsyncSession, sermon_id: uuid.UUID, data: SermonUpdate, editor: User
) -> Sermon:
    sermon = await _load_editable(db, sermon_id, editor)

    fields = data.model_dump(exclude_unset=True, exclude={"tags"})

    # Moving a sermon into a series (or between series) without naming an
    # episode number gets the next free one.
    new_series = fields.get("series_id", sermon.series_id)
    if (
        new_series is not None
        and fields.get("episode_number") is None
        and (new_series != sermon.series_id or sermon.episode_number is None)
    ):
        fields["episode_number"] = await next_episode_number(db, new_series)

    changed = False
    for key, value in fields.items():
        if getattr(sermon, key) != value:
            changed = True
        setattr(sermon, key, value)

    # Tags are excluded from `fields` (and so from the `changed` check) on
    # purpose: they are not part of SermonListItem / the cached catalog row, so
    # a tags-only edit never needs to bust the catalog cache below.
    if data.tags is not None:
        sermon.tags.clear()
        for tag in {t.strip().lower() for t in data.tags if t.strip()}:
            sermon.tags.append(SermonTag(tag=tag))

    await db.commit()
    await db.refresh(sermon)

    # A published sermon's card is cached in the public catalog (5 min TTL). Any
    # effective change to it — not just tier: the cached SermonListItem carries
    # title, description, thumbnail, duration, episode number, the denormalised
    # speaker/category/series names and tier — leaves the catalog disagreeing
    # with the live detail/stream endpoints until the TTL lapses. Commit first,
    # then invalidate (mirrors update_series / the approval transitions).
    if changed and sermon.status == SermonStatus.PUBLISHED:
        await invalidate_catalog_cache()

    log.info("sermon_updated", sermon_id=str(sermon.id), by=str(editor.id))
    return sermon


async def _load_editable(db: AsyncSession, sermon_id: uuid.UUID, editor: User) -> Sermon:
    stmt = (
        select(Sermon)
        .where(Sermon.id == sermon_id)
        .options(selectinload(Sermon.tags))
    )
    sermon = (await db.execute(stmt)).scalar_one_or_none()
    if sermon is None:
        raise ContentError("Sermon not found", status_code=404)
    # Editors may only edit their own drafts; managers/admins may edit any.
    ensure_editor_can_access(sermon, editor, action="edit")
    return sermon


# ── Approval workflow ─────────────────────────────────────────────────────────
# Per-action (status_code, message) for the editor-not-owner case in
# `transition`. Every editor-reachable action currently normalises to a 404
# that is byte-identical to a missing sermon; the map is the seam for a future
# action that needs to say something else.
_EDITOR_SCOPE_DENIED_DEFAULT: tuple[int, str] = (404, "Sermon not found")
_EDITOR_SCOPE_DENIED: dict[str, tuple[int, str]] = {
    "submit": _EDITOR_SCOPE_DENIED_DEFAULT,
    "withdraw": _EDITOR_SCOPE_DENIED_DEFAULT,
}


async def transition(
    db: AsyncSession,
    sermon_id: uuid.UUID,
    action: str,
    actor: User,
    note: str | None = None,
) -> Sermon:
    from app.services.approval import TransitionError

    sermon = (await db.execute(
        select(Sermon).where(Sermon.id == sermon_id)
    )).scalar_one_or_none()
    if sermon is None:
        raise ContentError("Sermon not found", status_code=404)

    # Editors act only on their own sermons. Every action an editor can reach
    # normalises to 404 for a non-owner — a probing editor must not be able to
    # tell one sermon's id from another by the error it gets back. Kept as a
    # map rather than an if/elif chain so an action that ever wants a different
    # disclosure posture is a one-line entry, not a new branch.
    if staff_scope_hides(sermon, actor):
        status_code, message = _EDITOR_SCOPE_DENIED.get(
            action, _EDITOR_SCOPE_DENIED_DEFAULT
        )
        raise ContentError(message, status_code=status_code)

    # Isaac's call: an editor may withdraw only from PENDING_REVIEW. Once a
    # manager has picked it up (UNDER_REVIEW), only a manager/admin can send it
    # back — otherwise an editor could withdraw→edit→resubmit in a loop and a
    # reviewer's rejection note would never land.
    if (
        action == "withdraw"
        and actor.role == UserRole.EDITOR
        and sermon.status == SermonStatus.UNDER_REVIEW
    ):
        raise ContentError(
            "A manager is reviewing this — ask them to send it back.",
            status_code=409,
        )

    try:
        new_status = resolve_transition(action, sermon.status, actor.role)
    except TransitionError as exc:
        raise ContentError(exc.message, status_code=409)

    from_status = sermon.status
    sermon.status = new_status
    if new_status == SermonStatus.PUBLISHED:
        sermon.published_at = datetime.now(timezone.utc)

    db.add(ApprovalLog(
        sermon_id=sermon.id,
        from_status=from_status.value,
        to_status=new_status.value,
        actor_id=actor.id,
        note=note,
    ))
    await db.commit()
    await db.refresh(sermon)

    # Publishing or unpublishing changes the public catalog — bust the cache.
    if new_status in (SermonStatus.PUBLISHED, SermonStatus.UNPUBLISHED):
        await invalidate_catalog_cache()

    log.info(
        "sermon_transition",
        sermon_id=str(sermon.id),
        action=action,
        from_status=from_status.value,
        to_status=new_status.value,
        by=str(actor.id),
    )
    return sermon


async def review_queue_page(
    db: AsyncSession, limit: int = 25, offset: int = 0
) -> tuple[list[ReviewQueueItem], int]:
    """Sermons in pending_review / under_review, longest-waiting first.

    Pagination shape mirrors `list_sermons_for_staff`: returns (page, total)
    where `total` is the count before limit/offset so the W10 screen can size
    its pager.

    Two per-row values come from correlated subqueries against `approval_log`
    rather than new columns:

    * `submitted_at` — `max(created_at)` over the rows that moved this sermon
      to `pending_review` (the editor's last submit). It is also the sort key:
      ascending, so the longest wait sits at the top.
    * `review_claimed_by` — the actor of the most recent `to_status =
      under_review` row, resolved to a display name; only populated for
      `under_review` items.
    """
    statuses = (SermonStatus.PENDING_REVIEW, SermonStatus.UNDER_REVIEW)
    base_where = Sermon.status.in_(statuses)

    submitted_at_sq = (
        select(func.max(ApprovalLog.created_at))
        .where(
            ApprovalLog.sermon_id == Sermon.id,
            ApprovalLog.to_status == SermonStatus.PENDING_REVIEW.value,
        )
        .correlate(Sermon)
        .scalar_subquery()
    )
    claimed_actor_sq = (
        select(ApprovalLog.actor_id)
        .where(
            ApprovalLog.sermon_id == Sermon.id,
            ApprovalLog.to_status == SermonStatus.UNDER_REVIEW.value,
        )
        .order_by(ApprovalLog.created_at.desc())
        .limit(1)
        .correlate(Sermon)
        .scalar_subquery()
    )

    total = (await db.execute(
        select(func.count()).select_from(Sermon).where(base_where)
    )).scalar_one()

    rows = (await db.execute(
        select(
            Sermon,
            submitted_at_sq.label("submitted_at"),
            claimed_actor_sq.label("claimed_actor_id"),
        )
        .where(base_where)
        .order_by(submitted_at_sq.asc().nullslast(), Sermon.created_at.asc())
        .limit(max(1, min(limit, MAX_PAGE_SIZE)))
        .offset(max(0, offset))
    )).all()

    sermons = [row[0] for row in rows]
    names = await load_ref_names(db, sermons)
    series_map = await series_for(db, sermons)

    media_counts: dict[uuid.UUID, int] = {}
    sermon_ids = [s.id for s in sermons]
    if sermon_ids:
        for sid, count in (await db.execute(
            select(MediaRef.sermon_id, func.count())
            .where(MediaRef.sermon_id.in_(sermon_ids))
            .group_by(MediaRef.sermon_id)
        )).all():
            media_counts[sid] = count

    actor_ids = {row[2] for row in rows if row[2] is not None}
    actor_names: dict[uuid.UUID, str | None] = {}
    if actor_ids:
        for uid, full_name, email in (await db.execute(
            select(User.id, User.full_name, User.email).where(User.id.in_(actor_ids))
        )).all():
            actor_names[uid] = display_name(full_name, email)

    items = [
        ReviewQueueItem(
            id=sermon.id,
            title=sermon.title,
            description=sermon.description,
            duration_seconds=sermon.duration_seconds,
            speaker_id=sermon.speaker_id,
            speaker_name=names.speakers.get(sermon.speaker_id),
            category_id=sermon.category_id,
            category_name=names.categories.get(sermon.category_id),
            series_id=sermon.series_id,
            series_title=names.series.get(sermon.series_id),
            is_standalone=sermon.series_id is None,
            tier=effective_tier(sermon, series_map.get(sermon.series_id)),
            status=sermon.status,
            submitted_at=submitted_at,
            renditions_ready=media_counts.get(sermon.id, 0),
            review_claimed_by=(
                actor_names.get(claimed_actor_id)
                if sermon.status == SermonStatus.UNDER_REVIEW
                else None
            ),
        )
        for sermon, submitted_at, claimed_actor_id in rows
    ]
    return items, total


async def approval_history(db: AsyncSession, sermon_id: uuid.UUID) -> list[ApprovalLog]:
    stmt = (
        select(ApprovalLog)
        .where(ApprovalLog.sermon_id == sermon_id)
        .order_by(ApprovalLog.created_at.asc())
    )
    return list((await db.execute(stmt)).scalars().all())


async def _approval_log_items(
    db: AsyncSession, sermon_id: uuid.UUID
) -> list[ApprovalLogItem]:
    """Approval-log rows for a sermon, oldest first, each carrying the actor's
    display name (left join on `users`; NULL-safe if the row's actor was
    since deleted — RESTRICT makes that rare, not impossible)."""
    rows = (await db.execute(
        select(ApprovalLog, User.full_name, User.email)
        .outerjoin(User, User.id == ApprovalLog.actor_id)
        .where(ApprovalLog.sermon_id == sermon_id)
        .order_by(ApprovalLog.created_at.asc())
    )).all()
    return [
        ApprovalLogItem(
            from_status=entry.from_status,
            to_status=entry.to_status,
            actor_id=entry.actor_id,
            actor_name=display_name(full_name, email),
            note=entry.note,
            created_at=entry.created_at,
        )
        for entry, full_name, email in rows
    ]


async def approval_history_for_staff(
    db: AsyncSession, sermon_id: uuid.UUID, requester: User
) -> list[ApprovalLogItem]:
    """Approval log for the staff editor screen.

    An editor reads the log for their OWN sermon — it's where they find out why
    it was rejected. Managers and admins read any sermon's log. Another editor's
    sermon (or a missing one) is 404, not 403: don't confirm it exists.
    """
    sermon = await db.get(Sermon, sermon_id)
    if sermon is None or staff_scope_hides(sermon, requester):
        raise ContentError("Sermon not found", status_code=404)
    return await _approval_log_items(db, sermon_id)


# ── Categories (flat) ─────────────────────────────────────────────────────────
async def create_category(db: AsyncSession, name: str, slug: str) -> Category:
    cat = Category(name=name, slug=slug)
    db.add(cat)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ContentError("A category with that slug already exists", status_code=409)
    await db.refresh(cat)
    return cat


async def list_categories(db: AsyncSession) -> list[Category]:
    rows = (await db.execute(select(Category).order_by(Category.name))).scalars().all()
    return list(rows)


# Backwards-compatible alias.
list_categories_flat = list_categories


async def get_category(db: AsyncSession, category_id: uuid.UUID) -> Category:
    cat = await db.get(Category, category_id)
    if cat is None:
        raise ContentError("Category not found", status_code=404)
    return cat


async def update_category(
    db: AsyncSession,
    category_id: uuid.UUID,
    name: str | None,
    slug: str | None,
) -> Category:
    cat = await get_category(db, category_id)
    if name is not None:
        cat.name = name
    if slug is not None:
        cat.slug = slug
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ContentError("A category with that slug already exists", status_code=409)
    await db.refresh(cat)
    return cat


async def delete_category(db: AsyncSession, category_id: uuid.UUID) -> None:
    cat = await get_category(db, category_id)
    # sermons.category_id and series.category_id are ON DELETE SET NULL, so the
    # content survives and simply becomes uncategorised.
    await db.delete(cat)
    await db.commit()
    await invalidate_catalog_cache()


# ── Speakers ──────────────────────────────────────────────────────────────────
async def get_speaker(db: AsyncSession, speaker_id: uuid.UUID) -> Speaker:
    speaker = await db.get(Speaker, speaker_id)
    if speaker is None:
        raise ContentError("Speaker not found", status_code=404)
    return speaker


async def update_speaker(
    db: AsyncSession, speaker_id: uuid.UUID, name: str | None, bio: str | None, bio_set: bool
) -> Speaker:
    speaker = await get_speaker(db, speaker_id)
    if name is not None:
        speaker.name = name
    if bio_set:
        speaker.bio = bio
    await db.commit()
    await db.refresh(speaker)
    return speaker


async def delete_speaker(db: AsyncSession, speaker_id: uuid.UUID) -> None:
    speaker = await get_speaker(db, speaker_id)
    # sermons.speaker_id is ON DELETE SET NULL.
    await db.delete(speaker)
    await db.commit()
    await invalidate_catalog_cache()


# ── Series ────────────────────────────────────────────────────────────────────
async def get_series(db: AsyncSession, series_id: uuid.UUID) -> Series:
    series = await db.get(Series, series_id)
    if series is None:
        raise ContentError("Series not found", status_code=404)
    return series


async def list_series(db: AsyncSession) -> list[Series]:
    rows = (await db.execute(select(Series).order_by(Series.title))).scalars().all()
    return list(rows)


async def update_series(
    db: AsyncSession, series_id: uuid.UUID, fields: dict, editor: User
) -> Series:
    series = await get_series(db, series_id)
    if editor.role == UserRole.EDITOR and series.created_by != editor.id:
        raise ContentError("You can only edit your own series", status_code=403)

    if "category_id" in fields and fields["category_id"] is not None:
        if await db.get(Category, fields["category_id"]) is None:
            raise ContentError("category_id does not exist", status_code=400)

    tier_changed = "tier" in fields and fields["tier"] != series.tier
    for key, value in fields.items():
        setattr(series, key, value)
    await db.commit()
    await db.refresh(series)

    # A tier change alters the effective tier of inheriting episodes in the
    # public catalog, so bust the cache.
    if tier_changed:
        await invalidate_catalog_cache()
    return series


async def delete_series(db: AsyncSession, series_id: uuid.UUID) -> None:
    series = await get_series(db, series_id)
    # sermons.series_id is ON DELETE SET NULL — episodes become standalone
    # sermons rather than being deleted.
    await db.delete(series)
    await db.commit()
    await invalidate_catalog_cache()


# ── Sermons: list & delete ────────────────────────────────────────────────────
async def list_sermons_for_staff(
    db: AsyncSession,
    requester: User,
    status_filter: SermonStatus | None,
    limit: int = 25,
    offset: int = 0,
    search: str | None = None,
    speaker_id: uuid.UUID | None = None,
    series_id: uuid.UUID | None = None,
    tier: ContentTier | None = None,
) -> tuple[list[Sermon], int]:
    """Editors see their own sermons across all statuses; managers/admins see
    everyone's. Returns (rows, total) — total is the count before paging, so a
    CMS can size its pager."""
    conditions = []
    scope_clause = editor_scope_filter(requester)
    if scope_clause is not None:
        conditions.append(scope_clause)
    if status_filter is not None:
        conditions.append(Sermon.status == status_filter)
    if search:
        conditions.append(func.lower(Sermon.title).like(f"%{search.lower()}%"))
    if speaker_id is not None:
        conditions.append(Sermon.speaker_id == speaker_id)
    if series_id is not None:
        conditions.append(Sermon.series_id == series_id)

    # Effective tier = sermon.tier ?? series.tier ?? free — the SQL form of
    # effective_tier() above, mirroring the pattern search_service uses. Filter
    # it in SQL so `total` and the returned page are built from one condition
    # list and cannot disagree.
    needs_series_join = tier is not None
    if tier is not None:
        conditions.append(
            func.coalesce(Sermon.tier, Series.tier, ContentTier.FREE) == tier
        )

    count_stmt = select(func.count()).select_from(Sermon)
    page_stmt = select(Sermon)
    if needs_series_join:
        join_on = Series.id == Sermon.series_id
        count_stmt = count_stmt.outerjoin(Series, join_on)
        page_stmt = page_stmt.outerjoin(Series, join_on)

    total = (await db.execute(count_stmt.where(*conditions))).scalar_one()

    stmt = (
        page_stmt
        .where(*conditions)
        .order_by(Sermon.updated_at.desc().nullslast(), Sermon.created_at.desc())
        .limit(max(1, min(limit, MAX_PAGE_SIZE)))
        .offset(max(0, offset))
    )
    return list((await db.execute(stmt)).scalars().all()), total


async def delete_sermon(db: AsyncSession, sermon_id: uuid.UUID, actor: User) -> None:
    sermon = (await db.execute(
        select(Sermon).where(Sermon.id == sermon_id)
    )).scalar_one_or_none()
    if sermon is None:
        raise ContentError("Sermon not found", status_code=404)

    # Never hard-delete live content — unpublish first. This preserves the
    # "unpublish is the reversible path" model and avoids yanking something a
    # viewer may be mid-playback on.
    if sermon.status == SermonStatus.PUBLISHED:
        raise ContentError(
            "Unpublish the sermon before deleting it", status_code=409
        )

    if actor.role == UserRole.EDITOR:
        if sermon.created_by != actor.id:
            raise ContentError("You can only delete your own sermons", status_code=403)
        # Editors may only delete work that never went live.
        if sermon.status not in (SermonStatus.DRAFT, SermonStatus.REJECTED):
            raise ContentError(
                "Editors can only delete draft or rejected sermons", status_code=403
            )

    # media_refs, sermon_tags and approval_log cascade on delete.
    await db.delete(sermon)
    await db.commit()
    log.info("sermon_deleted", sermon_id=str(sermon_id), by=str(actor.id))


def series_to_public(series: Series) -> dict:
    """Series fields plus a resolved thumbnail URL, for the API layer."""
    return {
        "id": series.id,
        "title": series.title,
        "description": series.description,
        "category_id": series.category_id,
        "tier": series.tier,
        "status": series.status,
        "thumbnail_url": _thumbnail_url(series.thumbnail_key),
    }


def _validate_image_type(content_type: str) -> None:
    if content_type.lower() not in ALLOWED_IMAGE_TYPES:
        raise ContentError(
            f"Unsupported image type '{content_type}'. Use JPEG, PNG, or WebP.",
            status_code=400,
        )


async def create_thumbnail_ticket(
    db: AsyncSession, kind: str, entity_id: uuid.UUID, actor: User,
    filename: str, content_type: str,
) -> dict:
    """Issue a pre-signed PUT for a sermon or series cover image.

    Same direct-to-storage pattern as media: the image never passes through
    this API.
    """
    from app.core import storage as storage_module

    _validate_image_type(content_type)
    entity = await _load_thumbnail_target(db, kind, entity_id, actor)

    key = storage_module.thumbnail_key(kind, entity.id, filename)
    url = storage_module.get_storage().presigned_upload_url(
        settings.s3_media_bucket, key, content_type,
        settings.upload_url_expire_seconds,
    )
    return {
        "upload_url": url,
        "headers": {"Content-Type": content_type},
        "expires_in": settings.upload_url_expire_seconds,
        "thumbnail_key": key,
    }


async def confirm_thumbnail(
    db: AsyncSession, kind: str, entity_id: uuid.UUID, actor: User, key: str
) -> str | None:
    """Attach an uploaded image after verifying it actually landed."""
    from app.core import storage as storage_module

    entity = await _load_thumbnail_target(db, kind, entity_id, actor)

    # The key is supplied by the client, so confine it to this entity's prefix —
    # otherwise a caller could point their thumbnail at any object in the bucket.
    expected_prefix = f"thumbnails/{kind}/{entity.id}/"
    if not key.startswith(expected_prefix):
        raise ContentError("Thumbnail key does not belong to this item", 400)

    store = storage_module.get_storage()
    if not store.object_exists(settings.s3_media_bucket, key):
        raise ContentError(
            "No uploaded image found — complete the PUT first", status_code=409
        )

    # The presign signature pins content-type but not length — a client can PUT
    # a multi-GB "image". Re-check the real object size, mirroring the Batch-2
    # media-confirm fix. `None` (stub backend / size unknowable) → proceed, as
    # the media path does; a concrete oversize → delete the object and 413.
    size = store.object_size(settings.s3_media_bucket, key)
    if size is not None and size > settings.max_thumbnail_bytes:
        try:
            store.delete_object(settings.s3_media_bucket, key)
        except Exception:  # noqa: BLE001 - best-effort cleanup, still reject
            log.warning("oversize_thumbnail_cleanup_failed", key=key)
        raise ContentError(
            f"Thumbnail is larger than the "
            f"{settings.max_thumbnail_bytes // (1024 * 1024)} MB limit.",
            status_code=413,
        )

    entity.thumbnail_key = key
    await db.commit()
    await invalidate_catalog_cache()
    log.info("thumbnail_set", kind=kind, entity_id=str(entity.id), by=str(actor.id))
    return _thumbnail_url(key)


async def _load_thumbnail_target(
    db: AsyncSession, kind: str, entity_id: uuid.UUID, actor: User
):
    if kind == "sermons":
        entity = (await db.execute(
            select(Sermon).where(Sermon.id == entity_id)
        )).scalar_one_or_none()
        label = "Sermon"
    elif kind == "series":
        entity = await db.get(Series, entity_id)
        label = "Series"
    else:
        raise ContentError("Unknown thumbnail target", status_code=400)

    if entity is None:
        raise ContentError(f"{label} not found", status_code=404)
    if actor.role == UserRole.EDITOR and entity.created_by != actor.id:
        raise ContentError(f"You can only edit your own {label.lower()}", 403)
    return entity
