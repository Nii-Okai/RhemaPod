import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, get_optional_user, require_role
from app.db.database import get_db, get_read_db
from app.models.content_schemas import (
    SpeakerCreate,
    SpeakerPublic,
    SpeakerUpdate,
)

from app.models.models import Speaker, User, UserRole
from app.services import content_service
from app.services.content_service import ContentError

router = APIRouter(prefix="/speakers", tags=["speakers"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ReadDbDep = Annotated[AsyncSession, Depends(get_read_db)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
EditorPlus = Annotated[CurrentUser, Depends(require_role(UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN))]
ManagerPlus = Annotated[CurrentUser, Depends(require_role(UserRole.MANAGER, UserRole.ADMIN))]


def _err(exc: ContentError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


def _speaker_public(row: tuple[Speaker, int]) -> SpeakerPublic:
    speaker, sermon_count = row
    return SpeakerPublic(**content_service.speaker_to_public(speaker, sermon_count))


# Speakers
@router.post("", response_model=SpeakerPublic, status_code=status.HTTP_201_CREATED)
async def create_speaker(data: SpeakerCreate, user: EditorPlus, db: DbDep) -> SpeakerPublic:
    speaker = Speaker(name=data.name, bio=data.bio)
    db.add(speaker)
    await db.commit()
    await db.refresh(speaker)
    return _speaker_public(
        await content_service.get_speaker_with_count(
            db, speaker.id, include_unpublished=True
        )
    )


@router.get("", response_model=list[SpeakerPublic])
async def list_speakers(db: ReadDbDep, user: OptionalUser) -> list[SpeakerPublic]:
    # Count scoping (Option B): staff callers get the true all-status count,
    # anon/viewer get published-only. See `staff_sees_full_counts`.
    rows = await content_service.list_speakers_with_counts(
        db, include_unpublished=content_service.staff_sees_full_counts(user)
    )
    return [_speaker_public(row) for row in rows]


@router.get("/{speaker_id}", response_model=SpeakerPublic)
async def get_speaker(
    speaker_id: uuid.UUID, db: ReadDbDep, user: OptionalUser
) -> SpeakerPublic:
    try:
        row = await content_service.get_speaker_with_count(
            db, speaker_id,
            include_unpublished=content_service.staff_sees_full_counts(user),
        )
    except ContentError as exc:
        raise _err(exc)
    return _speaker_public(row)


@router.patch("/{speaker_id}", response_model=SpeakerPublic)
async def update_speaker(
    speaker_id: uuid.UUID, data: SpeakerUpdate, user: EditorPlus, db: DbDep
) -> SpeakerPublic:
    provided = data.model_dump(exclude_unset=True)
    try:
        speaker = await content_service.update_speaker(
            db, speaker_id, name=data.name, bio=data.bio, bio_set="bio" in provided
        )
        row = await content_service.get_speaker_with_count(
            db, speaker.id, include_unpublished=True
        )
    except ContentError as exc:
        raise _err(exc)
    return _speaker_public(row)


@router.delete("/{speaker_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_speaker(speaker_id: uuid.UUID, user: ManagerPlus, db: DbDep) -> Response:
    try:
        await content_service.delete_speaker(db, speaker_id)
    except ContentError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
