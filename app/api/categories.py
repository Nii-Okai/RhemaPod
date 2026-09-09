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


def _category_public(row: tuple[object, int]) -> CategoryPublic:
    cat, sermon_count = row
    return CategoryPublic(**content_service.category_to_public(cat, sermon_count))


# Categories
@router.post("", response_model=CategoryPublic, status_code=status.HTTP_201_CREATED)
async def create_category(data: CategoryCreate, user: EditorPlus, db: DbDep) -> CategoryPublic:
    try:
        cat = await content_service.create_category(db, data.name, data.slug)
        row = await content_service.get_category_with_count(
            db, cat.id, include_unpublished=True
        )
    except ContentError as exc:
        raise _err(exc)
    return _category_public(row)


@router.get("", response_model=list[CategoryPublic])
async def list_categories(db: ReadDbDep, user: OptionalUser) -> list[CategoryPublic]:
    # Count scoping (Option B): staff callers get the true all-status count,
    # anon/viewer get published-only. See `staff_sees_full_counts`.
    rows = await content_service.list_categories_with_counts(
        db, include_unpublished=content_service.staff_sees_full_counts(user)
    )
    return [_category_public(row) for row in rows]


@router.get("/{category_id}", response_model=CategoryPublic)
async def get_category(
    category_id: uuid.UUID, db: ReadDbDep, user: OptionalUser
) -> CategoryPublic:
    try:
        row = await content_service.get_category_with_count(
            db, category_id,
            include_unpublished=content_service.staff_sees_full_counts(user),
        )
    except ContentError as exc:
        raise _err(exc)
    return _category_public(row)


@router.patch("/{category_id}", response_model=CategoryPublic)
async def update_category(
    category_id: uuid.UUID, data: CategoryUpdate, user: EditorPlus, db: DbDep
) -> CategoryPublic:
    try:
        cat = await content_service.update_category(
            db, category_id, name=data.name, slug=data.slug
        )
        row = await content_service.get_category_with_count(
            db, cat.id, include_unpublished=True
        )
    except ContentError as exc:
        raise _err(exc)
    return _category_public(row)


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_category(category_id: uuid.UUID, user: ManagerPlus, db: DbDep) -> Response:
    try:
        await content_service.delete_category(db, category_id)
    except ContentError as exc:
        raise _err(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)