"""Sermon/series likes (Isaac's ask, session 2026-10-09: "the like button" gets a
real counter and backend, not a client-only toggle). Two parallel, unabstracted
sets of functions rather than one generic "like a thing" helper — a sermon and a
series are two distinct tables with real foreign keys (no polymorphic
content_type/content_id column, so every like row keeps its own real referential
integrity), and six short functions read more plainly than a generic version
with only two real call sites ever would.

Both endpoints this backs (`PUT`/`DELETE /sermons/{id}/like`,
`PUT`/`DELETE /series/{id}/like`) are idempotent: liking an already-liked
sermon, or unliking one that was never liked, is a 200 no-op, never a 409 —
matches the client's own "press to set state" button, not a toggle that could
drift out of sync with the server on a double-tap or a retried request.
"""
import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.models import SeriesLike, SermonLike

log = get_logger("likes")


async def like_sermon(db: AsyncSession, user_id: uuid.UUID, sermon_id: uuid.UUID) -> None:
    stmt = (
        pg_insert(SermonLike)
        .values(user_id=user_id, sermon_id=sermon_id)
        .on_conflict_do_nothing(index_elements=["user_id", "sermon_id"])
    )
    await db.execute(stmt)
    await db.commit()
    log.info("sermon_liked", user_id=str(user_id), sermon_id=str(sermon_id))


async def unlike_sermon(db: AsyncSession, user_id: uuid.UUID, sermon_id: uuid.UUID) -> None:
    await db.execute(delete(SermonLike).where(SermonLike.user_id == user_id, SermonLike.sermon_id == sermon_id))
    await db.commit()
    log.info("sermon_unliked", user_id=str(user_id), sermon_id=str(sermon_id))


async def sermon_like_state(
    db: AsyncSession, sermon_id: uuid.UUID, viewer_id: uuid.UUID | None
) -> tuple[int, bool]:
    """`(like_count, liked_by_me)` — `liked_by_me` is always `False` for an
    anonymous viewer (`viewer_id=None`), no query needed for that half."""
    count = (
        await db.execute(select(func.count(SermonLike.id)).where(SermonLike.sermon_id == sermon_id))
    ).scalar_one()
    liked = False
    if viewer_id is not None:
        liked = (
            await db.execute(
                select(SermonLike.id).where(SermonLike.sermon_id == sermon_id, SermonLike.user_id == viewer_id)
            )
        ).first() is not None
    return count, liked


async def like_series(db: AsyncSession, user_id: uuid.UUID, series_id: uuid.UUID) -> None:
    stmt = (
        pg_insert(SeriesLike)
        .values(user_id=user_id, series_id=series_id)
        .on_conflict_do_nothing(index_elements=["user_id", "series_id"])
    )
    await db.execute(stmt)
    await db.commit()
    log.info("series_liked", user_id=str(user_id), series_id=str(series_id))


async def unlike_series(db: AsyncSession, user_id: uuid.UUID, series_id: uuid.UUID) -> None:
    await db.execute(delete(SeriesLike).where(SeriesLike.user_id == user_id, SeriesLike.series_id == series_id))
    await db.commit()
    log.info("series_unliked", user_id=str(user_id), series_id=str(series_id))


async def series_like_state(
    db: AsyncSession, series_id: uuid.UUID, viewer_id: uuid.UUID | None
) -> tuple[int, bool]:
    count = (
        await db.execute(select(func.count(SeriesLike.id)).where(SeriesLike.series_id == series_id))
    ).scalar_one()
    liked = False
    if viewer_id is not None:
        liked = (
            await db.execute(
                select(SeriesLike.id).where(SeriesLike.series_id == series_id, SeriesLike.user_id == viewer_id)
            )
        ).first() is not None
    return count, liked
