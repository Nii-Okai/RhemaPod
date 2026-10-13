"""Viewer-owned playlists (Isaac's ask, session 2026-10-10): the Library tab's
"create playlists" half. Every route here requires sign-in and is scoped to
the caller's own playlists — there's no cross-user playlist visibility in
this app, so a playlist id that exists but isn't yours 404s exactly like one
that doesn't exist at all.
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUserDep
from app.db.database import get_db
from app.models.content_schemas import (
    PlaylistCoverResponse,
    PlaylistCoverTicket,
    PlaylistCoverUploadRequest,
    PlaylistCreate,
    PlaylistDetail,
    PlaylistItemAdd,
    PlaylistItemOrderRequest,
    PlaylistPublic,
    PlaylistUpdate,
)
from app.models.models import User
from app.services import auth_service, playlists_service
from app.services.content_service import ContentError

router = APIRouter(prefix="/playlists", tags=["playlists"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


def _err(exc: ContentError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


async def _record(db: AsyncSession, user: CurrentUserDep) -> User:
    # CurrentUser is the lightweight auth principal; the service layer wants
    # the full row (id is all it actually reads, but every other playlists_
    # service call site also needs .full_name/.role, so resolve it once here).
    record = await auth_service.get_user_by_id(db, user.id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return record


@router.get("", response_model=list[PlaylistPublic])
async def list_playlists(user: CurrentUserDep, db: DbDep) -> list[PlaylistPublic]:
    return await playlists_service.list_playlists(db, await _record(db, user))


@router.post("", response_model=PlaylistPublic, status_code=status.HTTP_201_CREATED)
async def create_playlist(data: PlaylistCreate, user: CurrentUserDep, db: DbDep) -> PlaylistPublic:
    return await playlists_service.create_playlist(
        db, await _record(db, user), data.name, data.description, data.is_public
    )


@router.get("/{playlist_id}", response_model=PlaylistDetail)
async def get_playlist(playlist_id: uuid.UUID, user: CurrentUserDep, db: DbDep) -> PlaylistDetail:
    try:
        return await playlists_service.get_playlist_detail(db, await _record(db, user), playlist_id)
    except ContentError as exc:
        raise _err(exc)


@router.patch("/{playlist_id}", response_model=PlaylistPublic)
async def update_playlist(
    playlist_id: uuid.UUID, data: PlaylistUpdate, user: CurrentUserDep, db: DbDep
) -> PlaylistPublic:
    try:
        return await playlists_service.update_playlist(
            db, await _record(db, user), playlist_id, data.model_dump(exclude_unset=True)
        )
    except ContentError as exc:
        raise _err(exc)


@router.delete("/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_playlist(playlist_id: uuid.UUID, user: CurrentUserDep, db: DbDep) -> None:
    try:
        await playlists_service.delete_playlist(db, await _record(db, user), playlist_id)
    except ContentError as exc:
        raise _err(exc)


@router.post("/{playlist_id}/items", response_model=PlaylistDetail, status_code=status.HTTP_201_CREATED)
async def add_item(
    playlist_id: uuid.UUID, data: PlaylistItemAdd, user: CurrentUserDep, db: DbDep
) -> PlaylistDetail:
    try:
        return await playlists_service.add_item(db, await _record(db, user), playlist_id, data.sermon_id)
    except ContentError as exc:
        raise _err(exc)


@router.delete("/{playlist_id}/items/{item_id}", response_model=PlaylistDetail)
async def remove_item(
    playlist_id: uuid.UUID, item_id: uuid.UUID, user: CurrentUserDep, db: DbDep
) -> PlaylistDetail:
    try:
        return await playlists_service.remove_item(db, await _record(db, user), playlist_id, item_id)
    except ContentError as exc:
        raise _err(exc)


@router.put("/{playlist_id}/items/order", response_model=PlaylistDetail)
async def reorder_items(
    playlist_id: uuid.UUID, data: PlaylistItemOrderRequest, user: CurrentUserDep, db: DbDep
) -> PlaylistDetail:
    try:
        return await playlists_service.reorder_items(db, await _record(db, user), playlist_id, data.item_ids)
    except ContentError as exc:
        raise _err(exc)


@router.post(
    "/{playlist_id}/cover/upload-ticket", response_model=PlaylistCoverTicket, status_code=status.HTTP_201_CREATED
)
async def cover_upload_ticket(
    playlist_id: uuid.UUID, data: PlaylistCoverUploadRequest, user: CurrentUserDep, db: DbDep
) -> PlaylistCoverTicket:
    try:
        return await playlists_service.create_cover_ticket(
            db, await _record(db, user), playlist_id, data.filename, data.content_type
        )
    except ContentError as exc:
        raise _err(exc)


@router.post("/{playlist_id}/cover/confirm", response_model=PlaylistCoverResponse)
async def cover_confirm(
    playlist_id: uuid.UUID, cover_key: str, user: CurrentUserDep, db: DbDep
) -> PlaylistCoverResponse:
    try:
        url = await playlists_service.confirm_cover(db, await _record(db, user), playlist_id, cover_key)
    except ContentError as exc:
        raise _err(exc)
    return PlaylistCoverResponse(cover_url=url)
