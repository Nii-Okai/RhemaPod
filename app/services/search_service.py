"""Sermon search.

PostgreSQL full-text search, no separate search cluster. At this scale that is
the right trade: Elasticsearch would add a service to run, a sync pipeline to
keep correct, and a whole class of "the index is stale" bugs — to answer
queries Postgres handles comfortably.

`to_tsvector` gives stemming and ranking, so "preaching" matches "preach" and
a title hit outranks a body hit. On SQLite (tests) it falls back to LIKE, which
has no stemming but exercises the same filters and pagination.
"""
from __future__ import annotations

import uuid

from sqlalchemy import String, cast, func, literal_column, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.content_schemas import SeriesPublic, SpeakerPublic
from app.models.models import (
    ContentTier,
    Sermon,
    SermonTag,
    Series,
    Speaker,
    User,
)
from app.services.content_service import (
    _has_subscription,
    _series_public_stmt,
    _speaker_public_stmt,
    effective_tier,
    load_ref_names,
    series_to_public,
    sermon_visibility_clause,
    speaker_to_public,
    staff_sees_full_counts,
    to_list_item,
)

log = get_logger("search")

MAX_LIMIT = 50

# Series/speaker matches shown alongside sermon results (three-way search
# grouping). Small and fixed — these are a "jump to the series/speaker page"
# shortcut, not a paginated list; `GET /series` and `GET /speakers` already
# exist for browsing the full set. `*_total` (the true match count) rides
# alongside so the client can offer "see all N" without a second round trip.
GROUP_LIMIT = 5


def _is_postgres(db: AsyncSession) -> bool:
    return db.bind.dialect.name == "postgresql"


def _weighted_vector(columns_weights: list[tuple]):
    """A `setweight`-combined tsvector across one or more (column, weight)
    pairs — weight "A" ranks above "B", etc. (Postgres only.)

    `setweight`'s second argument is Postgres's internal `"char"` type, which a
    plain SQL string literal ('A') coerces to but a bound `varchar` parameter
    does not — SQLAlchemy binds a Python str as `varchar` by default, which
    500s with "function setweight(tsvector, character varying) does not
    exist". `literal_column` inlines it as a raw SQL literal instead of a
    bind parameter, sidestepping that entirely. `weight` here is always one
    of this module's own single-char constants ("A"/"B"), never caller/user
    input, so inlining it is safe.
    """
    vector = None
    for column, weight in columns_weights:
        term = func.setweight(
            func.to_tsvector("english", func.coalesce(column, "")), literal_column(f"'{weight}'")
        )
        vector = term if vector is None else vector.op("||")(term)
    return vector


def _text_search_filter(db: AsyncSession, columns_weights: list[tuple], query: str):
    """Build the text-match condition for the active dialect, across one or
    more weighted columns. Postgres: full-text (`to_tsvector`/`plainto_
    tsquery`), so stemming applies and a higher-weighted column outranks a
    lower one. SQLite (tests): `LIKE`, which has no stemming but exercises the
    same filters — matching any of the given columns."""
    if _is_postgres(db):
        vector = _weighted_vector(columns_weights)
        return vector.op("@@")(func.plainto_tsquery("english", query))

    like = f"%{query.lower()}%"
    return or_(*(
        func.lower(func.coalesce(column, "")).like(like)
        for column, _ in columns_weights
    ))


def _text_rank(db: AsyncSession, columns_weights: list[tuple], query: str):
    """`ts_rank` order (Postgres) for the same weighted columns, or `None` on
    SQLite — callers fall back to a deterministic column order there."""
    if not _is_postgres(db):
        return None
    vector = _weighted_vector(columns_weights)
    return func.ts_rank(vector, func.plainto_tsquery("english", query)).desc()


def _search_filter(db: AsyncSession, query: str):
    return _text_search_filter(
        db, [(Sermon.title, "A"), (Sermon.description, "B")], query
    )


def _rank(db: AsyncSession, query: str):
    rank = _text_rank(db, [(Sermon.title, "A"), (Sermon.description, "B")], query)
    return rank if rank is not None else Sermon.published_at.desc().nullslast()


async def search_sermons(
    db: AsyncSession,
    user: User | None,
    query: str | None = None,
    category_id: uuid.UUID | None = None,
    speaker_id: uuid.UUID | None = None,
    series_id: uuid.UUID | None = None,
    tier: ContentTier | None = None,
    tag: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list, int]:
    """Search published, visible sermons. Returns (items, total).

    Only visible content is searchable — an unpublished sermon, or one whose
    `publish_at` hasn't arrived yet, must not be discoverable through search
    when it is hidden everywhere else (mirrors the catalog gate).
    """
    limit = max(1, min(limit, MAX_LIMIT))
    offset = max(0, offset)

    conditions = list(sermon_visibility_clause())

    if query:
        conditions.append(_search_filter(db, query))
    if category_id is not None:
        conditions.append(Sermon.category_id == category_id)
    if speaker_id is not None:
        conditions.append(Sermon.speaker_id == speaker_id)
    if series_id is not None:
        conditions.append(Sermon.series_id == series_id)
    if tag:
        conditions.append(
            Sermon.id.in_(
                select(SermonTag.sermon_id).where(SermonTag.tag == tag.strip().lower())
            )
        )

    # Effective tier = sermon.tier ?? series.tier ?? free — the SQL form of
    # content_service.effective_tier. Filter it in SQL so `total` and the
    # returned page are built from one condition list and cannot disagree
    # (a Python post-filter left `total` counting the pre-filter set).
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

    order = _rank(db, query) if query else Sermon.published_at.desc().nullslast()
    rows = (await db.execute(
        page_stmt.where(*conditions).order_by(order).limit(limit).offset(offset)
    )).scalars().all()

    # series_map still resolves the effective tier on the returned items (it can
    # be inherited from the series). It is NOT collapsed into the join above —
    # that is a separate deferred cleanup.
    series_ids = {s.series_id for s in rows if s.series_id}
    series_map = {}
    if series_ids:
        series_rows = (await db.execute(
            select(Series).where(Series.id.in_(series_ids))
        )).scalars().all()
        series_map = {s.id: s for s in series_rows}

    has_sub = await _has_subscription(db, user)
    names = await load_ref_names(db, rows)
    items = []
    for sermon in rows:
        resolved = effective_tier(sermon, series_map.get(sermon.series_id))
        items.append(to_list_item(sermon, resolved, has_sub, names))

    log.info("search", query=query or "", results=len(items), total=total)
    return items, total


async def search_series(
    db: AsyncSession, user: User | None, query: str, limit: int = GROUP_LIMIT
) -> tuple[list[SeriesPublic], int]:
    """Series whose title or description matches `query`, for the search
    screen's "series" group. Visibility and DTO shape are exactly `GET
    /series`'s (same `_series_public_stmt`/`series_to_public`, same
    `staff_sees_full_counts` count scoping) — this does not reinvent them.

    Returns (top `limit` matches ordered like sermon search, true match
    count).
    """
    columns = [(Series.title, "A"), (Series.description, "B")]
    condition = _text_search_filter(db, columns, query)
    include_unpublished = staff_sees_full_counts(user)

    total = (await db.execute(
        select(func.count()).select_from(Series).where(condition)
    )).scalar_one()

    rank = _text_rank(db, columns, query)
    order = rank if rank is not None else Series.title.asc()
    viewer_id = user.id if user is not None else None
    rows = (await db.execute(
        _series_public_stmt(include_unpublished, viewer_id).where(condition)
        .order_by(order).limit(limit)
    )).all()

    items = [
        SeriesPublic(
            **series_to_public(series), episode_count=episode_count,
            category_name=category_name, like_count=like_count,
            liked_by_me=liked_by_me,
        )
        for series, episode_count, category_name, like_count, liked_by_me in rows
    ]
    return items, total


async def search_speakers(
    db: AsyncSession, user: User | None, query: str, limit: int = GROUP_LIMIT
) -> tuple[list[SpeakerPublic], int]:
    """Speakers whose name matches `query`, for the search screen's
    "speakers" group. Visibility and DTO shape are exactly `GET /speakers`'s
    (same `_speaker_public_stmt`/`speaker_to_public`, same
    `staff_sees_full_counts` count scoping) — this does not reinvent them.

    Returns (top `limit` matches ordered like sermon search, true match
    count).
    """
    columns = [(Speaker.name, "A")]
    condition = _text_search_filter(db, columns, query)
    include_unpublished = staff_sees_full_counts(user)

    total = (await db.execute(
        select(func.count()).select_from(Speaker).where(condition)
    )).scalar_one()

    rank = _text_rank(db, columns, query)
    order = rank if rank is not None else Speaker.name.asc()
    rows = (await db.execute(
        _speaker_public_stmt(include_unpublished).where(condition)
        .order_by(order).limit(limit)
    )).all()

    items = [
        SpeakerPublic(**speaker_to_public(speaker, sermon_count))
        for speaker, sermon_count in rows
    ]
    return items, total


async def suggest(db: AsyncSession, prefix: str, limit: int = 8) -> list[str]:
    """Autocomplete over sermon titles, speaker names, and tags."""
    prefix = prefix.strip()
    if len(prefix) < 2:
        return []
    pattern = f"{prefix.lower()}%"
    limit = max(1, min(limit, 20))

    titles = (await db.execute(
        select(Sermon.title)
        .where(
            *sermon_visibility_clause(),
            func.lower(Sermon.title).like(pattern),
        )
        .limit(limit)
    )).scalars().all()

    speakers = (await db.execute(
        select(Speaker.name).where(func.lower(Speaker.name).like(pattern)).limit(limit)
    )).scalars().all()

    tags = (await db.execute(
        select(SermonTag.tag).where(SermonTag.tag.like(pattern)).distinct().limit(limit)
    )).scalars().all()

    seen: list[str] = []
    for value in [*titles, *speakers, *tags]:
        if value and value not in seen:
            seen.append(value)
    return seen[:limit]
