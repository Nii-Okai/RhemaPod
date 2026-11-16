"""Verses — Home's "verse of the day" (mobile `VerseStrip`).

Public read (`/today`) is open to everyone, same reasoning as Announcements: this is
devotional content, not gated. Writes (plain CRUD, no editorial workflow) are
editor/manager/admin, matching Announcements' own EditorPlus gate.
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, require_role
from app.db.database import get_db, get_read_db
from app.models.content_schemas import VerseAdminItem, VerseCreate, VersePublic, VerseUpdate
from app.models.models import UserRole
from app.services import verse_service
from app.services.verse_service import VerseError

router = APIRouter(prefix="/verses", tags=["verses"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ReadDbDep = Annotated[AsyncSession, Depends(get_read_db)]
EditorPlus = Annotated[
    CurrentUser,
    Depends(require_role(UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN)),
]


def _err(exc: VerseError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/today", response_model=VersePublic)
async def verse_of_the_day(db: ReadDbDep) -> VersePublic:
    try:
        verse = await verse_service.get_verse_of_the_day(db)
    except VerseError as exc:
        raise _err(exc)
    return VersePublic.model_validate(verse)


@router.get("/admin/all", response_model=list[VerseAdminItem])
async def list_verses(db: ReadDbDep, _user: EditorPlus) -> list[VerseAdminItem]:
    rows = await verse_service.list_all(db)
    return [VerseAdminItem.model_validate(v) for v in rows]


@router.post("", response_model=VerseAdminItem, status_code=status.HTTP_201_CREATED)
async def create_verse(data: VerseCreate, user: EditorPlus, db: DbDep) -> VerseAdminItem:
    verse = await verse_service.create(db, data, creator_id=user.id)
    return VerseAdminItem.model_validate(verse)


@router.patch("/{verse_id}", response_model=VerseAdminItem)
async def update_verse(verse_id: uuid.UUID, data: VerseUpdate, _user: EditorPlus, db: DbDep) -> VerseAdminItem:
    try:
        verse = await verse_service.update(db, verse_id, data)
    except VerseError as exc:
        raise _err(exc)
    return VerseAdminItem.model_validate(verse)


@router.delete("/{verse_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_verse(verse_id: uuid.UUID, _user: EditorPlus, db: DbDep) -> Response:
    try:
        await verse_service.delete(db, verse_id)
    except VerseError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
