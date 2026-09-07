import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import CurrentUser, get_optional_user, require_role
from app.db.database import get_db, get_read_db
from app.models.content_schemas import (
    CategoryCreate,
    CategoryPublic,
    CategoryUpdate,
)

from app.models.models import User, UserRole
from app.services import content_service
from app.services.content_service import ContentError

router = APIRouter(prefix="/categories", tags=["categories"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ReadDbDep = Annotated[AsyncSession, Depends(get_read_db)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
EditorPlus = Annotated[CurrentUser, Depends(require_role(UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN))]
ManagerPlus = Annotated[CurrentUser, Depends(require_role(UserRole.MANAGER, UserRole.ADMIN))]


def _err(exc: ContentError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


# Categories
@router.post("", response_model=CategoryPublic, status_code=status.HTTP_201_CREATED)
async def create_category(data: CategoryCreate, user: ManagerPlus, db: DbDep) -> CategoryPublic:
    try:
        cat = await content_service.create_category(db, data.name, data.slug)
    except ContentError as exc:
        raise _err(exc)
    return CategoryPublic.model_validate(cat)


@router.get("", response_model=list[CategoryPublic])
async def list_categories(db: ReadDbDep) -> list[CategoryPublic]:
    rows = await content_service.list_categories(db)
    return [CategoryPublic.model_validate(c) for c in rows]


@router.get("/{category_id}", response_model=CategoryPublic)
async def get_category(category_id: uuid.UUID, db: ReadDbDep) -> CategoryPublic:
    try:
        cat = await content_service.get_category(db, category_id)
    except ContentError as exc:
        raise _err(exc)
    return CategoryPublic.model_validate(cat)


@router.patch("/{category_id}", response_model=CategoryPublic)
async def update_category(
    category_id: uuid.UUID, data: CategoryUpdate, user: ManagerPlus, db: DbDep
) -> CategoryPublic:
    try:
        cat = await content_service.update_category(
            db, category_id, name=data.name, slug=data.slug
        )
    except ContentError as exc:
        raise _err(exc)
    return CategoryPublic.model_validate(cat)


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(category_id: uuid.UUID, user: ManagerPlus, db: DbDep) -> Response:
    try:
        await content_service.delete_category(db, category_id)
    except ContentError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)