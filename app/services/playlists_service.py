"""Playlist service (Isaac's ask, session 2026-10-10): CRUD for viewer-owned
playlists, the backend behind the Library tab's "create playlists" half.
Every write is owner-only (`_get_owned_playlist`); a missing or not-owned
playlist is always a 404, same privacy-by-silence rule every other
owner-scoped resource in this app follows. The one cross-user path is the
read-only `get_playlist_detail`: a signed-in non-owner may read a PUBLIC
playlist (share links, ADR 0021 Phase 2) unless a block exists in either
direction; private, missing and blocked are one identical 404.

A playlist item always points at a `Sermon` row — series episodes ARE sermons
(`Sermon.series_id`), so "sermons and episodes" needs no second content type
or polymorphic column, unlike the Like tables' sermon/series split.
"""
import uuid

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.content_schemas import (
    PlaylistCoverTicket,
    PlaylistDetail,
    PlaylistItemPublic,
    PlaylistPublic,
)
from app.core.text_safety import (
    contains_blocked_term,
    contains_contact,
    contains_url,
    normalise_text,
)
from app.models.models import (
    VIEWER_VISIBLE_STATUSES,
    Playlist,
    PlaylistItem,
    Sermon,
    User,
    UserBlock,
    UserRole,
)
from app.services import content_service
from app.services.content_service import (
    ContentError,
    display_name,
    effective_tier,
    load_ref_names,
    public_display_name,
    sermon_publish_time_passed,
    sermon_visibility_clause,
    to_list_item,
)

settings = get_settings()
log = get_logger("playlists")


def _cover_url(key: str | None) -> str | None:
    """Mirrors `auth_service._avatar_url` — the playlist-domain copy of the
    stored-key -> presigned-then-CDN URL path every cover image in this app
    uses."""
    if not key:
        return None
    from app.core import storage as storage_module

    return storage_module.stable_image_url(key)


async def _item_aggregates(
    db: AsyncSession, playlist_ids: list[uuid.UUID]
) -> dict[uuid.UUID, tuple[int, int]]:
    """`{playlist_id: (visible_item_count, total_duration_seconds)}` — counts
    only currently-visible sermons, so a card's duration never counts a
    sermon that was unpublished after being added (matches `get_playlist_
    detail`'s own item filtering)."""
    if not playlist_ids:
        return {}
    rows = (await db.execute(
        select(
            PlaylistItem.playlist_id,
            func.count(PlaylistItem.id),
            func.coalesce(func.sum(Sermon.duration_seconds), 0),
        )
        .join(Sermon, Sermon.id == PlaylistItem.sermon_id)
        .where(PlaylistItem.playlist_id.in_(playlist_ids))
        .where(*sermon_visibility_clause())
        .group_by(PlaylistItem.playlist_id)
    )).all()
    return {pid: (count, int(total)) for pid, count, total in rows}


def _to_public(playlist: Playlist, owner_name: str | None, count: int, duration: int) -> PlaylistPublic:
    return PlaylistPublic(
        id=playlist.id,
        name=playlist.name,
        description=playlist.description,
        is_public=playlist.is_public,
        cover_url=_cover_url(playlist.cover_key),
        owner_name=owner_name,
        item_count=count,
        total_duration_seconds=duration,
        created_at=playlist.created_at,
        updated_at=playlist.updated_at,
    )


async def _get_owned_playlist(db: AsyncSession, user: User, playlist_id: uuid.UUID) -> Playlist:
    playlist = await db.get(Playlist, playlist_id)
    if playlist is None or playlist.user_id != user.id:
        raise ContentError("Playlist not found", status_code=404)
    return playlist


def _not_found() -> ContentError:
    # One constructor for every non-readable case, so the body can never differ.
    return ContentError("Playlist not found", status_code=404)


async def _get_readable_playlist(
    db: AsyncSession, viewer: User, playlist_id: uuid.UUID
) -> tuple[Playlist, User]:
    """`(playlist, owner)` if `viewer` may read it, else the uniform 404.

    The owner always may. A non-owner needs `is_public` and no `UserBlock` in
    either direction between viewer and owner. Missing, private and blocked are
    indistinguishable (no existence oracle)."""
    playlist = await db.get(Playlist, playlist_id)
    if playlist is None:
        raise _not_found()
    if playlist.user_id == viewer.id:
        return playlist, viewer
    if not playlist.is_public:
        raise _not_found()
    blocked = (await db.execute(
        select(UserBlock.id).where(or_(
            and_(UserBlock.blocker_id == viewer.id, UserBlock.blocked_id == playlist.user_id),
            and_(UserBlock.blocker_id == playlist.user_id, UserBlock.blocked_id == viewer.id),
        )).limit(1)
    )).first()
    owner = await db.get(User, playlist.user_id)
    if blocked is not None or owner is None:
        raise _not_found()
    return playlist, owner


def _validate_public_text(name: str, description: str | None) -> None:
    """Make-public content rule (SL0 decision 6): user-written text visible to
    link recipients passes the same URL / contact / blocklist rules as comments.
    Messages don't say which field or term matched."""
    for raw in (name, description):
        if not raw:
            continue
        text = normalise_text(raw)
        if contains_url(text):
            raise ContentError("Links are not allowed in public playlists", status_code=400)
        if contains_contact(text):
            raise ContentError("Contact details are not allowed in public playlists", status_code=400)
        if contains_blocked_term(text):
            raise ContentError("This playlist can't be made public", status_code=400)


async def list_playlists(db: AsyncSession, user: User) -> list[PlaylistPublic]:
    playlists = (await db.execute(
        select(Playlist).where(Playlist.user_id == user.id).order_by(Playlist.created_at.desc())
    )).scalars().all()
    agg = await _item_aggregates(db, [p.id for p in playlists])
    owner_name = display_name(user.full_name)
    return [_to_public(p, owner_name, *agg.get(p.id, (0, 0))) for p in playlists]


async def create_playlist(
    db: AsyncSession, user: User, name: str, description: str | None, is_public: bool
) -> PlaylistPublic:
    name = name.strip()
    description = (description.strip() or None) if description else None
    if is_public:
        _validate_public_text(name, description)
    playlist = Playlist(
        user_id=user.id,
        name=name,
        description=description,
        is_public=is_public,
    )
    db.add(playlist)
    await db.commit()
    await db.refresh(playlist)
    log.info("playlist_created", user_id=str(user.id), playlist_id=str(playlist.id))
    return _to_public(playlist, display_name(user.full_name), 0, 0)


async def update_playlist(
    db: AsyncSession, user: User, playlist_id: uuid.UUID, fields: dict
) -> PlaylistPublic:
    """Applies a `PlaylistUpdate` patch (`fields` is already `model_dump(
    exclude_unset=True)` from the router — same convention `update_series`
    uses, so an omitted field is left untouched rather than nulled)."""
    playlist = await _get_owned_playlist(db, user, playlist_id)
    if "name" in fields and fields["name"] is not None:
        fields["name"] = fields["name"].strip()
    if "description" in fields:
        fields["description"] = fields["description"].strip() or None if fields["description"] else None
    final_public = fields.get("is_public", playlist.is_public)
    if final_public:
        _validate_public_text(
            fields.get("name", playlist.name), fields.get("description", playlist.description)
        )
    for key, value in fields.items():
        setattr(playlist, key, value)
    await db.commit()
    await db.refresh(playlist)
    count, duration = (await _item_aggregates(db, [playlist.id])).get(playlist.id, (0, 0))
    return _to_public(playlist, display_name(user.full_name), count, duration)


async def delete_playlist(db: AsyncSession, user: User, playlist_id: uuid.UUID) -> None:
    playlist = await _get_owned_playlist(db, user, playlist_id)
    await db.delete(playlist)
    await db.commit()
    log.info("playlist_deleted", user_id=str(user.id), playlist_id=str(playlist_id))


async def get_playlist_detail(db: AsyncSession, user: User, playlist_id: uuid.UUID) -> PlaylistDetail:
    playlist, owner = await _get_readable_playlist(db, user, playlist_id)
    is_owner = owner.id == user.id
    item_rows = (await db.execute(
        select(PlaylistItem).where(PlaylistItem.playlist_id == playlist.id).order_by(PlaylistItem.position)
    )).scalars().all()

    sermon_ids = [item.sermon_id for item in item_rows]
    sermons: dict[uuid.UUID, Sermon] = {}
    if sermon_ids:
        rows = (await db.execute(select(Sermon).where(Sermon.id.in_(sermon_ids)))).scalars().all()
        sermons = {s.id: s for s in rows}

    has_sub = await content_service._has_subscription(db, user)
    names = await load_ref_names(
        db, list(sermons.values()),
        # A non-owner never gets staff's draft-series titles, even if staff.
        include_draft_series=is_owner and content_service.staff_sees_full_counts(user),
    )
    series_map = await content_service._series_map(db, list(sermons.values()))

    items: list[PlaylistItemPublic] = []
    for item in item_rows:
        sermon = sermons.get(item.sermon_id)
        if sermon is None:
            continue
        visible = sermon.status in VIEWER_VISIBLE_STATUSES and sermon_publish_time_passed(sermon)
        if not visible:
            continue
        tier = effective_tier(sermon, series_map.get(sermon.series_id))
        items.append(PlaylistItemPublic(
            id=item.id,
            position=item.position,
            added_at=item.added_at,
            sermon=to_list_item(sermon, tier, has_sub, names),
        ))

    total_duration = sum((i.sermon.duration_seconds or 0) for i in items)
    owner_name = display_name(owner.full_name) if is_owner else public_display_name(owner.full_name)
    public = _to_public(playlist, owner_name, len(items), total_duration)
    return PlaylistDetail(**public.model_dump(), is_owner=is_owner, items=items)


async def add_item(
    db: AsyncSession, user: User, playlist_id: uuid.UUID, sermon_id: uuid.UUID
) -> PlaylistDetail:
    playlist = await _get_owned_playlist(db, user, playlist_id)
    sermon = await db.get(Sermon, sermon_id)
    if sermon is None:
        raise ContentError("Sermon not found", status_code=404)
    # Same visibility gate `get_sermon_detail` applies — staff can add their
    # own work-in-progress, a viewer can only add what's actually live.
    is_staff = user.role in (UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN)
    visible = sermon.status in VIEWER_VISIBLE_STATUSES and sermon_publish_time_passed(sermon)
    if not visible and not is_staff:
        raise ContentError("Sermon not found", status_code=404)

    next_position = (await db.execute(
        select(func.max(PlaylistItem.position)).where(PlaylistItem.playlist_id == playlist.id)
    )).scalar_one_or_none()
    db.add(PlaylistItem(
        playlist_id=playlist.id,
        sermon_id=sermon.id,
        position=(next_position if next_position is not None else -1) + 1,
    ))
    await db.commit()
    log.info("playlist_item_added", user_id=str(user.id), playlist_id=str(playlist.id), sermon_id=str(sermon.id))
    return await get_playlist_detail(db, user, playlist.id)


async def remove_item(
    db: AsyncSession, user: User, playlist_id: uuid.UUID, item_id: uuid.UUID
) -> PlaylistDetail:
    playlist = await _get_owned_playlist(db, user, playlist_id)
    result = await db.execute(
        delete(PlaylistItem).where(PlaylistItem.id == item_id, PlaylistItem.playlist_id == playlist.id)
    )
    if result.rowcount == 0:
        raise ContentError("Playlist item not found", status_code=404)
    await db.commit()
    log.info("playlist_item_removed", user_id=str(user.id), playlist_id=str(playlist.id), item_id=str(item_id))
    return await get_playlist_detail(db, user, playlist.id)


async def reorder_items(
    db: AsyncSession, user: User, playlist_id: uuid.UUID, item_ids: list[uuid.UUID]
) -> PlaylistDetail:
    """All-or-nothing, same shape `episode-order` reordering uses: `item_ids`
    must be exactly the playlist's current item ids, just in a new order."""
    playlist = await _get_owned_playlist(db, user, playlist_id)
    current_ids = set((await db.execute(
        select(PlaylistItem.id).where(PlaylistItem.playlist_id == playlist.id)
    )).scalars().all())
    if set(item_ids) != current_ids:
        raise ContentError("item_ids must match the playlist's current items exactly", status_code=400)
    for position, item_id in enumerate(item_ids):
        await db.execute(update(PlaylistItem).where(PlaylistItem.id == item_id).values(position=position))
    await db.commit()
    log.info("playlist_items_reordered", user_id=str(user.id), playlist_id=str(playlist.id))
    return await get_playlist_detail(db, user, playlist.id)


def _validate_cover_image_type(content_type: str) -> None:
    if content_type.lower() not in content_service.ALLOWED_IMAGE_TYPES:
        raise ContentError(
            f"Unsupported image type '{content_type}'. Use JPEG, PNG, or WebP.",
            status_code=400,
        )


async def create_cover_ticket(
    db: AsyncSession, user: User, playlist_id: uuid.UUID, filename: str, content_type: str
) -> PlaylistCoverTicket:
    """Issue a pre-signed PUT for a playlist cover — same direct-to-storage
    pattern the profile avatar ticket uses."""
    from app.core import storage as storage_module

    playlist = await _get_owned_playlist(db, user, playlist_id)
    _validate_cover_image_type(content_type)
    key = storage_module.playlist_cover_key(playlist.id, filename)
    url = storage_module.get_storage().presigned_upload_url(
        settings.object_store_media_bucket, key, content_type, settings.upload_url_expire_seconds,
    )
    return PlaylistCoverTicket(
        upload_url=url,
        headers={"Content-Type": content_type},
        expires_in=settings.upload_url_expire_seconds,
        cover_key=key,
    )


async def confirm_cover(
    db: AsyncSession, user: User, playlist_id: uuid.UUID, key: str
) -> str | None:
    """Attach an uploaded cover after verifying it actually landed — same
    verification sequence `auth_service.confirm_avatar` runs."""
    from app.core import storage as storage_module

    playlist = await _get_owned_playlist(db, user, playlist_id)

    expected_prefix = f"playlist_covers/{playlist.id}/"
    if not key.startswith(expected_prefix):
        raise ContentError("Cover key does not belong to this playlist", status_code=400)

    store = storage_module.get_storage()
    if not store.object_exists(settings.object_store_media_bucket, key):
        raise ContentError("No uploaded image found — complete the PUT first", status_code=409)

    size = store.object_size(settings.object_store_media_bucket, key)
    if size is not None and size > settings.max_thumbnail_bytes:
        try:
            store.delete_object(settings.object_store_media_bucket, key)
        except Exception:  # noqa: BLE001 - best-effort cleanup, still reject
            log.warning("oversize_playlist_cover_cleanup_failed", key=key)
        raise ContentError(
            f"Image is larger than the "
            f"{settings.max_thumbnail_bytes // (1024 * 1024)} MB limit.",
            status_code=413,
        )

    playlist.cover_key = key
    await db.commit()
    log.info("playlist_cover_set", user_id=str(user.id), playlist_id=str(playlist.id))
    return _cover_url(key)
