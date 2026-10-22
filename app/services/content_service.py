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

import random
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import String, case, func, literal_column, nullslast, or_, select, type_coerce
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from sqlalchemy.exc import IntegrityError  # noqa: E402

from app.models.models import MediaRef, Speaker  # noqa: E402

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.redis import cache_aside, get_redis
from app.models.content_schemas import (
    MAX_PAGE_SIZE,
    ApprovalLogItem,
    ReviewQueueItem,
    SermonAdminDetail,
    SermonCreate,
    SermonDetail,
    SermonListItem,
    SermonUpdate,
    UpcomingSermon,
)
from app.models.models import (
    VIEWER_VISIBLE_STATUSES,
    ApprovalLog,
    Category,
    ContentTier,
    PlaybackSession,
    Sermon,
    Speaker,
    SermonStatus,
    SermonTag,
    Series,
    SeriesLike,
    User,
    UserRole,
)
from app.services import likes_service
from app.services.approval import resolve_transition

settings = get_settings()
log = get_logger("content")

CATALOG_TTL_SECONDS = 300  # 5 minutes
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}

# MAX_PAGE_SIZE is defined in app.models.content_schemas (imported above) so the
# request schemas and these service clamps share one source of truth.


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


# ── Review lock on episode position ──────────────────────────────────────────
_REVIEW_LOCK_STATUSES = (SermonStatus.PENDING_REVIEW, SermonStatus.UNDER_REVIEW)


def episode_position_move_locked(
    sermon: Sermon,
    *,
    target_episode_number: int | None = None,
    new_series_id: uuid.UUID | None = None,
    series_id_provided: bool = False,
    locked_statuses: tuple[SermonStatus, ...] = _REVIEW_LOCK_STATUSES,
) -> bool:
    """True when `sermon` is locked and the given change would move it.

    An episode in ``pending_review`` / ``under_review`` (the default
    ``locked_statuses``) is an immovable fixed point until the review
    finishes — along BOTH position axes:

    * ``target_episode_number`` — a number different from the current one.
    * ``series_id`` — moving the episode to a different series at all. Pass
      ``series_id_provided=True`` only when the PATCH actually carries
      ``series_id`` (so ``new_series_id=None`` means "detach from its series",
      a real move, not "not supplied").

    Both entry points route through here: the single-row ``PATCH /sermons/{id}``
    (which can change either axis) and the bulk
    ``PUT /series/{id}/episode-order`` (episode number only, which also passes
    ``locked_statuses=tuple(_CONTENT_LOCKED_MESSAGES)`` for a second pass — an
    approved/published episode is equally immovable, same "would this actually
    change its number" logic). A target equal to the current value — or not
    supplied — is not a move, regardless of which lock is being checked.
    """
    if sermon.status not in locked_statuses:
        return False
    if (
        target_episode_number is not None
        and target_episode_number != sermon.episode_number
    ):
        return True
    if series_id_provided and new_series_id != sermon.series_id:
        return True
    return False


class ContentError(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = 400,
        headers: dict[str, str] | None = None,
    ):
        self.message = message
        self.status_code = status_code
        # Optional response headers the router boundary should attach — e.g.
        # `Retry-After` on a 429. Kept on the typed error so the service, which
        # knows the limiter window, is the one that sets it.
        self.headers = headers
        super().__init__(message)


def display_name(full_name: str | None) -> str | None:
    """Best human label for a user: `full_name` when set and non-blank, else
    None. One definition for every DTO that denormalises an actor's name.

    Deliberately no email fallback: an editor reads their own sermon's
    approval log, so falling back to a reviewer's email local-part leaked an
    inferred corporate address. `None` lets the client render "a reviewer"."""
    if full_name and full_name.strip():
        return full_name.strip()
    return None


def public_display_name(full_name: str | None) -> str | None:
    """The name a comment shows to other viewers: first token of `full_name`,
    a space, and the first character of the last token plus a period
    ("Nii Kwame Okai" -> "Nii O."). A single token is returned as-is. Blank or
    None -> None (callers refuse to post before reaching this).

    Never reads email, and computed at read time so a rename applies to
    existing comments. `display_name()` above is a different, unchanged
    contract (full name for staff-facing DTOs)."""
    if not full_name:
        return None
    tokens = full_name.split()
    if not tokens:
        return None
    if len(tokens) == 1:
        return tokens[0]
    return f"{tokens[0]} {tokens[-1][0]}."


# ── Tier & locked resolution ──────────────────────────────────────────────────
def effective_tier(sermon: Sermon, series: Series | None) -> ContentTier:
    if sermon.tier is not None:
        return sermon.tier
    if series is not None:
        return series.tier
    return ContentTier.FREE


# ── Scheduled publish visibility ────────────────────────────────────────────────
# Mirrors announcement_service.is_visible: visibility is computed at read time
# from status + publish_at, not by a background job flipping rows. Sermons
# have no expires_at equivalent (not asked for), so this is the publish_at
# half only — callers pair it with a PUBLISHED status check (VIEWER_VISIBLE_
# STATUSES for a single row, sermon_visibility_clause for a query).
def sermon_publish_time_passed(sermon: Sermon, at: datetime | None = None) -> bool:
    """True when `sermon.publish_at` is unset, or has passed as of `at` (now
    by default)."""
    now = at or datetime.now(timezone.utc)
    publish_at = sermon.publish_at
    if publish_at is not None and publish_at.tzinfo is None:
        publish_at = publish_at.replace(tzinfo=timezone.utc)
    return publish_at is None or publish_at <= now


def sermon_visibility_clause(at: datetime | None = None):
    """SQL predicate for public sermon visibility: PUBLISHED and publish_at
    unset-or-passed. The query-level twin of `sermon_publish_time_passed`
    (paired with VIEWER_VISIBLE_STATUSES), for the list/search queries that
    filter in SQL rather than testing one already-loaded row."""
    now = at or datetime.now(timezone.utc)
    return (
        Sermon.status == SermonStatus.PUBLISHED,
        or_(Sermon.publish_at.is_(None), Sermon.publish_at <= now),
    )


def _thumbnail_url(key: str | None) -> str | None:
    """Turn a stored thumbnail key into a fetchable URL.

    Always a time-limited signed URL against the media bucket, signed at the
    start of a fixed window so it stays identical across requests and the
    app's image cache keeps hitting (`storage_module.stable_image_url`).
    Buckets stay private either way — we never expose a raw object URL.
    """
    if not key:
        return None
    from app.core import storage as storage_module

    try:
        return storage_module.stable_image_url(key)
    except Exception:
        log.warning("thumbnail_url_failed", key=key)
        return None


def to_list_item(
    sermon: Sermon,
    tier: ContentTier,
    has_subscription: bool,
    names: "RefNames | None" = None,
    media_type: str | None = None,
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
        publish_at=sermon.publish_at,
        media_type=media_type,
    )


def renumber_for_display(items: list[SermonListItem]) -> list[SermonListItem]:
    """Overwrite each numbered item's ``episode_number`` with a contiguous
    1..N sequence, in the caller's existing order — display-layer only.

    Per plan W2.3 (mobile L11): the public series-episodes read hides gaps
    left by unpublished/deleted episodes ("episode 3, 4 not yet published" is
    explicitly cut — see the plan) by renumbering on read instead. This never
    touches ``Sermon.episode_number`` in the database; that column stays
    editor-owned data, set by ``PUT /series/{id}/episode-order`` and read
    verbatim by staff via ``GET /sermons?series_id=``. Only this function's
    caller (the public ``GET /series/{id}/episodes``) sees the renumbered
    value.

    Callers must pass items already filtered to the visible set and ordered
    by the real ``episode_number`` (nulls last) — this function renumbers by
    position, it does not sort. An item whose real ``episode_number`` is
    ``None`` stays ``None`` in the response and does not consume a slot in
    the 1..N sequence: an editor who never assigned that episode a number
    shouldn't have one assigned on its behalf. Only items that already carry
    a real number are folded into the contiguous sequence, in their existing
    order.
    """
    numbered_position = 0
    result = []
    for item in items:
        if item.episode_number is None:
            result.append(item)
            continue
        numbered_position += 1
        result.append(item.model_copy(update={"episode_number": numbered_position}))
    return result


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
            .where(*sermon_visibility_clause())
            .order_by(Sermon.published_at.desc().nullslast())
        )
        rows = (await db.execute(stmt)).scalars().all()
        series_map = await _series_map(db, rows)
        names = await load_ref_names(db, rows)
        out = []
        for s in rows:
            tier = effective_tier(s, series_map.get(s.series_id))
            # Cache the tier-resolved shape without the user-specific lock.
            item = to_list_item(s, tier, has_subscription=True, names=names)
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


TRENDING_WINDOW_DAYS = 30


async def list_trending_sermons(
    db: AsyncSession, user: User | None, limit: int = 10
) -> list[SermonListItem]:
    """Published, publicly-visible sermons ranked by how many people played them in
    the last 30 days (Isaac's call: a 30-day window), most-watched first.

    Ranked by viewers, not by summed `play_count` (reviewed 2026-10-21 against Nii's
    phone test): a `PlaybackSession` is one row per user per sermon and its
    `play_count` is that user's lifetime restart count, so summing it let a single
    viewer who replayed one sermon outrank a sermon many people watched, and counted
    replays from before the window whenever the row was touched inside it. Rows whose
    `last_played_at` falls in the window are distinct viewers active in it, which is
    the honest "trending" signal the table holds. Summed plays, then newest-published,
    break ties so the order is stable between refetches.

    Deliberately uncached, unlike `list_published_sermons` — that function
    caches the *entire* catalog because it's identical for everyone and
    expensive to rebuild per request; this is a rolling-window aggregate over
    a catalog this app's actual scale (tens, not millions, of sermons) makes
    cheap to just query directly.
    """
    has_sub = await _has_subscription(db, user)
    since = datetime.now(timezone.utc) - timedelta(days=TRENDING_WINDOW_DAYS)
    capped_limit = max(1, min(limit, 50))

    viewers = func.count(PlaybackSession.id)
    plays = func.coalesce(func.sum(PlaybackSession.play_count), 0)
    stmt = (
        select(Sermon)
        .join(PlaybackSession, PlaybackSession.sermon_id == Sermon.id)
        .where(*sermon_visibility_clause(), PlaybackSession.last_played_at >= since)
        .group_by(Sermon.id)
        .order_by(viewers.desc(), plays.desc(), Sermon.published_at.desc().nullslast(), Sermon.id)
        .limit(_over_fetch(capped_limit))
    )
    rows = (await db.execute(stmt)).scalars().all()
    sermons = _cap_one_per_series(list(rows), capped_limit)
    series_map = await _series_map(db, sermons)
    names = await load_ref_names(db, sermons)

    return [
        to_list_item(sermon, effective_tier(sermon, series_map.get(sermon.series_id)), has_sub, names)
        for sermon in sermons
    ]


# Affinity weights: a category the viewer keeps returning to says more about taste than
# the speaker does — the church has one main speaker, so a speaker match alone ranks
# nearly the whole catalogue equally.
CATEGORY_AFFINITY_WEIGHT = 2
SPEAKER_AFFINITY_WEIGHT = 1
# Candidate pool for recommendations — the whole visible catalogue at this app's scale.
RECOMMENDATION_POOL = 500


async def list_recommended_sermons(
    db: AsyncSession, user: User, limit: int = 10
) -> list[SermonListItem]:
    """Published sermons the caller hasn't played yet, best match first, always
    filled to `limit` when the catalogue has that many unplayed sermons.

    Ranking (reviewed 2026-10-21 against Nii's phone test, which showed a one-card
    shelf): each unplayed sermon scores by how often the caller has played its
    category (weight 2) and its speaker (weight 1), from their own
    `PlaybackSession` rows. Matches come first, highest score first, with a daily
    seeded shuffle only among equal scores (`_daily_shuffle`, so the shelf doesn't
    mirror New Releases yet doesn't jitter on refetch). The shelf is then topped up
    with what's trending, then with the newest remaining unplayed sermons — the old
    version stopped at the matches, so a viewer who had sampled most of a small
    catalogue saw a single card. A viewer with no history gets trending, then newest.

    Anything the caller has ever started is excluded: unfinished ones already sit in
    "Pick up where you left off", finished ones aren't a recommendation. Capped to one
    episode per series, like the other discovery shelves.
    """
    has_sub = await _has_subscription(db, user)
    capped_limit = max(1, min(limit, 50))

    watched = (await db.execute(
        select(Sermon.category_id, Sermon.speaker_id, PlaybackSession.sermon_id)
        .join(Sermon, Sermon.id == PlaybackSession.sermon_id)
        .where(PlaybackSession.user_id == user.id)
    )).all()
    watched_ids = {row[2] for row in watched}
    category_plays: dict[uuid.UUID, int] = {}
    speaker_plays: dict[uuid.UUID, int] = {}
    for category_id, speaker_id, _ in watched:
        if category_id is not None:
            category_plays[category_id] = category_plays.get(category_id, 0) + 1
        if speaker_id is not None:
            speaker_plays[speaker_id] = speaker_plays.get(speaker_id, 0) + 1

    pool_stmt = (
        select(Sermon)
        .where(*sermon_visibility_clause())
        .order_by(Sermon.published_at.desc().nullslast(), Sermon.id)
        .limit(RECOMMENDATION_POOL)
    )
    if watched_ids:
        pool_stmt = pool_stmt.where(Sermon.id.notin_(watched_ids))
    pool = list((await db.execute(pool_stmt)).scalars().all())

    def score(sermon: Sermon) -> int:
        return (
            CATEGORY_AFFINITY_WEIGHT * category_plays.get(sermon.category_id, 0)
            + SPEAKER_AFFINITY_WEIGHT * speaker_plays.get(sermon.speaker_id, 0)
        )

    matches = sorted(
        _daily_shuffle([s for s in pool if score(s) > 0], salt=f"recommended:{user.id}"),
        key=score,
        reverse=True,
    )
    by_id = {s.id: s for s in pool}
    trending_ids = [item.id for item in await list_trending_sermons(db, user, 50)]
    ordered: list[Sermon] = []
    seen: set[uuid.UUID] = set()
    for sermon in [*matches, *(by_id[i] for i in trending_ids if i in by_id), *pool]:
        if sermon.id not in seen:
            seen.add(sermon.id)
            ordered.append(sermon)

    sermons = _cap_one_per_series(ordered, capped_limit)
    series_map = await _series_map(db, sermons)
    names = await load_ref_names(db, sermons)
    return [
        to_list_item(sermon, effective_tier(sermon, series_map.get(sermon.series_id)), has_sub, names)
        for sermon in sermons
    ]


def _over_fetch(limit: int) -> int:
    """How many rows to pull at the SQL layer before `_cap_one_per_series` thins them out
    — capping can drop rows (multiple episodes of one series collapse to one), so fetching
    exactly `limit` rows up front could under-fill a shelf in a series-heavy catalog.
    Generous but bounded: 4x the requested limit, floored at 20, capped at 100."""
    return min(max(limit * 4, 20), 100)


def _cap_one_per_series(sermons: list[Sermon], limit: int) -> list[Sermon]:
    """At most one sermon per series, order preserved — otherwise a discovery shelf
    (Trending, Recommended, Prophet's Catalog, the hero) can show 2-3 episodes of the
    same series back to back, which reads as the shelf being short on real content
    rather than varied. Standalone sermons (`series_id is None`) are never deduped
    against each other. New Releases is deliberately exempt (Isaac's call, session
    2026-09-30) — multiple fresh episodes of the same series *are* the point there.
    Callers over-fetch via `_over_fetch` first since capping can drop rows."""
    seen_series: set[uuid.UUID] = set()
    out: list[Sermon] = []
    for sermon in sermons:
        if sermon.series_id is not None:
            if sermon.series_id in seen_series:
                continue
            seen_series.add(sermon.series_id)
        out.append(sermon)
        if len(out) >= limit:
            break
    return out


def _daily_shuffle(items: list[Sermon], salt: str) -> list[Sermon]:
    """Seeded shuffle, stable for the whole day (changes the next). Home's shelves with no
    intrinsic ordering signal (Prophet's Catalog; Recommended's own affinity matches, which
    the DB otherwise ties by `published_at desc` — the same tiebreak New Releases uses for
    its actual, meaningful ordering) were landing in the exact same order as New Releases
    whenever their candidate sets overlapped, reading as duplicated shelves rather than
    distinct ones (Isaac's call, session 2026-09-30). Plain `ORDER BY RANDOM()` would
    reshuffle on every single refetch — visibly jittering mid-scroll — so the seed is
    date-based (stable within a day) rather than per-request, and salted per shelf/user so
    two shelves — or two different users' Prophet's Catalog — don't coincidentally land on
    the same permutation."""
    seed = f"{date.today().isoformat()}:{salt}"
    shuffled = list(items)
    random.Random(seed).shuffle(shuffled)
    return shuffled


async def next_scheduled_sermon(db: AsyncSession) -> UpcomingSermon | None:
    """The soonest sermon that is PUBLISHED but not yet visible (`publish_at` still in
    the future) — Home's "next message" countdown (Nii's ask, 2026-10-21). None when
    nothing is scheduled. Only the fields in `UpcomingSermon` leave the server (cover
    art included, so the countdown can show it); the sermon itself stays invisible to
    every catalogue read until its time passes."""
    now = datetime.now(timezone.utc)
    stmt = (
        select(Sermon)
        .where(
            Sermon.status == SermonStatus.PUBLISHED,
            Sermon.publish_at.is_not(None),
            Sermon.publish_at > now,
        )
        .order_by(Sermon.publish_at.asc(), Sermon.id)
        .limit(1)
    )
    sermon = (await db.execute(stmt)).scalars().first()
    if sermon is None or sermon.publish_at is None:
        return None
    names = await load_ref_names(db, [sermon])
    return UpcomingSermon(
        id=sermon.id,
        title=sermon.title,
        publish_at=sermon.publish_at,
        thumbnail_url=_thumbnail_url(sermon.thumbnail_key),
        speaker_name=names.speakers.get(sermon.speaker_id) if sermon.speaker_id else None,
        series_title=names.series.get(sermon.series_id) if sermon.series_id else None,
        episode_number=sermon.episode_number,
    )


async def list_new_release_sermons(
    db: AsyncSession, user: User | None, limit: int = 10
) -> list[SermonListItem]:
    """Home's "New Releases" shelf — the same newest-published-first ordering
    `list_hero_sermons` uses, just capped to shelf size via its own query rather than
    slicing the full catalog list client-side — matches `list_trending_sermons`/
    `list_recommended_sermons`'s own pattern. Unlike the hero and every other
    discovery shelf, this one is NOT capped to one-per-series (`_cap_one_per_series`)
    — multiple fresh episodes of the same series showing up here together is exactly
    the point of a "new releases" shelf, not noise to collapse."""
    has_sub = await _has_subscription(db, user)
    stmt = (
        select(Sermon)
        .where(*sermon_visibility_clause())
        .order_by(Sermon.published_at.desc().nullslast())
        .limit(max(1, min(limit, 50)))
    )
    sermons = (await db.execute(stmt)).scalars().all()
    series_map = await _series_map(db, sermons)
    names = await load_ref_names(db, sermons)
    return [
        to_list_item(s, effective_tier(s, series_map.get(s.series_id)), has_sub, names)
        for s in sermons
    ]


async def list_hero_sermons(
    db: AsyncSession, user: User | None, limit: int = 3
) -> list[SermonListItem]:
    """Home's hero carousel — newest-published first (P5's original single-item rule,
    extended to Isaac's ask for a 3-item rotating hero, session 2026-09-30), capped to
    one sermon per series (`_cap_one_per_series`) so the carousel doesn't spend two of
    its three slots on back-to-back episodes of the same series. A dedicated query
    rather than reusing `list_published_sermons` — that function is cached whole-catalog
    and used elsewhere (general browse) where every episode SHOULD appear; capping it
    here would change that contract for every other caller too."""
    has_sub = await _has_subscription(db, user)
    capped_limit = max(1, min(limit, 10))
    stmt = (
        select(Sermon)
        .where(*sermon_visibility_clause())
        .order_by(Sermon.published_at.desc().nullslast())
        .limit(_over_fetch(capped_limit))
    )
    sermons = (await db.execute(stmt)).scalars().all()
    sermons = _cap_one_per_series(sermons, capped_limit)
    series_map = await _series_map(db, sermons)
    names = await load_ref_names(db, sermons)
    return [
        to_list_item(s, effective_tier(s, series_map.get(s.series_id)), has_sub, names)
        for s in sermons
    ]


async def list_prophets_catalog_sermons(
    db: AsyncSession, user: User | None, limit: int = 10
) -> list[SermonListItem]:
    """Home's "Prophet's Catalog" shelf — sermons an editor has manually flagged via
    the admin editor's "Prophet's Catalog" switch (`Sermon.is_prophets_catalog`).
    Purely editorial curation with no inherent order of its own, so the candidate pool
    is capped by recency (same as everywhere else) but *displayed* in a daily-shuffled
    order (`_daily_shuffle`) rather than strict `published_at desc` — otherwise this
    shelf reads as a duplicate of New Releases whenever the two sets overlap. Also capped
    to one sermon per series (`_cap_one_per_series`) for the same reason New Releases is
    exempt from that cap — multiple fresh episodes belong on New Releases, not repeated
    here too."""
    has_sub = await _has_subscription(db, user)
    capped_limit = max(1, min(limit, 50))
    stmt = (
        select(Sermon)
        .where(*sermon_visibility_clause(), Sermon.is_prophets_catalog.is_(True))
        .order_by(Sermon.published_at.desc().nullslast())
        .limit(_over_fetch(capped_limit))
    )
    sermons = (await db.execute(stmt)).scalars().all()
    sermons = _cap_one_per_series(sermons, capped_limit)
    sermons = _daily_shuffle(sermons, salt=f"prophets:{user.id if user else 'anon'}")
    series_map = await _series_map(db, sermons)
    names = await load_ref_names(db, sermons)
    return [
        to_list_item(s, effective_tier(s, series_map.get(s.series_id)), has_sub, names)
        for s in sermons
    ]


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
    names = await load_ref_names(db, [sermon])

    # A sermon carries exactly one rendition (video or audio, never both — mobile
    # download UI's own assumption), so the first media_ref's type is the whole
    # answer. `media_refs` is already eager-loaded for this read; no extra query.
    media_type = sermon.media_refs[0].type.value if sermon.media_refs else None
    base = to_list_item(sermon, tier, has_sub, names, media_type=media_type)
    like_count, liked_by_me = await likes_service.sermon_like_state(
        db, sermon.id, user.id if user is not None else None
    )
    return SermonDetail(
        **base.model_dump(),
        status=sermon.status,
        tags=[t.tag for t in sermon.tags],
        media_refs=sermon.media_refs,
        published_at=sermon.published_at,
        created_at=sermon.created_at,
        like_count=like_count,
        liked_by_me=liked_by_me,
    )


async def _load_sermon_with_detail_rels(
    db: AsyncSession, sermon_id: uuid.UUID
) -> Sermon | None:
    # Defense in depth: `Sermon.status` is validated against `SermonStatus`'s
    # member names by the ORM Enum type (no `values_callable`), so a row
    # whose `status` column holds a string that isn't one of those names
    # (reachable only by writes that bypass the ORM, e.g. raw SQL — every
    # in-app write path sets `status` via the enum member) fails Enum
    # deserialization with a bare `LookupError` during row hydration. A
    # targeted Core read of the raw column lets us treat *that specific,
    # known* failure mode as "not found" before the full ORM query runs.
    # `type_coerce(..., String)` overrides the *result* type SQLAlchemy
    # applies to this expression without changing the SQL (no CAST
    # emitted), so we see the literal string instead of going through the
    # Enum type's result processor — selecting `Sermon.__table__.c.status`
    # directly still carries that column's Enum type and raises identically,
    # so type_coerce is what actually bypasses it. Deliberately not a
    # blanket `except LookupError` around the ORM query below: it also
    # catches `KeyError`/`IndexError`, and would misreport an unrelated
    # corruption (e.g. `MediaRef.type`, eager-loaded by the same query) as
    # "sermon not found".
    raw_status = (await db.execute(
        select(type_coerce(Sermon.__table__.c.status, String))
        .where(Sermon.id == sermon_id)
    )).scalar_one_or_none()
    if raw_status is not None and raw_status not in SermonStatus.__members__:
        log.error(
            "sermon_status_unparseable",
            sermon_id=str(sermon_id),
            raw_status=raw_status,
        )
        raise ContentError("Sermon not found", status_code=404)

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
    is_visible = (
        sermon.status in VIEWER_VISIBLE_STATUSES
        and sermon_publish_time_passed(sermon)
    )
    if not is_visible and not is_staff:
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
    # `tier` stays the resolved effective tier (from `_assemble_sermon_detail`);
    # `tier_override` carries the raw `Sermon.tier` column (NULL = inherit) so
    # the editor's tier radio can tell "inherit" from an explicit "free".
    return SermonAdminDetail(
        **detail.model_dump(),
        updated_at=sermon.updated_at,
        tier_override=sermon.tier,
        is_prophets_catalog=sermon.is_prophets_catalog,
    )


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
        is_prophets_catalog=data.is_prophets_catalog,
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


# A sermon in one of these statuses is content-locked: the approval decision
# (or the publish itself) is done, so editing the fields out from under it —
# even by a manager/admin — would silently invalidate what was reviewed/what
# is live. This is the real guard; a client-side lock is UX only. Keyed by
# status so the 409 message names the one that actually applies.
_CONTENT_LOCKED_MESSAGES: dict[SermonStatus, str] = {
    SermonStatus.APPROVED: (
        "This sermon is approved and locked — publish it, then unpublish to "
        "make changes."
    ),
    SermonStatus.PUBLISHED: (
        "This sermon is published and locked — unpublish it first to make "
        "changes."
    ),
}


async def update_sermon(
    db: AsyncSession, sermon_id: uuid.UUID, data: SermonUpdate, editor: User
) -> Sermon:
    sermon = await _load_editable(db, sermon_id, editor)

    if sermon.status in _CONTENT_LOCKED_MESSAGES:
        raise ContentError(
            _CONTENT_LOCKED_MESSAGES[sermon.status], status_code=409
        )

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

    # An in-review episode's position is locked along both axes — its episode
    # number AND its series. Moving it to another series (even while echoing its
    # current number) is as much a position change as renumbering it. Other
    # field edits on a pending_review / under_review sermon are unaffected. Same
    # predicate the bulk episode-order endpoint uses.
    if episode_position_move_locked(
        sermon,
        target_episode_number=fields.get("episode_number"),
        new_series_id=fields.get("series_id"),
        series_id_provided="series_id" in fields,
    ):
        raise ContentError(
            "This sermon is in review — its position (episode number and "
            "series) is locked until the review finishes.",
            status_code=409,
        )

    for key, value in fields.items():
        setattr(sermon, key, value)

    # Tags are excluded from `fields` on purpose: they are not part of
    # SermonListItem / the cached catalog row, so a tags-only edit never needs
    # to bust a catalog cache entry.
    if data.tags is not None:
        sermon.tags.clear()
        for tag in {t.strip().lower() for t in data.tags if t.strip()}:
            sermon.tags.append(SermonTag(tag=tag))

    await db.commit()
    await db.refresh(sermon)

    # No catalog-cache invalidation here (unlike update_series / the approval
    # transitions): the _CONTENT_LOCKED_MESSAGES guard above already refuses
    # this function's write entirely while `sermon.status == PUBLISHED`, so a
    # PATCH that reaches this point can never be dirtying a cached catalog
    # card in the first place. The only path that mutates a published
    # sermon's fields is unpublish → edit → republish, and `publish`/
    # `unpublish` in `content_service.transition` already invalidate the
    # cache themselves.

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


# Actions whose right to act is gated by the review claim (Batch 6 #9). The
# claim is derived from the audit trail — the actor of the latest ApprovalLog
# row that moved the sermon to `under_review` — not a column on `sermons`.
# `publish` is deliberately absent (Isaac's ruling): publish is not a review
# action, so any manager may publish an approved sermon and a claim left by an
# absent reviewer never blocks publication.
_CLAIM_GATED_ACTIONS: frozenset[str] = frozenset({"approve", "reject", "withdraw"})

# Segregation of duties: the manager who authored a sermon may not review it
# — not "someone else already claimed it" (that's the claim lock above), but
# "you may never claim it at all". Blocks the whole review-entry surface:
# starting a review, taking one over, approving, rejecting. `withdraw` is
# deliberately absent — pulling your own submission back to draft is
# self-correction, the same reasoning that leaves an announcement's `reject`
# ungated on your own content. `publish` is absent too: once legitimately
# approved by someone else, publishing is a mechanical last step, not a
# review decision (mirrors the announcement rule and the existing
# publish-is-never-claim-gated precedent above). Admin bypasses. Covers
# `transition()`'s actions; `take_over_review()` (a separate function, not
# an action in this table) carries the same check inline.
#
# `reject` is in this set for the pending_review/under_review case (rejecting
# your own not-yet-reviewed work is still a review decision), but
# `transition()` carves out `reject` from APPROVED specifically — see the
# comment at that check. `approved` is only reachable via someone else's
# `approve` in the first place, so a self-reject there isn't the same
# conflict of interest.
_SELF_AUTHOR_REVIEW_BLOCKED_ACTIONS: frozenset[str] = frozenset(
    {"start_review", "approve", "reject"}
)
# Enforce the claim only while the sermon is actually in an active review
# (`under_review`). An unclaimed `pending_review` sermon stays open to any
# manager; nothing is gated once the sermon reaches `approved` (publish is open
# to any manager, and there is no other approved-state action a claim holds).
_CLAIM_GATED_STATUSES: frozenset[SermonStatus] = frozenset(
    {SermonStatus.UNDER_REVIEW}
)


# Recency ordering for "rows that landed a sermon in under_review", newest
# first. `created_at` is the discriminator and is stamped app-side at
# microsecond resolution (see the ApprovalLog inserts), so sequential claims —
# a start-review after a reject/resubmit, or a chain of take-overs — order
# strictly by time. The secondary `from_status` key only breaks a genuine
# same-instant tie between a start-review (`from pending_review`) and a
# take-over (`from under_review`), preferring the take-over as the later
# lifecycle step. It does NOT order two take-overs against each other
# (`ApprovalLog.id` is a random uuid4); a truly concurrent pair is prevented
# from forming by the `FOR UPDATE` lock on the claim path, not by this sort.
_CLAIM_RECENCY = (
    ApprovalLog.created_at.desc(),
    case(
        (ApprovalLog.from_status == SermonStatus.UNDER_REVIEW.value, 1), else_=0
    ).desc(),
)


async def _review_claimer_id(
    db: AsyncSession, sermon_id: uuid.UUID
) -> uuid.UUID | None:
    """The manager who currently holds the review claim on a sermon: the actor of
    the most recent ApprovalLog row that set status to `under_review`.

    There is no `review_claimed_by` column — the claim lives in the append-only
    log, so a take-over (which writes a fresh under_review → under_review row with
    the new reviewer as actor) moves it. Mirrors `review_queue_page`'s
    `claimed_actor_sq`. Returns None for a sermon that was never claimed.
    """
    return (await db.execute(
        select(ApprovalLog.actor_id)
        .where(
            ApprovalLog.sermon_id == sermon_id,
            ApprovalLog.to_status == SermonStatus.UNDER_REVIEW.value,
        )
        .order_by(*_CLAIM_RECENCY)
        .limit(1)
    )).scalar_one_or_none()


async def _display_name_for(db: AsyncSession, user_id: uuid.UUID) -> str | None:
    return display_name(
        (await db.execute(
            select(User.full_name).where(User.id == user_id)
        )).scalar_one_or_none()
    )


class _Unset:
    """Sentinel distinguishing "caller didn't pass `publish_at`" (leave the
    row's value alone — the bodyless "publish now" back-compat call) from
    "caller passed `publish_at=None`" (explicit: clear any schedule). A plain
    `None` default can't make that distinction since `None` is itself a valid,
    meaningful value here."""


_UNSET = _Unset()


async def transition(
    db: AsyncSession,
    sermon_id: uuid.UUID,
    action: str,
    actor: User,
    note: str | None = None,
    publish_at: datetime | None | _Unset = _UNSET,
) -> Sermon:
    from app.services.approval import TransitionError

    stmt = select(Sermon).where(Sermon.id == sermon_id)
    # Lock just this row for the claim-relevant actions, so a concurrent
    # take-over (or another claim-gated action) can't interleave between the
    # claim read below and the write. Scope stays tight: only these actions,
    # only the sermon row.
    if action in _CLAIM_GATED_ACTIONS:
        stmt = stmt.with_for_update()
    sermon = (await db.execute(stmt)).scalar_one_or_none()
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

    # Transition legality first: an illegal action is 409 for everyone,
    # whoever holds the claim. Only then the claim 403 — so it fires solely for
    # an action that would otherwise be allowed, not for an illegal one that a
    # non-claimer happens to attempt.
    try:
        new_status = resolve_transition(action, sermon.status, actor.role)
    except TransitionError as exc:
        raise ContentError(exc.message, status_code=409)

    # Segregation of duties: a manager cannot review their own sermon at all
    # (see _SELF_AUTHOR_REVIEW_BLOCKED_ACTIONS). Checked after legality so an
    # action that's illegal from this status 409s for everyone, self-authored
    # or not — this 403 fires only for an action that would otherwise be
    # allowed.
    #
    # Carve-out: `reject` from APPROVED is not gated even for the sermon's own
    # author. By the time a sermon reaches `approved`, self-approval is
    # already blocked above, so someone else must have made that call — the
    # conflict of interest `approve` guards against isn't present when the
    # author later rejects (pulls back) their own already-approved sermon.
    # That's self-correction equivalent to `withdraw` (never gated), not a
    # review decision needing a second person — mirrors the announcement
    # precedent that `reject` is never self-gated there either.
    if (
        action in _SELF_AUTHOR_REVIEW_BLOCKED_ACTIONS
        and not (action == "reject" and sermon.status == SermonStatus.APPROVED)
        and sermon.created_by == actor.id
        and actor.role != UserRole.ADMIN
    ):
        raise ContentError(
            "You submitted this sermon — another manager needs to review it",
            status_code=403,
        )

    # Review-claim lock (Batch 6 #9): while a sermon is `under_review`, only the
    # manager who claimed it (via start-review or take-over) — or an admin —
    # may approve / reject / withdraw it. An unclaimed `pending_review` sermon
    # is open to any manager; `approved` is not gated (publish stays open).
    if action in _CLAIM_GATED_ACTIONS and sermon.status in _CLAIM_GATED_STATUSES:
        claimer_id = await _review_claimer_id(db, sermon.id)
        if (
            claimer_id is not None
            and claimer_id != actor.id
            and actor.role != UserRole.ADMIN
        ):
            claimer_name = await _display_name_for(db, claimer_id)
            raise ContentError(
                "review_claimed_by_another"
                + (f": {claimer_name}" if claimer_name else ""),
                status_code=403,
            )

    from_status = sermon.status
    sermon.status = new_status
    if new_status == SermonStatus.PUBLISHED:
        sermon.published_at = datetime.now(timezone.utc)

    # `publish_at` is only meaningful on the `publish` action, and only when
    # the caller actually passed one. Explicit `None` fully replaces whatever
    # was on the row (no gate — publishes now); omitting the kwarg entirely
    # (the bodyless back-compat "publish now" call) leaves it untouched.
    if action == "publish" and not isinstance(publish_at, _Unset):
        sermon.publish_at = publish_at

    db.add(ApprovalLog(
        sermon_id=sermon.id,
        from_status=from_status.value,
        to_status=new_status.value,
        actor_id=actor.id,
        note=note,
        # Stamp the transition instant app-side rather than leaning on the
        # column's `server_default=func.now()`. `now()` resolves to the
        # transaction start and, on some backends, to whole seconds — two
        # sequential claims (start-review after a reject/resubmit, or a second
        # take-over) would then tie, and `_review_claimer_id` could not tell
        # which is current. A microsecond Python timestamp orders them.
        created_at=datetime.now(timezone.utc),
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


async def take_over_review(
    db: AsyncSession, sermon_id: uuid.UUID, actor: User
) -> Sermon:
    """Reassign an in-progress review to `actor` (Batch 6 #9).

    Valid only while the sermon is `under_review`. Status is unchanged; the
    hand-off is recorded as an ApprovalLog row (under_review → under_review) whose
    actor is the new reviewer, which is what moves the derived claim
    (`_review_claimer_id`). If `actor` already holds the claim this is a 409
    no-op rather than a duplicate log row.

    The sermon row is locked `FOR UPDATE` for the duration: two concurrent
    take-overs (or a take-over racing an approve) serialise on it — one wins,
    the other re-reads the committed claim / status and is gated or 422'd.
    """
    sermon = (await db.execute(
        select(Sermon).where(Sermon.id == sermon_id).with_for_update()
    )).scalar_one_or_none()
    if sermon is None:
        raise ContentError("Sermon not found", status_code=404)
    if sermon.status != SermonStatus.UNDER_REVIEW:
        raise ContentError(
            f"cannot take over a sermon in status '{sermon.status.value}'",
            status_code=422,
        )

    # Segregation of duties (see _SELF_AUTHOR_REVIEW_BLOCKED_ACTIONS): the
    # sermon's own author may not take over its review either — taking over is
    # a review-entry action, same as start-review.
    if sermon.created_by == actor.id and actor.role != UserRole.ADMIN:
        raise ContentError(
            "You submitted this sermon — another manager needs to review it",
            status_code=403,
        )

    claimer_id = await _review_claimer_id(db, sermon.id)
    if claimer_id == actor.id:
        raise ContentError("already_reviewing", status_code=409)

    prev_name = (
        await _display_name_for(db, claimer_id)
        if claimer_id is not None
        else None
    )
    note = f"Review taken over from {prev_name}" if prev_name else "Review taken over"
    db.add(ApprovalLog(
        sermon_id=sermon.id,
        from_status=SermonStatus.UNDER_REVIEW.value,
        to_status=SermonStatus.UNDER_REVIEW.value,
        actor_id=actor.id,
        note=note,
        # App-side timestamp so a chain of take-overs orders strictly by time —
        # see the note on the `transition` insert.
        created_at=datetime.now(timezone.utc),
    ))
    await db.commit()
    await db.refresh(sermon)

    log.info(
        "sermon_review_taken_over",
        sermon_id=str(sermon.id),
        by=str(actor.id),
        from_claimer=str(claimer_id) if claimer_id is not None else None,
    )
    return sermon


async def review_queue_page(
    db: AsyncSession, limit: int = 25, offset: int = 0
) -> tuple[list[ReviewQueueItem], int]:
    """Sermons in pending_review / under_review / approved, longest-waiting first.

    Pagination shape mirrors `list_sermons_for_staff`: returns (page, total)
    where `total` is the count before limit/offset so the W10 screen can size
    its pager.

    `approved` sermons stay in the queue (Batch 6 #12): "approve only" is not the
    end of the workflow — the sermon is still waiting to be published. Publishing
    it (→ `published`) drops it out. A `rejected` sermon is not in the queue.

    Two per-row values come from correlated subqueries against `approval_log`
    rather than new columns:

    * `submitted_at` — `max(created_at)` over the rows that moved this sermon
      to `pending_review` (the editor's last submit / resubmit). It is also the
      sort key: ascending, so the longest wait sits at the top. An `approved`
      row carries the same `max(created_at)` of its `pending_review` rows, so it
      ages in place on the waiting-time key rather than jumping the queue.
    * `review_claimed_by` — the actor of the most recent `to_status =
      under_review` row, resolved to a display name; populated for `under_review`
      and `approved` items. It is the manager who most recently claimed the
      sermon (start-review or take-over) — not necessarily whoever ran
      `approve`, which an admin or a peer manager may have done.
    """
    statuses = (
        SermonStatus.PENDING_REVIEW,
        SermonStatus.UNDER_REVIEW,
        SermonStatus.APPROVED,
    )
    claimed_statuses = (SermonStatus.UNDER_REVIEW, SermonStatus.APPROVED)
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
    # Render the subquery once (SELECT) and order by its label, not the
    # expression again — one execution per row instead of two.
    submitted_at_col = submitted_at_sq.label("submitted_at")
    claimed_actor_sq = (
        select(ApprovalLog.actor_id)
        .where(
            ApprovalLog.sermon_id == Sermon.id,
            ApprovalLog.to_status == SermonStatus.UNDER_REVIEW.value,
        )
        .order_by(*_CLAIM_RECENCY)
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
            submitted_at_col,
            claimed_actor_sq.label("claimed_actor_id"),
        )
        .where(base_where)
        .order_by(
            nullslast(literal_column("submitted_at").asc()),
            Sermon.created_at.asc(),
        )
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

    actor_ids = {row[2] for row in rows if row[2] is not None} | {
        row[0].created_by for row in rows
    }
    actor_names: dict[uuid.UUID, str | None] = {}
    if actor_ids:
        for uid, full_name in (await db.execute(
            select(User.id, User.full_name).where(User.id.in_(actor_ids))
        )).all():
            actor_names[uid] = display_name(full_name)

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
            thumbnail_url=_thumbnail_url(sermon.thumbnail_key),
            created_by=sermon.created_by,
            created_by_name=actor_names.get(sermon.created_by),
            episode_number=sermon.episode_number,
            tier=effective_tier(sermon, series_map.get(sermon.series_id)),
            status=sermon.status,
            submitted_at=submitted_at,
            renditions_ready=media_counts.get(sermon.id, 0),
            review_claimed_by=(
                actor_names.get(claimed_actor_id)
                if sermon.status in claimed_statuses
                else None
            ),
            review_claimed_by_id=(
                claimed_actor_id
                if sermon.status in claimed_statuses
                else None
            ),
        )
        for sermon, submitted_at, claimed_actor_id in rows
    ]
    return items, total


async def _approval_log_items(
    db: AsyncSession, sermon_id: uuid.UUID
) -> list[ApprovalLogItem]:
    """Approval-log rows for a sermon, oldest first, each carrying the actor's
    display name (left join on `users`; NULL-safe if the row's actor was
    since deleted — RESTRICT makes that rare, not impossible)."""
    rows = (await db.execute(
        select(ApprovalLog, User.full_name)
        .outerjoin(User, User.id == ApprovalLog.actor_id)
        .where(ApprovalLog.sermon_id == sermon_id)
        .order_by(ApprovalLog.created_at.asc())
    )).all()
    return [
        ApprovalLogItem(
            from_status=entry.from_status,
            to_status=entry.to_status,
            actor_id=entry.actor_id,
            actor_name=display_name(full_name),
            note=entry.note,
            created_at=entry.created_at,
        )
        for entry, full_name in rows
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


# ── Public-DTO count scoping (Option B) ──────────────────────────────────────
# `sermon_count` / `episode_count` on CategoryPublic / SpeakerPublic /
# SeriesPublic ride on routes that have no auth dependency. Counting every
# status there lets an anonymous caller diff the DTO count against the published
# catalog and read the size of the draft / pending / rejected pipeline. So the
# count is scoped to who is asking:
#   * unauthenticated, or a `viewer`  -> PUBLISHED sermons only
#   * editor / manager / admin        -> the true, all-status count
# The staff portal always calls these authenticated (through the BFF), so it
# keeps accurate totals for the W12 delete-confirmation copy and the people
# screens. `user` may be a `User` or the lighter `CurrentUser` — both carry
# `.role` — or `None`.
_FULL_COUNT_ROLES = (UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN)


def staff_sees_full_counts(user: object | None) -> bool:
    """True when `user` should see the unfiltered (all-status) public-DTO
    counts. The single predicate the six/seven public read routes share so the
    role tuple is not inlined per route."""
    return user is not None and getattr(user, "role", None) in _FULL_COUNT_ROLES


def _published_only_count_clause(include_unpublished: bool):
    """The extra WHERE term that scopes a `sermon_count` subquery to published
    content, or nothing when the caller is entitled to the full count."""
    return [] if include_unpublished else [Sermon.status == SermonStatus.PUBLISHED]


def _category_public_stmt(include_unpublished: bool):
    """Category rows + a correlated count of the sermons attached to each.

    `include_unpublished=False` scopes the count to published sermons — see
    `staff_sees_full_counts`.
    """
    sermon_count = (
        select(func.count(Sermon.id))
        .where(
            Sermon.category_id == Category.id,
            *_published_only_count_clause(include_unpublished),
        )
        .correlate(Category)
        .scalar_subquery()
        .label("sermon_count")
    )
    return select(Category, sermon_count)


async def list_categories_with_counts(
    db: AsyncSession, include_unpublished: bool = False
) -> list[tuple[Category, int]]:
    stmt = _category_public_stmt(include_unpublished).order_by(Category.name)
    return [tuple(row) for row in (await db.execute(stmt)).all()]


async def get_category_with_count(
    db: AsyncSession, category_id: uuid.UUID, include_unpublished: bool = False
) -> tuple[Category, int]:
    row = (await db.execute(
        _category_public_stmt(include_unpublished).where(Category.id == category_id)
    )).one_or_none()
    if row is None:
        raise ContentError("Category not found", status_code=404)
    return tuple(row)


def category_to_public(cat: Category, sermon_count: int) -> dict:
    """Category fields + its sermon count, for the API layer (mirrors
    `series_to_public`)."""
    return {
        "id": cat.id,
        "name": cat.name,
        "slug": cat.slug,
        "sermon_count": sermon_count,
    }


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
    # category_name rides on every cached catalog card.
    if name is not None:
        await invalidate_catalog_cache()
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


def _speaker_public_stmt(include_unpublished: bool):
    """Speaker rows + a correlated count of the sermons attached to each.

    `include_unpublished=False` scopes the count to published sermons — see
    `staff_sees_full_counts`.
    """
    sermon_count = (
        select(func.count(Sermon.id))
        .where(
            Sermon.speaker_id == Speaker.id,
            *_published_only_count_clause(include_unpublished),
        )
        .correlate(Speaker)
        .scalar_subquery()
        .label("sermon_count")
    )
    return select(Speaker, sermon_count)


async def list_speakers_with_counts(
    db: AsyncSession, include_unpublished: bool = False
) -> list[tuple[Speaker, int]]:
    stmt = _speaker_public_stmt(include_unpublished).order_by(Speaker.name)
    return [tuple(row) for row in (await db.execute(stmt)).all()]


async def get_speaker_with_count(
    db: AsyncSession, speaker_id: uuid.UUID, include_unpublished: bool = False
) -> tuple[Speaker, int]:
    row = (await db.execute(
        _speaker_public_stmt(include_unpublished).where(Speaker.id == speaker_id)
    )).one_or_none()
    if row is None:
        raise ContentError("Speaker not found", status_code=404)
    return tuple(row)


def speaker_to_public(speaker: Speaker, sermon_count: int) -> dict:
    """Speaker fields + its sermon count, for the API layer (mirrors
    `series_to_public`)."""
    return {
        "id": speaker.id,
        "name": speaker.name,
        "bio": speaker.bio,
        "sermon_count": sermon_count,
    }


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
    # speaker_name rides on every cached catalog card.
    if name is not None:
        await invalidate_catalog_cache()
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


# Per-series episode count + resolved category name, computed in the read query
# via a correlated count subquery + an outer join (same style as
# `review_queue_page`'s per-row subqueries). One query, no round-trip per row.
def _series_public_stmt(include_unpublished: bool, viewer_id: uuid.UUID | None = None):
    """Series rows + a correlated episode count, the resolved category name,
    and (Isaac's ask, session 2026-10-09) a correlated like count + whether
    `viewer_id` has liked each row.

    `include_unpublished=False` scopes the episode count to published sermons —
    see `staff_sees_full_counts`. `viewer_id=None` (anonymous) still runs the
    `liked_by_me` subquery rather than branching it away — `SeriesLike.user_id
    == None` renders as `IS NULL`, which a NOT NULL column can never match, so
    it already always resolves to `false` without a second code path.
    """
    episode_count = (
        select(func.count(Sermon.id))
        .where(
            Sermon.series_id == Series.id,
            *_published_only_count_clause(include_unpublished),
        )
        .correlate(Series)
        .scalar_subquery()
        .label("episode_count")
    )
    like_count = (
        select(func.count(SeriesLike.id))
        .where(SeriesLike.series_id == Series.id)
        .correlate(Series)
        .scalar_subquery()
        .label("like_count")
    )
    liked_by_me = (
        select(func.count(SeriesLike.id) > 0)
        .where(SeriesLike.series_id == Series.id, SeriesLike.user_id == viewer_id)
        .correlate(Series)
        .scalar_subquery()
        .label("liked_by_me")
    )
    return select(
        Series, episode_count, Category.name.label("category_name"), like_count, liked_by_me
    ).outerjoin(Category, Category.id == Series.category_id)


async def list_series(
    db: AsyncSession, include_unpublished: bool = False, viewer_id: uuid.UUID | None = None
) -> list[tuple[Series, int, str | None, int, bool]]:
    stmt = _series_public_stmt(include_unpublished, viewer_id).order_by(Series.title)
    return [tuple(row) for row in (await db.execute(stmt)).all()]


async def get_series_public(
    db: AsyncSession, series_id: uuid.UUID, include_unpublished: bool = False, viewer_id: uuid.UUID | None = None
) -> tuple[Series, int, str | None, int, bool]:
    row = (await db.execute(
        _series_public_stmt(include_unpublished, viewer_id).where(Series.id == series_id)
    )).one_or_none()
    if row is None:
        raise ContentError("Series not found", status_code=404)
    return tuple(row)


# Series publish is manager/admin-only and only draft <-> published (unpublish).
_SERIES_STATUS_TRANSITIONS = {
    (SermonStatus.DRAFT, SermonStatus.PUBLISHED),
    (SermonStatus.PUBLISHED, SermonStatus.DRAFT),
}


def _check_series_status_change(
    series: Series, new_status: SermonStatus | None, editor: User
) -> None:
    """Guard the privileged `status` field on `SeriesUpdate`.

    No-op first: ``status`` absent from the resolved payload, an explicit
    ``null`` (which the ``SermonStatus | None`` schema permits — it must not
    500), or a value equal to the current status are all silent passes, with no
    role check. This lets an editor send a full-object PATCH that echoes the
    unchanged ``status`` alongside a real edit without a spurious 403.

    Only then: a real change is manager/admin-only (editor -> 403, mirroring the
    other privileged-field guards here), and restricted to ``draft ->
    published`` / ``published -> draft``; any other target is 422.
    """
    if new_status is None or new_status == series.status:
        return
    if editor.role == UserRole.EDITOR:
        raise ContentError(
            "Only a manager can publish or unpublish a series", status_code=403
        )
    if (series.status, new_status) not in _SERIES_STATUS_TRANSITIONS:
        raise ContentError(
            "A series can only move between draft and published, not "
            f"{series.status.value} -> {new_status.value}",
            status_code=422,
        )


async def update_series(
    db: AsyncSession, series_id: uuid.UUID, fields: dict, editor: User
) -> None:
    """Apply a `SeriesUpdate` patch. The router re-reads via `get_series_public`
    for the response, so nothing is returned here."""
    series = await get_series(db, series_id)
    if editor.role == UserRole.EDITOR and series.created_by != editor.id:
        raise ContentError("You can only edit your own series", status_code=403)

    if "status" in fields:
        _check_series_status_change(series, fields["status"], editor)
        # An explicit `{"status": null}` is a schema-legal no-op (guarded
        # above). Drop it so the write loop below can't null a non-nullable
        # column.
        if fields["status"] is None:
            del fields["status"]

    if "category_id" in fields and fields["category_id"] is not None:
        if await db.get(Category, fields["category_id"]) is None:
            raise ContentError("category_id does not exist", status_code=400)

    tier_changed = "tier" in fields and fields["tier"] != series.tier
    title_changed = "title" in fields and fields["title"] != series.title
    for key, value in fields.items():
        setattr(series, key, value)
    await db.commit()

    # A tier change alters the effective tier of inheriting episodes in the
    # public catalog, and series_title rides on each episode's cached card,
    # so either one busts the cache.
    if tier_changed or title_changed:
        await invalidate_catalog_cache()


async def delete_series(db: AsyncSession, series_id: uuid.UUID) -> None:
    series = await get_series(db, series_id)
    # sermons.series_id is ON DELETE SET NULL — episodes become standalone
    # sermons rather than being deleted.
    await db.delete(series)
    await db.commit()
    await invalidate_catalog_cache()


def _id_list(ids) -> str:
    """Deterministic comma-joined id list for a validation message."""
    return ", ".join(sorted(str(i) for i in ids))


async def reorder_series_episodes(
    db: AsyncSession,
    series_id: uuid.UUID,
    episode_ids: list[uuid.UUID],
    actor: User,
) -> list[Sermon]:
    """Bulk, atomic reorder of a series' episodes.

    ``episode_ids`` is the full ordered list of the series' episode (sermon)
    ids. It must be *exactly* the series' current episode set — every id a
    sermon with ``series_id == series_id``, with nothing missing, nothing
    extra, and no duplicates — otherwise 422 (the message lists what is wrong).

    Episodes are renumbered ``1..N`` by position, matching
    ``next_episode_number`` (1-based). An episode in ``pending_review`` /
    ``under_review``, or ``approved`` / ``published``, is an immovable fixed
    point: if the new order would change its number the whole operation is
    refused with 409, naming the locked episode(s) (two separate checks, two
    separate messages, so the caller knows which lock applies). All rows are
    written in one transaction or none.

    NOTE (known race, accepted): the episode set is read with a plain SELECT —
    no ``FOR UPDATE``, no version check. Two managers reordering the same series
    concurrently both read, both validate, and the later commit wins; the
    loser's ordering is silently overwritten. This is manager/admin-gated and
    single-series, so contention is near zero, and ``next_episode_number``
    already documents accepting the same class of race on create. Revisit with
    row locking only if reorder contention ever shows up in practice.
    """
    series = await get_series(db, series_id)  # 404 if missing

    rows = list((await db.execute(
        select(Sermon).where(Sermon.series_id == series.id)
    )).scalars().all())
    by_id = {s.id: s for s in rows}
    current_ids = set(by_id)

    seen: set[uuid.UUID] = set()
    dupes: set[uuid.UUID] = set()
    for eid in episode_ids:
        if eid in seen:
            dupes.add(eid)
        seen.add(eid)
    missing = current_ids - seen
    extra = seen - current_ids

    if dupes or missing or extra:
        problems: list[str] = []
        if missing:
            problems.append(f"missing episode(s): {_id_list(missing)}")
        if extra:
            problems.append(f"not an episode of this series: {_id_list(extra)}")
        if dupes:
            problems.append(f"listed more than once: {_id_list(dupes)}")
        raise ContentError(
            "episode_ids must be exactly this series' episodes — "
            + "; ".join(problems),
            status_code=422,
        )

    locked = [
        by_id[eid]
        for position, eid in enumerate(episode_ids, start=1)
        if episode_position_move_locked(by_id[eid], target_episode_number=position)
    ]
    if locked:
        named = ", ".join(
            f"{s.title!r} (episode {s.episode_number})" for s in locked
        )
        raise ContentError(
            "Can't reorder — these episodes are in review and their position is "
            f"locked: {named}",
            status_code=409,
        )

    # Same immovable-position rule extends to APPROVED/PUBLISHED episodes
    # (ADR 0008 §1's content lock) — this endpoint mutates the identical
    # `episode_number` column `PATCH /sermons/{id}` already refuses to touch on
    # those statuses, so it must refuse it too. Reuses the same "would this
    # position actually change" predicate, just against the content-locked
    # statuses instead of the review-locked ones — a no-op position (staying
    # at its current number while others shuffle around it) is allowed, same
    # as the review-lock case above.
    content_locked = [
        by_id[eid]
        for position, eid in enumerate(episode_ids, start=1)
        if episode_position_move_locked(
            by_id[eid],
            target_episode_number=position,
            locked_statuses=tuple(_CONTENT_LOCKED_MESSAGES),
        )
    ]
    if content_locked:
        named = ", ".join(
            f"{s.title!r} (episode {s.episode_number})" for s in content_locked
        )
        raise ContentError(
            "Can't reorder — these episodes are approved or published and "
            f"their position is locked: {named}",
            status_code=409,
        )

    for position, eid in enumerate(episode_ids, start=1):
        by_id[eid].episode_number = position
    await db.commit()

    ordered = [by_id[eid] for eid in episode_ids]

    # episode_number rides on the cached public catalog card for a published
    # episode — bust the cache if any moved (mirrors update_sermon).
    if any(s.status == SermonStatus.PUBLISHED for s in ordered):
        await invalidate_catalog_cache()

    log.info(
        "series_episodes_reordered",
        series_id=str(series.id),
        count=len(ordered),
        by=str(actor.id),
    )
    return ordered


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
    category_id: uuid.UUID | None = None,
    tier: ContentTier | None = None,
    author_id: uuid.UUID | None = None,
) -> tuple[list[Sermon], int]:
    """Editors see their own sermons across all statuses; managers/admins see
    everyone's. Returns (rows, total) — total is the count before paging, so a
    CMS can size its pager.

    `author_id` is an *additional* narrowing on top of the role scope — it
    powers the editor Dashboard's "your work in progress" cards (`created_by=me`)
    and lets a manager/admin voluntarily restrict the list to their own
    sermons. It never widens what a role may see: an editor is already confined
    to their own rows by `editor_scope_filter`, so passing their own id is a
    no-op, and passing someone else's still returns nothing.
    """
    conditions = []
    scope_clause = editor_scope_filter(requester)
    if scope_clause is not None:
        conditions.append(scope_clause)
    if author_id is not None:
        conditions.append(Sermon.created_by == author_id)
    if status_filter is not None:
        conditions.append(Sermon.status == status_filter)
    if search:
        conditions.append(func.lower(Sermon.title).like(f"%{search.lower()}%"))
    if speaker_id is not None:
        conditions.append(Sermon.speaker_id == speaker_id)
    if series_id is not None:
        conditions.append(Sermon.series_id == series_id)
    if category_id is not None:
        conditions.append(Sermon.category_id == category_id)

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
        settings.object_store_media_bucket, key, content_type,
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

    # Same content lock as `update_sermon` (ADR 0008 §1): a sermon's thumbnail
    # rides on the cached public catalog card exactly like its other fields, so
    # swapping it out from under an approved/published sermon would silently
    # invalidate what was reviewed/what is live, same as any other field edit.
    # Series-only: `kind == "series"` never reaches an approval workflow at
    # all (a series is draft/published only, via `update_series`, which has no
    # equivalent lock on PUBLISHED) — nothing to extend there.
    if kind == "sermons" and entity.status in _CONTENT_LOCKED_MESSAGES:
        raise ContentError(
            _CONTENT_LOCKED_MESSAGES[entity.status], status_code=409
        )

    # The key is supplied by the client, so confine it to this entity's prefix —
    # otherwise a caller could point their thumbnail at any object in the bucket.
    expected_prefix = f"thumbnails/{kind}/{entity.id}/"
    if not key.startswith(expected_prefix):
        raise ContentError("Thumbnail key does not belong to this item", 400)

    store = storage_module.get_storage()
    if not store.object_exists(settings.object_store_media_bucket, key):
        raise ContentError(
            "No uploaded image found — complete the PUT first", status_code=409
        )

    # The presign signature pins content-type but not length — a client can PUT
    # a multi-GB "image". Re-check the real object size, mirroring the Batch-2
    # media-confirm fix. `None` (stub backend / size unknowable) → proceed, as
    # the media path does; a concrete oversize → delete the object and 413.
    size = store.object_size(settings.object_store_media_bucket, key)
    if size is not None and size > settings.max_thumbnail_bytes:
        try:
            store.delete_object(settings.object_store_media_bucket, key)
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
