"""Sermon search and autocomplete. Public — anonymous callers may search."""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_optional_user
from app.db.database import get_read_db
from app.models.content_schemas import SearchResults, SeriesPublic, SpeakerPublic
from app.models.models import ContentTier, User
from app.services import search_service

router = APIRouter(prefix="/search", tags=["search"])

ReadDbDep = Annotated[AsyncSession, Depends(get_read_db)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


@router.get("", response_model=SearchResults)
async def search(
    db: ReadDbDep,
    user: OptionalUser,
    q: str | None = Query(default=None, max_length=200),
    category_id: uuid.UUID | None = None,
    speaker_id: uuid.UUID | None = None,
    series_id: uuid.UUID | None = None,
    tier: ContentTier | None = None,
    tag: str | None = Query(default=None, max_length=60),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
) -> SearchResults:
    """Search published sermons. Every filter is optional — with no `q` this is
    a filtered browse.

    With a non-empty `q`, the response also groups in series and speaker
    matches (small, fixed-limit, not paginated) for the mobile search
    screen's three-way sermons/series/speakers layout. With no `q`, those
    groups are empty — filtered-browse mode is sermons-only, unchanged.
    """
    items, total = await search_service.search_sermons(
        db, user, query=q, category_id=category_id, speaker_id=speaker_id,
        series_id=series_id, tier=tier, tag=tag, limit=limit, offset=offset,
    )
    series: list[SeriesPublic] = []
    series_total = 0
    speakers: list[SpeakerPublic] = []
    speakers_total = 0
    if q:
        series, series_total = await search_service.search_series(db, user, q)
        speakers, speakers_total = await search_service.search_speakers(db, user, q)
    return SearchResults(
        query=q or "", total=total, limit=limit, offset=offset, results=items,
        series=series, series_total=series_total,
        speakers=speakers, speakers_total=speakers_total,
    )


@router.get("/suggest", response_model=list[str])
async def suggest(
    db: ReadDbDep,
    q: str = Query(min_length=2, max_length=100),
    limit: int = Query(default=8, ge=1, le=20),
) -> list[str]:
    """Autocomplete over titles, speakers, and tags."""
    return await search_service.suggest(db, q, limit)
