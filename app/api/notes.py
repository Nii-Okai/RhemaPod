import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, CurrentUserDep
from app.db.database import get_db
from app.models.content_schemas import NoteCreate, NotePublic, NoteUpdate
from app.models.models import User
from app.services import auth_service, notes_service
from app.services.content_service import ContentError

router = APIRouter(tags=["notes"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


async def _actor(db: AsyncSession, current: CurrentUser) -> User:
    """Load the ORM User for service calls that need the full row. Matches
    the identical helper in sermons.py/analytics.py — see those for why this
    exists rather than passing the lightweight `CurrentUser` straight
    through."""
    user = await auth_service.get_user_by_id(db, current.id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return user


def _err(exc: ContentError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/sermons/{sermon_id}/notes", response_model=list[NotePublic])
async def list_sermon_notes(
    sermon_id: uuid.UUID, user: CurrentUserDep, db: DbDep
) -> list[NotePublic]:
    """The caller's own notes on one sermon. Strictly user-owned — this never
    returns anyone else's notes, staff included."""
    actor = await _actor(db, user)
    try:
        notes = await notes_service.list_notes_for_sermon(db, actor, sermon_id)
    except ContentError as exc:
        raise _err(exc)
    return [NotePublic.model_validate(n) for n in notes]


@router.post(
    "/sermons/{sermon_id}/notes",
    response_model=NotePublic,
    status_code=status.HTTP_201_CREATED,
)
async def create_sermon_note(
    sermon_id: uuid.UUID, data: NoteCreate, user: CurrentUserDep, db: DbDep
) -> NotePublic:
    actor = await _actor(db, user)
    try:
        note = await notes_service.create_note(db, actor, sermon_id, data)
    except ContentError as exc:
        raise _err(exc)
    return NotePublic.model_validate(note)


@router.get("/me/notes", response_model=list[NotePublic])
async def list_my_notes(user: CurrentUserDep, db: DbDep) -> list[NotePublic]:
    """Every note the caller has ever taken, across all sermons, most recent
    first."""
    actor = await _actor(db, user)
    notes = await notes_service.list_my_notes(db, actor)
    return [NotePublic.model_validate(n) for n in notes]


@router.patch("/notes/{note_id}", response_model=NotePublic)
async def update_note(
    note_id: uuid.UUID, data: NoteUpdate, user: CurrentUserDep, db: DbDep
) -> NotePublic:
    """Ownership-only: a note that doesn't belong to the caller 404s, the
    same as one that doesn't exist — no staff bypass, see notes_service."""
    actor = await _actor(db, user)
    try:
        note = await notes_service.update_note(db, actor, note_id, data)
    except ContentError as exc:
        raise _err(exc)
    return NotePublic.model_validate(note)


@router.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(note_id: uuid.UUID, user: CurrentUserDep, db: DbDep) -> Response:
    """Ownership-only: same 404-not-403 rule as update_note."""
    actor = await _actor(db, user)
    try:
        await notes_service.delete_note(db, actor, note_id)
    except ContentError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
