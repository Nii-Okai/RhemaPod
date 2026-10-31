import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, CurrentUserDep, get_optional_user, require_role
from app.db.database import get_db, get_read_db
from app.models.content_schemas import (
    EpisodeOrderItem,
    EpisodeOrderRequest,
    LikeState,
    SeriesUpdate,
    SermonListItem,
    SeriesCreate,
    SeriesPublic,
    ThumbnailResponse,
    ThumbnailTicket,
    ThumbnailUploadRequest,
)

from app.models.models import Series, SermonStatus, User, UserRole
from app.services import auth_service, content_service, likes_service
from app.services.content_service import (
    ContentError,
    effective_tier,
    load_ref_names,
    renumber_for_display,
    sermon_visibility_clause,
    to_list_item,
)

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


def _series_public(row: tuple[Series, int, str | None, int, bool]) -> SeriesPublic:
    series, episode_count, category_name, like_count, liked_by_me = row
    return SeriesPublic(
        **content_service.series_to_public(series),
        episode_count=episode_count,
        category_name=category_name,
        like_count=like_count,
        liked_by_me=liked_by_me,
    )


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
    return _series_public(
        await content_service.get_series_public(
            db, series.id, include_unpublished=True, viewer_id=actor.id
        )
    )


@router.get("", response_model=list[SeriesPublic])
async def list_series(db: ReadDbDep, user: OptionalUser) -> list[SeriesPublic]:
    # Count scoping (Option B): staff callers get the true all-status
    # episode_count, anon/viewer get published-only. See `staff_sees_full_counts`.
    rows = await content_service.list_series(
        db,
        include_unpublished=content_service.staff_sees_full_counts(user),
        viewer_id=user.id if user is not None else None,
    )
    return [_series_public(row) for row in rows]

@router.get("/{series_id}", response_model=SeriesPublic)
async def get_series(
    series_id: uuid.UUID, db: ReadDbDep, user: OptionalUser
) -> SeriesPublic:
    try:
        row = await content_service.get_series_public(
            db, series_id,
            include_unpublished=content_service.staff_sees_full_counts(user),
            viewer_id=user.id if user is not None else None,
        )
    except ContentError as exc:
        raise _err(exc)
    return _series_public(row)


@router.patch("/{series_id}", response_model=SeriesPublic)
async def update_series(
    series_id: uuid.UUID, data: SeriesUpdate, user: EditorPlus, db: DbDep
) -> SeriesPublic:
    actor = await _staff(db, user)
    fields = data.model_dump(exclude_unset=True)
    try:
        await content_service.update_series(db, series_id, fields, actor)
        row = await content_service.get_series_public(
            db, series_id, include_unpublished=True, viewer_id=actor.id
        )
    except ContentError as exc:
        raise _err(exc)
    return _series_public(row)


@router.delete("/{series_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_series(series_id: uuid.UUID, user: ManagerPlus, db: DbDep) -> Response:
    try:
        await content_service.delete_series(db, series_id)
    except ContentError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{series_id}/like", response_model=LikeState)
async def like_series(series_id: uuid.UUID, user: CurrentUserDep, db: DbDep) -> LikeState:
    """Idempotent — liking an already-liked series is a 200 no-op, not a 409
    (see `likes_service`'s own doc comment). 404 if the series doesn't exist
    or isn't visible to this viewer, same existence check `get_series` itself
    uses, so liking never leaks whether an invisible series id is real."""
    try:
        await content_service.get_series_public(
            db, series_id, include_unpublished=content_service.staff_sees_full_counts(user)
        )
    except ContentError as exc:
        raise _err(exc)
    await likes_service.like_series(db, user.id, series_id)
    like_count, liked = await likes_service.series_like_state(db, series_id, user.id)
    return LikeState(liked=liked, like_count=like_count)


@router.delete("/{series_id}/like", response_model=LikeState)
async def unlike_series(series_id: uuid.UUID, user: CurrentUserDep, db: DbDep) -> LikeState:
    await likes_service.unlike_series(db, user.id, series_id)
    like_count, liked = await likes_service.series_like_state(db, series_id, user.id)
    return LikeState(liked=liked, like_count=like_count)


@router.put("/{series_id}/episode-order", response_model=list[EpisodeOrderItem])
async def reorder_episode_order(
    series_id: uuid.UUID,
    data: EpisodeOrderRequest,
    user: ManagerPlus,
    db: DbDep,
) -> list[EpisodeOrderItem]:
    """Bulk atomic reorder of a series' episodes.

    Body is the full ordered list of the series' episode (sermon) ids. Every id
    must be an episode of this series and the set must be exactly the current
    episode set — otherwise 422, naming what is wrong. Episodes are renumbered
    ``1..N`` by position. An episode in ``pending_review`` / ``under_review`` is
    a fixed point: if the new order would change its number the whole request is
    refused with 409, naming the locked episode(s). All rows are written in one
    transaction or none. Returns the reordered ``{id, episode_number}`` list.

    Ceiling: at most ``MAX_PAGE_SIZE`` (100) ids. The drag client sources the
    full episode set from ``GET /sermons?series_id=``, which pages at
    ``MAX_PAGE_SIZE``, and this endpoint needs the complete ordered list — so a
    series with more episodes than that cannot be reordered through the portal.
    That is out of scope for this batch; the cap turns it into an explicit 422
    rather than a silent partial write.
    """
    actor = await _staff(db, user)
    try:
        ordered = await content_service.reorder_series_episodes(
            db, series_id, data.episode_ids, actor
        )
    except ContentError as exc:
        raise _err(exc)
    return [
        EpisodeOrderItem(id=s.id, episode_number=s.episode_number)
        for s in ordered
    ]


@router.get("/{series_id}/episodes", response_model=list[SermonListItem])
async def series_episodes(
    series_id: uuid.UUID, db: ReadDbDep, user: OptionalUser
) -> list[SermonListItem]:
    """Published, visible episodes of a series, ordered by episode number (gaps
    allowed).

    Published-only by design; staff reads (a manager ordering drafts) go through
    ``GET /sermons?series_id=`` (Isaac's call — no admin/``include_all`` variant
    here). Also gated on `publish_at` — a scheduled episode doesn't appear here
    before its own catalog listing would show it.
    """
    # W2.3 (plan L11): gaps from unpublished/deleted episodes are hidden by
    # renumbering `episode_number` to a contiguous 1..N sequence on this
    # response only — see `renumber_for_display`. `Sermon.episode_number`
    # itself is untouched; kept out of the docstring above so it never
    # becomes part of the OpenAPI description (openapi.json stays byte-for-
    # byte identical — this is a value-only change, not a contract change).
    series = await db.get(Series, series_id)
    if series is None:
        raise HTTPException(status_code=404, detail="Series not found")
    is_staff = content_service.staff_sees_full_counts(user)
    if series.status != SermonStatus.PUBLISHED and not is_staff:
        # Draft series are invisible to viewers/anon — same body as nonexistent.
        raise HTTPException(status_code=404, detail="Series not found")

    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.models.models import Sermon

    stmt = (
        select(Sermon)
        .where(Sermon.series_id == series_id, *sermon_visibility_clause())
        .order_by(Sermon.episode_number.asc().nullslast())
        # Eager-loaded for `media_type` below (offline downloads need to know a
        # episode's rendition without a second request per row) — scoped to this
        # one query, not a change to `Sermon`'s default loading elsewhere.
        .options(selectinload(Sermon.media_refs))
    )
    rows = (await db.execute(stmt)).scalars().all()
    # Resolve entitlement once for the caller — not per row (that would be a
    # Redis round-trip per episode). is_entitled writes only to Redis, so the
    # read-only session is not violated.
    has_sub = await content_service._has_subscription(db, user)
    # Bug fix (Isaac's report, session 2026-09-30: "speaker name is not showing on
    # episode items"): this route never resolved speaker/category/series names onto
    # the returned `SermonListItem`s — `to_list_item` was called with no `names` arg,
    # so it silently fell back to an all-empty `RefNames()` regardless of whether the
    # episode actually had a speaker assigned. `series_title` was affected too (every
    # episode's own `series_title` came back `None`, even though it's obviously this
    # series).
    names = await load_ref_names(db, rows, include_draft_series=is_staff)
    items = [
        to_list_item(
            s,
            effective_tier(s, series),
            has_sub,
            names,
            media_type=next((ref.type.value for ref in s.media_refs), None),
        )
        for s in rows
    ]
    return renumber_for_display(items)


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