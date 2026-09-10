import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, get_optional_user, require_role
from app.db.database import get_db, get_read_db
from app.models.content_schemas import (
    Page,
    SermonAdminDetail,
    SermonAdminListItem,
    SermonCreate,
    SermonDetail,
    SermonUpdate,
    StatusResponse,
    ThumbnailResponse,
    ThumbnailTicket,
    ThumbnailUploadRequest
)
from app.models.models import ContentTier, SermonStatus, User, UserRole
from app.services import auth_service, content_service
from app.services.content_service import ContentError, effective_tier, to_list_item

router = APIRouter(prefix="/sermons", tags=["sermons"])

ReadDbDep = Annotated[AsyncSession, Depends(get_read_db)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
DbDep = Annotated[AsyncSession, Depends(get_db)]

EditorPlus = Annotated[CurrentUser, Depends(require_role(UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN))]
ManagerPlus = Annotated[CurrentUser, Depends(require_role(UserRole.MANAGER, UserRole.ADMIN))]


async def _actor(db: AsyncSession, current: CurrentUser) -> User:
    """Load the ORM User for service calls that need the full row."""
    user = await auth_service.get_user_by_id(db, current.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


def _err(exc: ContentError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)

async def _ticket(kind, entity_id, data, user, db) -> ThumbnailTicket:
    actor = await _actor(db, user)
    try:
        result = await content_service.create_thumbnail_ticket(
            db, kind, entity_id, actor, data.filename, data.content_type
        )
    except ContentError as exc:
        raise _err(exc)
    return ThumbnailTicket(**result)


async def _confirm(kind, entity_id, key, user, db) -> ThumbnailResponse:
    actor = await _actor(db, user)
    try:
        url = await content_service.confirm_thumbnail(db, kind, entity_id, actor, key)
    except ContentError as exc:
        raise _err(exc)
    return ThumbnailResponse(thumbnail_url=url)


@router.get("", response_model=Page[SermonAdminListItem])
async def list_my_sermons(
    user: EditorPlus,
    db: DbDep,
    status: SermonStatus | None = None,
    q: str | None = Query(default=None, max_length=200, description="Title contains"),
    speaker_id: uuid.UUID | None = None,
    series_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    tier: ContentTier | None = Query(
        default=None,
        description="Filter on effective tier (sermon tier, else series tier, else free)",
    ),
    created_by: Literal["me"] | None = Query(
        default=None,
        description="Restrict to sermons authored by the caller. Only the "
        "literal `me` is accepted; powers the editor Dashboard WIP cards.",
    ),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> Page[SermonAdminListItem]:
    """Editors see their own sermons across all statuses; managers and admins
    see everyone's. Carries workflow fields the catalog card omits.

    `created_by=me` narrows further to the caller's own sermons — a no-op for
    an editor (already scoped that way), a voluntary filter for a manager/admin.
    """
    actor = await _actor(db, user)
    author_id = actor.id if created_by == "me" else None
    rows, total = await content_service.list_sermons_for_staff(
        db, actor, status, limit=limit, offset=offset, search=q,
        speaker_id=speaker_id, series_id=series_id, category_id=category_id, tier=tier,
        author_id=author_id,
    )
    series_map = await content_service.series_for(db, rows)
    names = await content_service.load_ref_names(db, rows)

    items = []
    for s in rows:
        base = to_list_item(
            s, effective_tier(s, series_map.get(s.series_id)),
            has_subscription=True, names=names,
        )
        items.append(SermonAdminListItem(
            **base.model_dump(),
            status=s.status,
            created_by=s.created_by,
            created_at=s.created_at,
            updated_at=s.updated_at,
        ))
    return Page[SermonAdminListItem](
        items=items, total=total, limit=limit, offset=offset
    )


@router.post("", response_model=SermonDetail, status_code=status.HTTP_201_CREATED)
async def create_sermon(data: SermonCreate, user: EditorPlus, db: DbDep) -> SermonDetail:
    actor = await _actor(db, user)
    try:
        sermon = await content_service.create_sermon(db, data, actor)
        return await content_service.get_sermon_detail(db, sermon.id, actor)
    except ContentError as exc:
        raise _err(exc)


@router.get("/{sermon_id}", response_model=SermonAdminDetail)
async def get_sermon(
    sermon_id: uuid.UUID, user: EditorPlus, db: DbDep
) -> SermonAdminDetail:
    """Load a sermon in any status for the editor screen.

    The public `/catalog/sermons/{id}` is published-only and returns a plain
    `SermonDetail`; this is the staff read and returns `SermonAdminDetail`
    (adds `updated_at` for the "saved N min ago" baseline). Editors see only
    their own sermons (someone else's is 404, not 403, so existence isn't
    leaked); managers and admins see any.
    """
    actor = await _actor(db, user)
    try:
        return await content_service.get_sermon_for_staff(db, sermon_id, actor)
    except ContentError as exc:
        raise _err(exc)


@router.patch("/{sermon_id}", response_model=SermonDetail)
async def update_sermon(
    sermon_id: uuid.UUID, data: SermonUpdate, user: EditorPlus, db: DbDep
) -> SermonDetail:
    actor = await _actor(db, user)
    try:
        sermon = await content_service.update_sermon(db, sermon_id, data, actor)
        return await content_service.get_sermon_detail(db, sermon.id, actor)
    except ContentError as exc:
        raise _err(exc)


@router.delete("/{sermon_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sermon(sermon_id: uuid.UUID, user: EditorPlus, db: DbDep) -> Response:
    """Editors may delete only their own draft/rejected sermons; managers and
    admins may delete any non-published sermon. Published content must be
    unpublished first."""
    actor = await _actor(db, user)
    try:
        await content_service.delete_sermon(db, sermon_id, actor)
    except ContentError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

# Approval workflow actions
@router.post("/{sermon_id}/submit", response_model=StatusResponse)
async def submit(sermon_id: uuid.UUID, user: EditorPlus, db: DbDep) -> StatusResponse:
    actor = await _actor(db, user)
    try:
        s = await content_service.transition(db, sermon_id, "submit", actor)
    except ContentError as exc:
        raise _err(exc)
    return StatusResponse(id=s.id, status=s.status)


@router.post("/{sermon_id}/withdraw", response_model=StatusResponse)
async def withdraw(sermon_id: uuid.UUID, user: EditorPlus, db: DbDep) -> StatusResponse:
    """Pull a pending/under-review sermon back to draft. An editor may withdraw
    only their own (others 404); managers and admins any. Writes an ApprovalLog
    row like every other transition."""
    actor = await _actor(db, user)
    try:
        s = await content_service.transition(db, sermon_id, "withdraw", actor)
    except ContentError as exc:
        raise _err(exc)
    return StatusResponse(id=s.id, status=s.status)


@router.post(
    "/{sermon_id}/thumbnail-url",
    response_model=ThumbnailTicket,
    status_code=status.HTTP_201_CREATED,
)
async def sermon_thumbnail_url(
    sermon_id: uuid.UUID, data: ThumbnailUploadRequest, user: EditorPlus, db: DbDep
) -> ThumbnailTicket:
    return await _ticket("sermons", sermon_id, data, user, db)


@router.post("/{sermon_id}/thumbnail/confirm", response_model=ThumbnailResponse)
async def sermon_thumbnail_confirm(
    sermon_id: uuid.UUID, thumbnail_key: str, user: EditorPlus, db: DbDep
) -> ThumbnailResponse:
    return await _confirm("sermons", sermon_id, thumbnail_key, user, db)