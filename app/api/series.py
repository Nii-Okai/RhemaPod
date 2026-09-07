import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, get_optional_user, require_role
from app.db.database import get_db, get_read_db
from app.models.content_schemas import (
    SeriesUpdate,
    SermonListItem,
    SeriesCreate,
    SeriesPublic,
    ThumbnailResponse,
    ThumbnailTicket,
    ThumbnailUploadRequest,
)

from app.models.models import Series, User, UserRole
from app.services import auth_service, content_service
from app.services.content_service import ContentError, effective_tier, to_list_item

router = APIRouter(prefix="/series", tags=["series"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ReadDbDep = Annotated[AsyncSession, Depends(get_read_db)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
EditorPlus = Annotated[CurrentUser, Depends(require_role(UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN))]
ManagerPlus = Annotated[CurrentUser, Depends(require_role(UserRole.MANAGER, UserRole.ADMIN))]


def _err(exc: ContentError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)

async def _ticket(kind, entity_id, data, user, db) -> ThumbnailTicket:
    actor = await _staff(db, user)
    try:
        result = await content_service.create_thumbnail_ticket(
            db, kind, entity_id, actor, data.filename, data.content_type
        )
    except ContentError as exc:
        raise _err(exc)
    return ThumbnailTicket(**result)


async def _confirm(kind, entity_id, key, user, db) -> ThumbnailResponse:
    actor = await _staff(db, user)
    try:
        url = await content_service.confirm_thumbnail(db, kind, entity_id, actor, key)
    except ContentError as exc:
        raise _err(exc)
    return ThumbnailResponse(thumbnail_url=url)


async def _staff(db: AsyncSession, current: CurrentUser) -> User:
    user = await auth_service.get_user_by_id(db, current.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


# Series
@router.post("", response_model=SeriesPublic, status_code=status.HTTP_201_CREATED)
async def create_series(data: SeriesCreate, user: EditorPlus, db: DbDep) -> SeriesPublic:
    actor = await _staff(db, user)
    series = Series(
        title=data.title,
        description=data.description,
        category_id=data.category_id,
        tier=data.tier,
        created_by=actor.id,
    )

    db.add(series)
    await db.commit()
    await db.refresh(series)
    return SeriesPublic(**content_service.series_to_public(series))


@router.get("", response_model=list[SeriesPublic])
async def list_series(db: ReadDbDep) -> list[SeriesPublic]:
    rows = await content_service.list_series(db)
    return [SeriesPublic(**content_service.series_to_public(s)) for s in rows]

@router.get("/{series_id}", response_model=SeriesPublic)
async def get_series(series_id: uuid.UUID, db: ReadDbDep) -> SeriesPublic:
    try:
        series = await content_service.get_series(db, series_id)
    except ContentError as exc:
        raise _err(exc)
    return SeriesPublic(**content_service.series_to_public(series))


@router.patch("/{series_id}", response_model=SeriesPublic)
async def update_series(
    series_id: uuid.UUID, data: SeriesUpdate, user: EditorPlus, db: DbDep
) -> SeriesPublic:
    actor = await _staff(db, user)
    fields = data.model_dump(exclude_unset=True)
    try:
        series = await content_service.update_series(db, series_id, fields, actor)
    except ContentError as exc:
        raise _err(exc)
    return SeriesPublic(**content_service.series_to_public(series))


@router.delete("/{series_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_series(series_id: uuid.UUID, user: ManagerPlus, db: DbDep) -> Response:
    try:
        await content_service.delete_series(db, series_id)
    except ContentError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{series_id}/episodes", response_model=list[SermonListItem])
async def series_episodes(
    series_id: uuid.UUID, db: ReadDbDep, user: OptionalUser
) -> list[SermonListItem]:
    """Published episodes of a series, ordered by episode number (gaps allowed)."""
    series = await db.get(Series, series_id)
    if series is None:
        raise HTTPException(status_code=404, detail="Series not found")

    from sqlalchemy import select

    from app.models.models import Sermon, SermonStatus

    stmt = (
        select(Sermon)
        .where(Sermon.series_id == series_id, Sermon.status == SermonStatus.PUBLISHED)
        .order_by(Sermon.episode_number.asc().nullslast())
    )
    rows = (await db.execute(stmt)).scalars().all()
    # Resolve entitlement once for the caller — not per row (that would be a
    # Redis round-trip per episode). is_entitled writes only to Redis, so the
    # read-only session is not violated.
    has_sub = await content_service._has_subscription(db, user)
    return [
        to_list_item(s, effective_tier(s, series), has_sub)
        for s in rows
    ]


@router.post(
    "/{series_id}/thumbnail-url",
    response_model=ThumbnailTicket,
    status_code=status.HTTP_201_CREATED,
)
async def series_thumbnail_url(
    series_id: uuid.UUID, data: ThumbnailUploadRequest, user: EditorPlus, db: DbDep
) -> ThumbnailTicket:
    return await _ticket("series", series_id, data, user, db)


@router.post("/{series_id}/thumbnail/confirm", response_model=ThumbnailResponse)
async def series_thumbnail_confirm(
    series_id: uuid.UUID, thumbnail_key: str, user: EditorPlus, db: DbDep
) -> ThumbnailResponse:
    return await _confirm("series", series_id, thumbnail_key, user, db)