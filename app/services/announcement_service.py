"""Announcements: CRUD, publication, and the public visibility rule.

Visibility is derived, not stored
---------------------------------
An announcement is visible when it is PUBLISHED, its publish_at has passed (or
is unset), and its expires_at has not (or is unset). Computing that at query
time means a 9am announcement appears at 9am with no scheduler running, and
there is no drift between a status column and the clock.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.models import (
    Announcement,
    AnnouncementApprovalLog,
    AnnouncementStatus,
    User,
    UserRole,
)
from app.services.approval import (
    TransitionError,
    resolve_announcement_transition,
)
from app.models.content_schemas import AnnouncementApprovalLogItem
from app.services.content_service import ContentError, display_name

settings = get_settings()
log = get_logger("announcements")

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; treat them as UTC so comparisons work."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def is_visible(ann: Announcement, at: datetime | None = None) -> bool:
    now = at or _now()
    if ann.status != AnnouncementStatus.PUBLISHED:
        return False
    publish_at = _as_utc(ann.publish_at)
    expires_at = _as_utc(ann.expires_at)
    if publish_at is not None and publish_at > now:
        return False
    if expires_at is not None and expires_at <= now:
        return False
    return True


def image_url(key: str | None) -> str | None:
    """Resolve a stored image key to a fetchable URL (CDN, else signed)."""
    if not key:
        return None
    if settings.cdn_base_url:
        return f"{settings.cdn_base_url.rstrip('/')}/{key}"
    from app.core import storage as storage_module

    try:
        return storage_module.get_storage().presigned_download_url(
            settings.s3_media_bucket, key, settings.stream_url_expire_seconds
        )
    except Exception:
        log.warning("announcement_image_url_failed", key=key)
        return None


def to_public(ann: Announcement) -> dict:
    return {
        "id": ann.id,
        "title": ann.title,
        "description": ann.description,
        "image_url": image_url(ann.image_key),
        "pinned": ann.pinned,
        "publish_at": ann.publish_at,
        "created_at": ann.created_at,
        "body": ann.body,
        "expires_at": ann.expires_at,
    }


def to_admin(ann: Announcement) -> dict:
    return {
        **to_public(ann),
        "status": ann.status,
        "is_visible": is_visible(ann),
        "created_by": ann.created_by,
    }


# ── Public reads ──────────────────────────────────────────────────────────────
async def list_visible(db: AsyncSession) -> list[Announcement]:
    """Published, live announcements — pinned first, then newest.

    Open to everyone, including anonymous callers.
    """
    now = _now()
    stmt = (
        select(Announcement)
        .where(
            Announcement.status == AnnouncementStatus.PUBLISHED,
            or_(Announcement.publish_at.is_(None), Announcement.publish_at <= now),
            or_(Announcement.expires_at.is_(None), Announcement.expires_at > now),
        )
        .order_by(
            Announcement.pinned.desc(),
            Announcement.publish_at.desc().nullslast(),
            Announcement.created_at.desc(),
        )
    )
    return list((await db.execute(stmt)).scalars().all())


async def get_visible(db: AsyncSession, announcement_id: uuid.UUID) -> Announcement:
    ann = await db.get(Announcement, announcement_id)
    # A scheduled or draft announcement must be indistinguishable from one that
    # does not exist — otherwise the ID leaks unpublished content.
    if ann is None or not is_visible(ann):
        raise ContentError("Announcement not found", status_code=404)
    return ann


# ── Staff reads ───────────────────────────────────────────────────────────────
async def list_all(
    db: AsyncSession,
    requester: User,
    status_filter: AnnouncementStatus | None = None,
    limit: int = 25,
    offset: int = 0,
) -> tuple[list[Announcement], int]:
    """Editors see only their own announcements; managers and admins see all.

    Returns (rows, total) — total is the count before paging.
    """
    from sqlalchemy import func

    conditions = []
    if requester.role == UserRole.EDITOR:
        conditions.append(Announcement.created_by == requester.id)
    if status_filter is not None:
        conditions.append(Announcement.status == status_filter)

    total = (await db.execute(
        select(func.count()).select_from(Announcement).where(*conditions)
    )).scalar_one()

    stmt = (
        select(Announcement)
        .where(*conditions)
        .order_by(Announcement.pinned.desc(), Announcement.created_at.desc())
        .limit(max(1, min(limit, 100)))
        .offset(max(0, offset))
    )
    return list((await db.execute(stmt)).scalars().all()), total


async def get_any(db: AsyncSession, announcement_id: uuid.UUID) -> Announcement:
    ann = await db.get(Announcement, announcement_id)
    if ann is None:
        raise ContentError("Announcement not found", status_code=404)
    return ann


# ── Writes ────────────────────────────────────────────────────────────────────
async def create(db: AsyncSession, data: dict, actor: User) -> Announcement:
    ann = Announcement(
        title=data["title"],
        description=data.get("description"),
        body=data["body"],
        pinned=data.get("pinned", False),
        publish_at=data.get("publish_at"),
        expires_at=data.get("expires_at"),
        status=AnnouncementStatus.DRAFT,
        created_by=actor.id,
    )
    db.add(ann)
    await db.commit()
    await db.refresh(ann)
    log.info("announcement_created", announcement_id=str(ann.id), by=str(actor.id))
    return ann


async def _load_editable(
    db: AsyncSession, announcement_id: uuid.UUID, actor: User
) -> Announcement:
    """Fetch an announcement the actor is allowed to modify.

    Editors may only touch their own work, and only while it is still a draft
    or was rejected — once submitted it belongs to the reviewer.
    """
    ann = await get_any(db, announcement_id)
    if actor.role == UserRole.EDITOR:
        if ann.created_by != actor.id:
            raise ContentError("You can only edit your own announcements", 403)
        if ann.status not in (AnnouncementStatus.DRAFT, AnnouncementStatus.REJECTED):
            raise ContentError(
                "This announcement is under review — ask a manager to change it",
                status_code=409,
            )
    return ann


async def update(
    db: AsyncSession, announcement_id: uuid.UUID, fields: dict, actor: User
) -> Announcement:
    ann = await _load_editable(db, announcement_id, actor)

    publish_at = fields.get("publish_at", ann.publish_at)
    expires_at = fields.get("expires_at", ann.expires_at)
    if publish_at and expires_at and _as_utc(expires_at) <= _as_utc(publish_at):
        raise ContentError("expires_at must be after publish_at", status_code=400)

    for key, value in fields.items():
        setattr(ann, key, value)
    await db.commit()
    await db.refresh(ann)
    log.info("announcement_updated", announcement_id=str(ann.id), by=str(actor.id))
    return ann


async def delete(db: AsyncSession, announcement_id: uuid.UUID, actor: User) -> None:
    ann = await get_any(db, announcement_id)
    # Never hard-delete something the public can see — unpublish first.
    if ann.status == AnnouncementStatus.PUBLISHED:
        raise ContentError(
            "Unpublish the announcement before deleting it", status_code=409
        )
    if actor.role == UserRole.EDITOR:
        if ann.created_by != actor.id:
            raise ContentError("You can only delete your own announcements", 403)
        if ann.status not in (AnnouncementStatus.DRAFT, AnnouncementStatus.REJECTED):
            raise ContentError(
                "Editors can only delete draft or rejected announcements", 403
            )
    await db.delete(ann)
    await db.commit()
    log.info("announcement_deleted", announcement_id=str(announcement_id), by=str(actor.id))


async def transition(
    db: AsyncSession,
    announcement_id: uuid.UUID,
    action: str,
    actor: User,
    note: str | None = None,
) -> Announcement:
    """Apply an approval-workflow action, writing an audit row for every change."""
    ann = await get_any(db, announcement_id)

    # Editors may only submit their own work.
    if (
        action == "submit"
        and actor.role == UserRole.EDITOR
        and ann.created_by != actor.id
    ):
        raise ContentError("You can only submit your own announcements", 403)

    try:
        new_status = resolve_announcement_transition(action, ann.status, actor.role)
    except TransitionError as exc:
        # 403 when the role is the problem, 409 when the current state is.
        code = 403 if "may not perform" in exc.message else 409
        raise ContentError(exc.message, status_code=code)

    from_status = ann.status
    ann.status = new_status

    # Publishing with no explicit schedule means "now".
    if new_status == AnnouncementStatus.PUBLISHED and ann.publish_at is None:
        ann.publish_at = _now()

    db.add(AnnouncementApprovalLog(
        announcement_id=ann.id,
        from_status=from_status.value,
        to_status=new_status.value,
        actor_id=actor.id,
        note=note,
    ))
    await db.commit()
    await db.refresh(ann)
    log.info(
        "announcement_transition",
        announcement_id=str(ann.id),
        action=action,
        from_status=from_status.value,
        to_status=new_status.value,
        by=str(actor.id),
    )
    return ann


async def review_queue(db: AsyncSession) -> list[Announcement]:
    """Announcements waiting on a manager."""
    stmt = (
        select(Announcement)
        .where(Announcement.status == AnnouncementStatus.PENDING_REVIEW)
        .order_by(Announcement.updated_at.asc().nullslast())
    )
    return list((await db.execute(stmt)).scalars().all())


async def approval_history(
    db: AsyncSession, announcement_id: uuid.UUID
) -> list[AnnouncementApprovalLogItem]:
    """Announcement approval log, oldest first, each row carrying the actor's
    display name (left join on `users`; NULL-safe). Mirrors the sermon
    `_approval_log_items` shape."""
    rows = (await db.execute(
        select(AnnouncementApprovalLog, User.full_name, User.email)
        .outerjoin(User, User.id == AnnouncementApprovalLog.actor_id)
        .where(AnnouncementApprovalLog.announcement_id == announcement_id)
        .order_by(AnnouncementApprovalLog.created_at.asc())
    )).all()
    return [
        AnnouncementApprovalLogItem(
            from_status=entry.from_status,
            to_status=entry.to_status,
            actor_id=entry.actor_id,
            actor_name=display_name(full_name, email),
            note=entry.note,
            created_at=entry.created_at,
        )
        for entry, full_name, email in rows
    ]


# ── Image upload ──────────────────────────────────────────────────────────────
async def create_image_ticket(
    db: AsyncSession, announcement_id: uuid.UUID, actor: User,
    filename: str, content_type: str,
) -> dict:
    from app.core import storage as storage_module

    if content_type.lower() not in ALLOWED_IMAGE_TYPES:
        raise ContentError(
            f"Unsupported image type '{content_type}'. Use JPEG, PNG, or WebP.",
            status_code=400,
        )
    ann = await _load_editable(db, announcement_id, actor)
    key = storage_module.thumbnail_key("announcements", ann.id, filename)
    url = storage_module.get_storage().presigned_upload_url(
        settings.s3_media_bucket, key, content_type,
        settings.upload_url_expire_seconds,
    )
    return {
        "upload_url": url,
        "headers": {"Content-Type": content_type},
        "expires_in": settings.upload_url_expire_seconds,
        "thumbnail_key": key,
    }


async def confirm_image(
    db: AsyncSession, announcement_id: uuid.UUID, actor: User, key: str
) -> str | None:
    from app.core import storage as storage_module

    ann = await _load_editable(db, announcement_id, actor)

    # The key comes from the client, so confine it to this announcement's
    # prefix — otherwise a caller could point the image at any bucket object.
    if not key.startswith(f"thumbnails/announcements/{ann.id}/"):
        raise ContentError("Image key does not belong to this announcement", 400)

    if not storage_module.get_storage().object_exists(settings.s3_media_bucket, key):
        raise ContentError(
            "No uploaded image found — complete the PUT first", status_code=409
        )

    ann.image_key = key
    await db.commit()
    log.info("announcement_image_set", announcement_id=str(ann.id), by=str(actor.id))
    return image_url(key)
