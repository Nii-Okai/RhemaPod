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

from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.models import (
    ContentTier,
    Sermon,
    SermonStatus,
    SermonTag,
    Series,
    Speaker,
    User,
)
from app.services.content_service import (
    _has_subscription,
    effective_tier,
    to_list_item,
)

log = get_logger("search")

MAX_LIMIT = 50


def _is_postgres(db: AsyncSession) -> bool:
    return db.bind.dialect.name == "postgresql"


def _search_filter(db: AsyncSession, query: str):
    """Build the text-match condition for the active dialect."""
    if _is_postgres(db):
        # Weighted: a title match should beat a description match.
        vector = func.setweight(
            func.to_tsvector("english", func.coalesce(Sermon.title, "")), "A"
        ).op("||")(
            func.setweight(
                func.to_tsvector("english", func.coalesce(Sermon.description, "")), "B"
            )
        )
        return vector.op("@@")(func.plainto_tsquery("english", query))

    like = f"%{query.lower()}%"
    return or_(
        func.lower(Sermon.title).like(like),
        func.lower(func.coalesce(Sermon.description, "")).like(like),
    )


def _rank(db: AsyncSession, query: str):
    if _is_postgres(db):
        vector = func.setweight(
            func.to_tsvector("english", func.coalesce(Sermon.title, "")), "A"
        ).op("||")(
            func.setweight(
                func.to_tsvector("english", func.coalesce(Sermon.description, "")), "B"
            )
        )
        return func.ts_rank(vector, func.plainto_tsquery("english", query)).desc()
    
    return Sermon.published_at.desc().nullslast()


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
    """Search published sermons. Returns (items, total).

    Only published content is searchable — an unpublished sermon must not be
    discoverable through search when it is hidden everywhere else.
    """
    limit = max(1, min(limit, MAX_LIMIT))
    offset = max(0, offset)

    conditions = [Sermon.status == SermonStatus.PUBLISHED]

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
    items = []
    for sermon in rows:
        resolved = effective_tier(sermon, series_map.get(sermon.series_id))
        items.append(to_list_item(sermon, resolved, has_sub))

    log.info("search", query=query or "", results=len(items), total=total)
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
            Sermon.status == SermonStatus.PUBLISHED,
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
