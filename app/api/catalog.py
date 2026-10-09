"""Public catalog reads — plus the sermon Like action (Isaac's ask, session
2026-10-09), the one write this module carries. It belongs here rather than
in `sermons.py` (staff CMS only — no viewer-facing route lives there at all)
or a standalone router: liking is a viewer action on a `/catalog/sermons/{id}`
resource this module already owns, the same way `series.py` carries its own
viewer-facing `/series/{id}/like` alongside its public reads.

All published sermons are visible; the per-user `locked` flag tells the client
what to gate. Playback itself is enforced by the streaming endpoint.
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUserDep, get_optional_user
from app.db.database import get_db, get_read_db
from app.models.content_schemas import CategoryPublic, LikeState, SermonDetail, SermonListItem
from app.models.models import User
from app.services import content_service, likes_service
from app.services.content_service import ContentError

router = APIRouter(prefix="/catalog", tags=["catalog"])

ReadDbDep = Annotated[AsyncSession, Depends(get_read_db)]
DbDep = Annotated[AsyncSession, Depends(get_db)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


@router.get("/sermons", response_model=list[SermonListItem])
async def list_sermons(db: ReadDbDep, user: OptionalUser) -> list[SermonListItem]:
    return await content_service.list_published_sermons(db, user)


@router.get("/sermons/trending", response_model=list[SermonListItem])
async def trending_sermons(
    db: ReadDbDep, user: OptionalUser, limit: int = Query(default=10, ge=1, le=50)
) -> list[SermonListItem]:
    """Most-played published sermons over the last 30 days (Home's "Trending"
    shelf) — public, like every other `/catalog` read; no sign-in required to
    see what's trending. Registered ahead of `/sermons/{sermon_id}` below so
    "trending" is never captured as a sermon-id path parameter."""
    return await content_service.list_trending_sermons(db, user, limit)


@router.get("/sermons/hero", response_model=list[SermonListItem])
async def hero_sermons(
    db: ReadDbDep, user: OptionalUser, limit: int = Query(default=3, ge=1, le=10)
) -> list[SermonListItem]:
    """Home's hero carousel — up to 3 newest-published sermons, capped to one per
    series. Public, like every other `/catalog` read. Registered ahead of
    `/sermons/{sermon_id}` so "hero" is never captured as a sermon-id path parameter."""
    return await content_service.list_hero_sermons(db, user, limit)


@router.get("/sermons/new-releases", response_model=list[SermonListItem])
async def new_release_sermons(
    db: ReadDbDep, user: OptionalUser, limit: int = Query(default=10, ge=1, le=50)
) -> list[SermonListItem]:
    """Newest-published sermons (Home's "New Releases" shelf) — same ordering as the
    hero, capped to shelf size, NOT capped to one-per-series (see
    `list_new_release_sermons`'s own docstring). Public, like every other `/catalog`
    read. Registered ahead of `/sermons/{sermon_id}` so "new-releases" is never
    captured as a sermon-id path parameter."""
    return await content_service.list_new_release_sermons(db, user, limit)


@router.get("/sermons/prophets-catalog", response_model=list[SermonListItem])
async def prophets_catalog_sermons(
    db: ReadDbDep, user: OptionalUser, limit: int = Query(default=10, ge=1, le=50)
) -> list[SermonListItem]:
    """Sermons an editor has manually flagged as part of the "Prophet's Catalog"
    (Home's shelf of the same name) via the admin editor's switch. Public, like
    every other `/catalog` read. Registered ahead of `/sermons/{sermon_id}` so
    "prophets-catalog" is never captured as a sermon-id path parameter."""
    return await content_service.list_prophets_catalog_sermons(db, user, limit)


@router.get("/sermons/{sermon_id}", response_model=SermonDetail)
async def get_sermon(
    sermon_id: uuid.UUID, db: ReadDbDep, user: OptionalUser
) -> SermonDetail:
    try:
        return await content_service.get_sermon_detail(db, sermon_id, user)
    except ContentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.put("/sermons/{sermon_id}/like", response_model=LikeState)
async def like_sermon(sermon_id: uuid.UUID, user: CurrentUserDep, db: DbDep) -> LikeState:
    """Idempotent — liking an already-liked sermon is a 200 no-op, not a 409
    (see `likes_service`'s own doc comment). 404 if the sermon doesn't exist
    or isn't visible to this viewer — the same `get_sermon_detail` visibility
    check `get_sermon` above uses, so liking never leaks whether an invisible
    sermon id is real."""
    try:
        await content_service.get_sermon_detail(db, sermon_id, user)
    except ContentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    await likes_service.like_sermon(db, user.id, sermon_id)
    like_count, liked = await likes_service.sermon_like_state(db, sermon_id, user.id)
    return LikeState(liked=liked, like_count=like_count)


@router.delete("/sermons/{sermon_id}/like", response_model=LikeState)
async def unlike_sermon(sermon_id: uuid.UUID, user: CurrentUserDep, db: DbDep) -> LikeState:
    await likes_service.unlike_sermon(db, user.id, sermon_id)
    like_count, liked = await likes_service.sermon_like_state(db, sermon_id, user.id)
    return LikeState(liked=liked, like_count=like_count)


@router.get("/categories", response_model=list[CategoryPublic])
async def get_categories(db: ReadDbDep, user: OptionalUser) -> list[CategoryPublic]:
    """All categories. Flat — categories have no parent.

    Public-first: the common (anonymous) caller gets a published-only
    `sermon_count`. A logged-in staffer (editor/manager/admin) hitting this
    route gets the true all-status count — see `staff_sees_full_counts`.
    """
    rows = await content_service.list_categories_with_counts(
        db, include_unpublished=content_service.staff_sees_full_counts(user)
    )
    return [
        CategoryPublic(**content_service.category_to_public(cat, sermon_count))
        for cat, sermon_count in rows
    ]
