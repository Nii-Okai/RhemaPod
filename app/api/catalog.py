"""Public catalog reads.

All published sermons are visible; the per-user `locked` flag tells the client
what to gate. Playback itself is enforced by the streaming endpoint.
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_optional_user
from app.db.database import get_read_db
from app.models.content_schemas import CategoryPublic, SermonDetail, SermonListItem
from app.models.models import User
from app.services import content_service
from app.services.content_service import ContentError

router = APIRouter(prefix="/catalog", tags=["catalog"])

ReadDbDep = Annotated[AsyncSession, Depends(get_read_db)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


@router.get("/sermons", response_model=list[SermonListItem])
async def list_sermons(db: ReadDbDep, user: OptionalUser) -> list[SermonListItem]:
    return await content_service.list_published_sermons(db, user)


@router.get("/sermons/{sermon_id}", response_model=SermonDetail)
async def get_sermon(
    sermon_id: uuid.UUID, db: ReadDbDep, user: OptionalUser
) -> SermonDetail:
    try:
        return await content_service.get_sermon_detail(db, sermon_id, user)
    except ContentError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@router.get("/categories", response_model=list[CategoryPublic])
async def get_categories(db: ReadDbDep) -> list[CategoryPublic]:
    """All categories. Flat — categories have no parent."""
    rows = await content_service.list_categories(db)
    return [CategoryPublic.model_validate(c) for c in rows]
