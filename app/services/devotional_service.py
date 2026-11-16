"""Daily devotional ("Daily Rhema"): visibility, evergreen fill, editorial
workflow, reading audio, passage lookup, CSV import and settings.

See plans/plan-daily-devotional.md and ADR 0022.

Dates are listener-local
------------------------
A devotional belongs to a calendar date, not an instant. Each app asks for its
own local date; the server only checks that the date is plausible for *some*
time zone right now (plus the 7-day offline prefetch window), so nobody can
pull next month's devotionals early through the public API.

Visibility is derived, not stored
---------------------------------
Live for date D = `status == APPROVED and date == D`. "Scheduled" and
"Published" are labels computed from the date (`display_status`), so a
devotional dated tomorrow becomes live at midnight with no worker running.
When no devotional is live for D, an approved evergreen row is picked by a
date-seeded shuffle — everyone gets the same one that day.
"""
from __future__ import annotations

import csv
import io
import random
import re
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

import httpx
from sqlalchemy import func, select, update as sa_update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.devotional_schemas import (
    DevotionalApprovalLogItem,
    DevotionalSettings,
    DevotionalSettingsUpdate,
    ImportResult,
    ImportRowResult,
)
from app.models.models import (
    AuditAction,
    AuditOutcome,
    ChurchSettings,
    Devotional,
    DevotionalApprovalLog,
    DevotionalStatus,
    ReadingFallback,
    Sermon,
    Speaker,
    User,
    UserRole,
)
from app.services import audit_service
from app.services.audit_service import AuditContext, AuditTarget
from app.services.content_service import (
    ContentError,
    display_name,
    sermon_publish_time_passed,
)

settings = get_settings()
log = get_logger("devotionals")

# A listener anywhere on Earth is at most one day behind or ahead of UTC.
# The app may prefetch this many days past its own "today" for offline use.
PAST_WINDOW_DAYS = 1
PREFETCH_DAYS = 7
MAX_IMPORT_ROWS = 400
MAX_READING_BYTES = 30 * 1024 * 1024

ALLOWED_AUDIO_TYPES = {
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/m4a": "m4a",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
}

# bible-api.com serves these public-domain translations without a key.
LOOKUP_TRANSLATIONS = {"kjv", "web"}
LOOKUP_URL = "https://bible-api.com/{reference}"
LOOKUP_TIMEOUT_S = 4.0
LOOKUP_CACHE_TTL_S = 24 * 3600

_SETTINGS_ID = 1


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


# ═══════════════════════════════════════════════════════════════════════════════
# Shared helpers
# ═══════════════════════════════════════════════════════════════════════════════
def display_status(dev: Devotional, today: date | None = None) -> str:
    if dev.status != DevotionalStatus.APPROVED:
        return dev.status.value
    if dev.date is None:
        return "evergreen"
    return "scheduled" if dev.date > (today or _utc_today()) else "published"


_VERSE_LINE = re.compile(r"^\s*(\d{1,3})[\s.:)]+(.*\S)\s*$")


def split_verses(passage_text: str) -> list[dict]:
    """One verse per non-blank line; a leading number becomes the verse number."""
    verses: list[dict] = []
    for line in passage_text.splitlines():
        if not line.strip():
            continue
        match = _VERSE_LINE.match(line)
        if match:
            verses.append({"number": int(match.group(1)), "text": match.group(2)})
        else:
            verses.append({"number": None, "text": line.strip()})
    return verses


def _word_in_text(word: str, text: str) -> bool:
    return re.search(rf"(?<![\w']){re.escape(word)}(?![\w'])", text, re.IGNORECASE) is not None


def _signed_url(key: str | None) -> str | None:
    if not key:
        return None
    from app.core import storage as storage_module

    try:
        return storage_module.stable_image_url(key)
    except Exception:
        log.warning("devotional_media_url_failed", key=key)
        return None


async def load_settings(db: AsyncSession) -> ChurchSettings:
    row = await db.get(ChurchSettings, _SETTINGS_ID)
    if row is None:
        log.error("church_settings_missing")
        raise ContentError("Church settings are not initialised.", status_code=503)
    return row


# ═══════════════════════════════════════════════════════════════════════════════
# Public
# ═══════════════════════════════════════════════════════════════════════════════
def check_window(day: date, today: date | None = None) -> None:
    today = today or _utc_today()
    if day < today - timedelta(days=PAST_WINDOW_DAYS) or day > today + timedelta(
        days=PAST_WINDOW_DAYS + PREFETCH_DAYS
    ):
        raise ContentError(
            "That date is outside the available window", status_code=422
        )


async def _evergreen_pool(db: AsyncSession) -> list[Devotional]:
    rows = (await db.execute(
        select(Devotional).where(
            Devotional.is_evergreen.is_(True),
            Devotional.status == DevotionalStatus.APPROVED,
        )
    )).scalars().all()
    return sorted(rows, key=lambda d: str(d.id))


def _pick_evergreen(pool: list[Devotional], day: date) -> Devotional | None:
    if not pool:
        return None
    return random.Random(f"devotional:{day.isoformat()}").choice(pool)


async def get_for_dates(
    db: AsyncSession, days: list[date]
) -> list[tuple[date, Devotional, str]]:
    """(date, devotional, source) for each date that has something to show."""
    dated = {
        d.date: d
        for d in (await db.execute(
            select(Devotional).where(
                Devotional.date.in_(days),
                Devotional.status == DevotionalStatus.APPROVED,
            )
        )).scalars().all()
    }
    pool: list[Devotional] | None = None
    out: list[tuple[date, Devotional, str]] = []
    for day in days:
        if day in dated:
            out.append((day, dated[day], "dated"))
            continue
        if pool is None:
            pool = await _evergreen_pool(db)
        pick = _pick_evergreen(pool, day)
        if pick is not None:
            out.append((day, pick, "evergreen"))
    return out


async def get_for_date(db: AsyncSession, day: date) -> tuple[Devotional, str]:
    check_window(day)
    found = await get_for_dates(db, [day])
    if not found:
        raise ContentError("No devotional for that date", status_code=404)
    _, dev, source = found[0]
    return dev, source


def resolve_fallback(dev: Devotional, church: ChurchSettings) -> str:
    if dev.reading_media_key:
        return ReadingFallback.TEXT.value
    if dev.reading_fallback is not None and church.devotional_allow_override:
        return dev.reading_fallback.value
    return church.devotional_reading_fallback


async def to_public(
    db: AsyncSession, dev: Devotional, day: date, source: str, church: ChurchSettings
) -> dict:
    author = None
    if dev.author_speaker_id:
        speaker = await db.get(Speaker, dev.author_speaker_id)
        if speaker is not None:
            author = {"id": speaker.id, "name": speaker.name}

    moment = None
    if dev.moment_sermon_id and dev.moment_start_s is not None:
        sermon = await db.get(Sermon, dev.moment_sermon_id)
        # Never leak an unpublished or not-yet-released sermon through a moment.
        from app.models.models import SermonStatus

        if (
            sermon is not None
            and sermon.status == SermonStatus.PUBLISHED
            and sermon_publish_time_passed(sermon)
        ):
            moment = {
                "sermon_id": sermon.id,
                "title": sermon.title,
                "cover_url": _signed_url(sermon.thumbnail_key),
                "start_s": dev.moment_start_s,
                "end_s": dev.moment_end_s,
            }

    reading_url = _signed_url(dev.reading_media_key)
    fallback = resolve_fallback(dev, church) if reading_url is None else "text"
    return {
        "id": dev.id,
        "date": day,
        "source": source,
        "title": dev.title,
        "author": author,
        "still": {
            "breath_in": dev.still_breath_in,
            "breath_out": dev.still_breath_out,
            "seconds": dev.still_seconds or church.devotional_still_seconds,
        },
        "passage": {
            "ref": dev.passage_ref,
            "translation": dev.passage_translation,
            "text": dev.passage_text,
            "verses": split_verses(dev.passage_text),
        },
        "suggested_word": dev.suggested_word,
        "reading": (
            {"url": reading_url, "duration_s": dev.reading_duration_s}
            if reading_url else None
        ),
        "reading_fallback": fallback,
        "tts": (
            {
                "voice": church.devotional_tts_voice,
                "rate": church.devotional_tts_rate_pct / 100,
            }
            if fallback == "tts" else None
        ),
        "reflection_md": dev.reflection_md,
        "moment": moment,
        "pray": {"question": dev.pray_question, "text": dev.pray_text},
        "carry_verse_ref": dev.carry_verse_ref or dev.passage_ref,
        "publish_hour": church.devotional_publish_hour,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Staff reads
# ═══════════════════════════════════════════════════════════════════════════════
async def _names(db: AsyncSession, devs: list[Devotional]) -> tuple[dict, dict]:
    speaker_ids = {d.author_speaker_id for d in devs if d.author_speaker_id}
    sermon_ids = {d.moment_sermon_id for d in devs if d.moment_sermon_id}
    speakers = {}
    sermons = {}
    if speaker_ids:
        speakers = dict((await db.execute(
            select(Speaker.id, Speaker.name).where(Speaker.id.in_(speaker_ids))
        )).all())
    if sermon_ids:
        sermons = dict((await db.execute(
            select(Sermon.id, Sermon.title).where(Sermon.id.in_(sermon_ids))
        )).all())
    return speakers, sermons


async def to_admin(db: AsyncSession, dev: Devotional) -> dict:
    speakers, sermons = await _names(db, [dev])
    return {
        "id": dev.id,
        "date": dev.date,
        "is_evergreen": dev.is_evergreen,
        "title": dev.title,
        "status": dev.status,
        "display_status": display_status(dev),
        "author_speaker_id": dev.author_speaker_id,
        "author_name": speakers.get(dev.author_speaker_id),
        "still_breath_in": dev.still_breath_in,
        "still_breath_out": dev.still_breath_out,
        "still_seconds": dev.still_seconds,
        "passage_ref": dev.passage_ref,
        "passage_translation": dev.passage_translation,
        "passage_text": dev.passage_text,
        "suggested_word": dev.suggested_word,
        "reading_url": _signed_url(dev.reading_media_key),
        "reading_duration_s": dev.reading_duration_s,
        "reading_fallback": dev.reading_fallback,
        "reflection_md": dev.reflection_md,
        "moment_sermon_id": dev.moment_sermon_id,
        "moment_sermon_title": sermons.get(dev.moment_sermon_id),
        "moment_start_s": dev.moment_start_s,
        "moment_end_s": dev.moment_end_s,
        "pray_question": dev.pray_question,
        "pray_text": dev.pray_text,
        "carry_verse_ref": dev.carry_verse_ref,
        "created_by": dev.created_by,
        "created_at": dev.created_at,
        "updated_at": dev.updated_at,
    }


def to_list_item(dev: Devotional, today: date | None = None) -> dict:
    return {
        "id": dev.id,
        "date": dev.date,
        "is_evergreen": dev.is_evergreen,
        "title": dev.title,
        "status": dev.status,
        "display_status": display_status(dev, today),
        "passage_ref": dev.passage_ref,
        "has_reading": bool(dev.reading_media_key),
        "created_by": dev.created_by,
        "updated_at": dev.updated_at,
    }


def _scope(requester: User) -> list:
    """Editors see their own work plus everything approved (so the calendar
    shows them which days are already taken); managers and admins see all."""
    if requester.role == UserRole.EDITOR:
        from sqlalchemy import or_

        return [or_(
            Devotional.created_by == requester.id,
            Devotional.status == DevotionalStatus.APPROVED,
        )]
    return []


async def list_all(
    db: AsyncSession,
    requester: User,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    status_filter: DevotionalStatus | None = None,
    evergreen: bool | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Devotional], int]:
    conditions = _scope(requester)
    if date_from is not None:
        conditions.append(Devotional.date >= date_from)
    if date_to is not None:
        conditions.append(Devotional.date <= date_to)
    if status_filter is not None:
        conditions.append(Devotional.status == status_filter)
    if evergreen is not None:
        conditions.append(Devotional.is_evergreen.is_(evergreen))

    total = (await db.execute(
        select(func.count()).select_from(Devotional).where(*conditions)
    )).scalar_one()
    rows = (await db.execute(
        select(Devotional)
        .where(*conditions)
        .order_by(Devotional.date.asc().nullslast(), Devotional.created_at.desc())
        .limit(max(1, min(limit, 200)))
        .offset(max(0, offset))
    )).scalars().all()
    return list(rows), total


async def calendar(
    db: AsyncSession, requester: User, date_from: date, date_to: date
) -> dict:
    if date_to < date_from:
        raise ContentError("`to` must not be before `from`", status_code=400)
    if (date_to - date_from).days > 400:
        raise ContentError("A calendar range can span at most 400 days", status_code=400)
    today = _utc_today()
    rows = (await db.execute(
        select(Devotional).where(
            Devotional.date >= date_from, Devotional.date <= date_to, *_scope(requester)
        )
    )).scalars().all()
    by_date = {d.date: d for d in rows}

    # Ready days ahead: consecutive approved days starting today, regardless of
    # the requested range or the requester's scope (approved rows are visible
    # to everyone in the portal).
    approved_ahead = set((await db.execute(
        select(Devotional.date).where(
            Devotional.date >= today,
            Devotional.date <= today + timedelta(days=366),
            Devotional.status == DevotionalStatus.APPROVED,
        )
    )).scalars().all())
    ready = 0
    while today + timedelta(days=ready) in approved_ahead:
        ready += 1

    church = await load_settings(db)
    evergreen_ready = (await db.execute(
        select(func.count()).select_from(Devotional).where(
            Devotional.is_evergreen.is_(True),
            Devotional.status == DevotionalStatus.APPROVED,
        )
    )).scalar_one()

    days = []
    cursor = date_from
    while cursor <= date_to:
        dev = by_date.get(cursor)
        days.append({
            "date": cursor,
            "devotional": to_list_item(dev, today) if dev is not None else None,
        })
        cursor += timedelta(days=1)
    return {
        "days": days,
        "ready_days_ahead": ready,
        "gap_alert_days": church.devotional_gap_alert_days,
        "evergreen_ready": evergreen_ready,
    }


async def get_any(db: AsyncSession, devotional_id: uuid.UUID) -> Devotional:
    dev = await db.get(Devotional, devotional_id)
    if dev is None:
        raise ContentError("Devotional not found", status_code=404)
    return dev


async def get_for_staff(
    db: AsyncSession, devotional_id: uuid.UUID, requester: User
) -> Devotional:
    dev = await get_any(db, devotional_id)
    if (
        requester.role == UserRole.EDITOR
        and dev.created_by != requester.id
        and dev.status != DevotionalStatus.APPROVED
    ):
        raise ContentError("Devotional not found", status_code=404)
    return dev


# ═══════════════════════════════════════════════════════════════════════════════
# Writes
# ═══════════════════════════════════════════════════════════════════════════════
_EDITABLE_STATES = (DevotionalStatus.DRAFT, DevotionalStatus.REJECTED)


async def _load_editable(
    db: AsyncSession, devotional_id: uuid.UUID, actor: User
) -> Devotional:
    dev = await get_any(db, devotional_id)
    if actor.role == UserRole.EDITOR:
        if dev.created_by != actor.id:
            raise ContentError("You can only edit your own devotionals", 403)
        if dev.status not in _EDITABLE_STATES:
            raise ContentError(
                "This devotional is under review or approved — ask a manager to change it",
                status_code=409,
            )
    elif dev.status in (DevotionalStatus.APPROVED, DevotionalStatus.ARCHIVED):
        # ADR 0022: an approved devotional changes only via "reject" (back to
        # editable) so the approval log always shows who signed off on what.
        raise ContentError(
            "Request changes on an approved devotional (or restore an archived one) "
            "before editing it",
            status_code=409,
        )
    return dev


async def _validate(db: AsyncSession, dev: Devotional) -> None:
    """Cross-field rules the column CHECKs can't express with a friendly message."""
    if dev.suggested_word and not _word_in_text(dev.suggested_word, dev.passage_text):
        raise ContentError(
            f"The suggested word “{dev.suggested_word}” isn't in the passage text",
            status_code=400,
        )
    if (dev.moment_start_s is None) != (dev.moment_end_s is None):
        raise ContentError("Set both the start and end of the sermon moment", 400)
    if (dev.moment_sermon_id is None) != (dev.moment_start_s is None):
        raise ContentError("A sermon moment needs a sermon and its start and end", 400)
    if dev.moment_start_s is not None:
        if dev.moment_end_s <= dev.moment_start_s:
            raise ContentError("The sermon moment must end after it starts", 400)
        if dev.moment_end_s - dev.moment_start_s > 600:
            raise ContentError("A sermon moment can be at most 10 minutes", 400)
        sermon = await db.get(Sermon, dev.moment_sermon_id)
        if sermon is None:
            raise ContentError("That sermon doesn't exist", 400)
        if sermon.duration_seconds and dev.moment_end_s > sermon.duration_seconds:
            raise ContentError("The sermon moment runs past the end of the sermon", 400)
    if dev.author_speaker_id and await db.get(Speaker, dev.author_speaker_id) is None:
        raise ContentError("That speaker doesn't exist", 400)


async def _date_taken(
    db: AsyncSession, day: date, exclude_id: uuid.UUID | None = None
) -> Devotional | None:
    stmt = select(Devotional).where(Devotional.date == day)
    if exclude_id is not None:
        stmt = stmt.where(Devotional.id != exclude_id)
    return (await db.execute(stmt)).scalars().first()


def _apply_date(dev: Devotional, day: date | None) -> None:
    dev.date = day
    dev.is_evergreen = day is None


async def _commit_dated(db: AsyncSession, dev: Devotional) -> None:
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ContentError(
            f"Another devotional is already scheduled for {dev.date}", status_code=409
        )


async def create(db: AsyncSession, data: dict, actor: User) -> Devotional:
    day = data.pop("date", None)
    if day is not None and await _date_taken(db, day):
        raise ContentError(
            f"Another devotional is already scheduled for {day}", status_code=409
        )
    dev = Devotional(**data, status=DevotionalStatus.DRAFT, created_by=actor.id)
    _apply_date(dev, day)
    await _validate(db, dev)
    db.add(dev)
    await _commit_dated(db, dev)
    await db.refresh(dev)
    log.info("devotional_created", devotional_id=str(dev.id), by=str(actor.id))
    return dev


async def update(
    db: AsyncSession, devotional_id: uuid.UUID, fields: dict, actor: User
) -> Devotional:
    dev = await _load_editable(db, devotional_id, actor)
    if "date" in fields:
        day = fields.pop("date")
        if day is not None and await _date_taken(db, day, exclude_id=dev.id):
            raise ContentError(
                f"Another devotional is already scheduled for {day}", status_code=409
            )
        _apply_date(dev, day)
    for key, value in fields.items():
        setattr(dev, key, value)
    await _validate(db, dev)
    await _commit_dated(db, dev)
    await db.refresh(dev)
    log.info("devotional_updated", devotional_id=str(dev.id), by=str(actor.id))
    return dev


async def delete(db: AsyncSession, devotional_id: uuid.UUID, actor: User) -> None:
    dev = await get_any(db, devotional_id)
    if dev.status == DevotionalStatus.APPROVED:
        raise ContentError("Archive an approved devotional before deleting it", 409)
    if actor.role == UserRole.EDITOR:
        if dev.created_by != actor.id:
            raise ContentError("You can only delete your own devotionals", 403)
        if dev.status not in _EDITABLE_STATES:
            raise ContentError("Editors can only delete draft or rejected devotionals", 403)
    await db.delete(dev)
    await db.commit()
    log.info("devotional_deleted", devotional_id=str(devotional_id), by=str(actor.id))


# action -> (allowed_from, to, roles)
TRANSITIONS: dict[str, tuple[tuple[DevotionalStatus, ...], DevotionalStatus, tuple[UserRole, ...]]] = {
    "submit": (
        (DevotionalStatus.DRAFT, DevotionalStatus.REJECTED),
        DevotionalStatus.PENDING_REVIEW,
        (UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN),
    ),
    "withdraw": (
        (DevotionalStatus.PENDING_REVIEW,),
        DevotionalStatus.DRAFT,
        (UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN),
    ),
    "approve": (
        (DevotionalStatus.PENDING_REVIEW,),
        DevotionalStatus.APPROVED,
        (UserRole.MANAGER, UserRole.ADMIN),
    ),
    "reject": (
        (DevotionalStatus.PENDING_REVIEW, DevotionalStatus.APPROVED),
        DevotionalStatus.REJECTED,
        (UserRole.MANAGER, UserRole.ADMIN),
    ),
    "archive": (
        (DevotionalStatus.APPROVED, DevotionalStatus.DRAFT, DevotionalStatus.REJECTED),
        DevotionalStatus.ARCHIVED,
        (UserRole.MANAGER, UserRole.ADMIN),
    ),
    "restore": (
        (DevotionalStatus.ARCHIVED,),
        DevotionalStatus.DRAFT,
        (UserRole.MANAGER, UserRole.ADMIN),
    ),
}


def resolve_transition(
    action: str, current: DevotionalStatus, role: UserRole
) -> DevotionalStatus:
    spec = TRANSITIONS.get(action)
    if spec is None:
        raise ContentError(f"Unknown action '{action}'", status_code=400)
    allowed_from, to_status, roles = spec
    if role not in roles:
        raise ContentError(f"Role '{role.value}' may not perform '{action}'", 403)
    if current not in allowed_from:
        raise ContentError(
            f"Cannot '{action}' a devotional in status '{current.value}'", 409
        )
    return to_status


async def transition(
    db: AsyncSession,
    devotional_id: uuid.UUID,
    action: str,
    actor: User,
    note: str | None = None,
) -> Devotional:
    dev = await get_any(db, devotional_id)
    if (
        action in ("submit", "withdraw")
        and actor.role == UserRole.EDITOR
        and dev.created_by != actor.id
    ):
        raise ContentError(f"You can only {action} your own devotionals", 403)
    # Segregation of duties, as for announcements: a manager can't approve
    # their own devotional; admins bypass.
    if action == "approve" and actor.id == dev.created_by and actor.role != UserRole.ADMIN:
        raise ContentError(
            "You can't approve your own devotional — another manager needs to review it",
            403,
        )
    if action == "reject" and not (note and note.strip()):
        raise ContentError("Say why it's being sent back", status_code=400)

    new_status = resolve_transition(action, dev.status, actor.role)
    from_status = dev.status
    dev.status = new_status
    db.add(DevotionalApprovalLog(
        devotional_id=dev.id,
        from_status=from_status.value,
        to_status=new_status.value,
        actor_id=actor.id,
        note=note,
    ))
    await db.commit()
    await db.refresh(dev)
    log.info(
        "devotional_transition",
        devotional_id=str(dev.id), action=action,
        from_status=from_status.value, to_status=new_status.value, by=str(actor.id),
    )
    return dev


async def review_queue(db: AsyncSession) -> list[Devotional]:
    return list((await db.execute(
        select(Devotional)
        .where(Devotional.status == DevotionalStatus.PENDING_REVIEW)
        .order_by(Devotional.date.asc().nullslast(), Devotional.updated_at.asc())
    )).scalars().all())


async def approval_history(
    db: AsyncSession, devotional_id: uuid.UUID
) -> list[DevotionalApprovalLogItem]:
    rows = (await db.execute(
        select(DevotionalApprovalLog, User.full_name)
        .outerjoin(User, User.id == DevotionalApprovalLog.actor_id)
        .where(DevotionalApprovalLog.devotional_id == devotional_id)
        .order_by(DevotionalApprovalLog.created_at.asc())
    )).all()
    return [
        DevotionalApprovalLogItem(
            from_status=entry.from_status,
            to_status=entry.to_status,
            actor_id=entry.actor_id,
            actor_name=display_name(full_name),
            note=entry.note,
            created_at=entry.created_at,
        )
        for entry, full_name in rows
    ]


# ═══════════════════════════════════════════════════════════════════════════════
# Pastor's reading (audio upload)
# ═══════════════════════════════════════════════════════════════════════════════
def _reading_prefix(devotional_id: uuid.UUID) -> str:
    return f"devotional_readings/{devotional_id}/"


async def create_reading_ticket(
    db: AsyncSession, devotional_id: uuid.UUID, actor: User,
    filename: str, content_type: str,
) -> dict:
    from app.core import storage as storage_module

    ext = ALLOWED_AUDIO_TYPES.get(content_type.lower())
    if ext is None:
        raise ContentError(
            f"Unsupported audio type '{content_type}'. Use MP3, M4A, AAC or WAV.", 400
        )
    dev = await _load_editable(db, devotional_id, actor)
    key = f"{_reading_prefix(dev.id)}{uuid.uuid4()}.{ext}"
    url = storage_module.get_storage().presigned_upload_url(
        settings.object_store_media_bucket, key, content_type,
        settings.upload_url_expire_seconds,
    )
    return {
        "upload_url": url,
        "headers": {"Content-Type": content_type},
        "expires_in": settings.upload_url_expire_seconds,
        "reading_key": key,
    }


async def confirm_reading(
    db: AsyncSession, devotional_id: uuid.UUID, actor: User,
    key: str, duration_s: int | None,
) -> Devotional:
    from app.core import storage as storage_module

    dev = await _load_editable(db, devotional_id, actor)
    if not key.startswith(_reading_prefix(dev.id)) or ".." in key:
        raise ContentError("Reading key does not belong to this devotional", 400)
    store = storage_module.get_storage()
    bucket = settings.object_store_media_bucket
    if not store.object_exists(bucket, key):
        raise ContentError("No uploaded reading found — complete the PUT first", 409)
    size = store.object_size(bucket, key)
    if size is not None and size > MAX_READING_BYTES:
        store.delete_object(bucket, key)
        raise ContentError("The reading is larger than 30 MB", 413)
    dev.reading_media_key = key
    dev.reading_duration_s = duration_s
    await db.commit()
    await db.refresh(dev)
    log.info("devotional_reading_set", devotional_id=str(dev.id), by=str(actor.id))
    return dev


async def remove_reading(
    db: AsyncSession, devotional_id: uuid.UUID, actor: User
) -> Devotional:
    dev = await _load_editable(db, devotional_id, actor)
    dev.reading_media_key = None
    dev.reading_duration_s = None
    await db.commit()
    await db.refresh(dev)
    return dev


# ═══════════════════════════════════════════════════════════════════════════════
# Passage lookup (bible-api.com, public-domain translations only)
# ═══════════════════════════════════════════════════════════════════════════════
async def lookup_passage(ref: str, translation: str) -> dict:
    translation = translation.lower().strip()
    ref = ref.strip()
    if translation not in LOOKUP_TRANSLATIONS:
        raise ContentError(
            "Auto-fill only covers KJV and WEB — paste other translations by hand", 400
        )
    if not ref or len(ref) > 100:
        raise ContentError("Enter a passage reference", 400)

    from app.core.redis import get_redis

    cache_key = f"devotional:passage:{translation}:{ref.lower()}"
    redis = get_redis()
    try:
        cached = await redis.get(cache_key)
    except Exception:
        cached = None
    if cached:
        text = cached.decode() if isinstance(cached, bytes) else cached
        canonical, _, body = text.partition("\n")
        return {"ref": canonical, "translation": translation, "text": body}

    try:
        async with httpx.AsyncClient(timeout=LOOKUP_TIMEOUT_S) as client:
            resp = await client.get(
                LOOKUP_URL.format(reference=ref.replace(" ", "+")),
                params={"translation": translation},
            )
    except httpx.HTTPError:
        raise ContentError("The Bible lookup service didn't answer — paste the text instead", 502)
    if resp.status_code == 404:
        raise ContentError("That reference wasn't found", 404)
    if resp.status_code != 200:
        raise ContentError("The Bible lookup service didn't answer — paste the text instead", 502)
    try:
        body = resp.json()
        verses = body["verses"]
        canonical = body["reference"]
    except (ValueError, KeyError):
        raise ContentError("The Bible lookup service returned something unexpected", 502)

    lines = [f"{v['verse']} {' '.join(str(v['text']).split())}" for v in verses]
    text = "\n".join(lines)
    try:
        await redis.set(cache_key, f"{canonical}\n{text}", ex=LOOKUP_CACHE_TTL_S)
    except Exception:
        pass
    return {"ref": canonical, "translation": translation, "text": text}


# ═══════════════════════════════════════════════════════════════════════════════
# CSV import
# ═══════════════════════════════════════════════════════════════════════════════
IMPORT_COLUMNS = (
    "date", "title", "passage_ref", "translation", "passage_text", "suggested_word",
    "still_breath_in", "still_breath_out", "reflection", "pray_question", "pray_text",
    "carry_verse_ref", "moment_sermon_id", "moment_start", "moment_end",
)
_REQUIRED = ("title", "passage_ref", "passage_text", "reflection", "pray_question", "pray_text")


def import_template() -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(IMPORT_COLUMNS)
    writer.writerow([
        "2026-11-16", "Prepare the way", "Isaiah 40:3-5", "kjv",
        "3 The voice of him that crieth in the wilderness, Prepare ye the way of the LORD",
        "way", "Prepare…", "…the way", "A short reflection.", "What needs clearing?",
        "Lord, make a way in me. Amen.", "", "", "", "",
    ])
    return buf.getvalue()


def _parse_clock(value: str) -> int:
    """`mm:ss`, `h:mm:ss` or plain seconds."""
    parts = value.strip().split(":")
    if not all(p.isdigit() for p in parts) or not 1 <= len(parts) <= 3:
        raise ValueError(value)
    seconds = 0
    for part in parts:
        seconds = seconds * 60 + int(part)
    return seconds


@dataclass
class _Row:
    index: int
    result: ImportRowResult
    values: dict = field(default_factory=dict)


def _parse_rows(raw: bytes, default_translation: str) -> list[_Row]:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ContentError("The file must be UTF-8 CSV", 400)
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise ContentError("The file is empty", 400)
    headers = {h.strip().lower() for h in reader.fieldnames if h}
    missing = [c for c in ("date", *_REQUIRED) if c not in headers]
    if missing:
        raise ContentError(f"Missing column(s): {', '.join(missing)}", 400)

    rows: list[_Row] = []
    for index, raw_row in enumerate(reader, start=1):
        if index > MAX_IMPORT_ROWS:
            raise ContentError(f"Import at most {MAX_IMPORT_ROWS} rows at a time", 400)
        row = {
            (k or "").strip().lower(): (v or "").strip()
            for k, v in raw_row.items() if k is not None
        }
        if not any(row.values()):
            continue
        messages: list[str] = []
        errors = False
        values: dict = {}

        day: date | None = None
        if row.get("date"):
            try:
                day = date.fromisoformat(row["date"])
            except ValueError:
                messages.append("Date must be YYYY-MM-DD (leave empty for the evergreen pool)")
                errors = True
        for name in _REQUIRED:
            if not row.get(name):
                messages.append(f"{name.replace('_', ' ').capitalize()} is empty")
                errors = True

        word = row.get("suggested_word") or None
        if word and " " in word:
            messages.append("Suggested word must be a single word")
            errors = True
        elif word and row.get("passage_text") and not _word_in_text(word, row["passage_text"]):
            messages.append(f"Suggested word “{word}” isn't in the passage")
            errors = True
        elif not word:
            messages.append("No suggested word")

        moment_id = row.get("moment_sermon_id") or None
        start = end = None
        if moment_id or row.get("moment_start") or row.get("moment_end"):
            try:
                moment_uuid = uuid.UUID(moment_id or "")
                start = _parse_clock(row.get("moment_start", ""))
                end = _parse_clock(row.get("moment_end", ""))
                if end <= start or end - start > 600:
                    raise ValueError
                values["moment_sermon_id"] = moment_uuid
            except ValueError:
                messages.append("Sermon moment needs a sermon id and a start/end under 10 minutes apart")
                errors = True

        limits = {"title": 200, "passage_ref": 100, "pray_question": 300,
                  "still_breath_in": 80, "still_breath_out": 80, "carry_verse_ref": 100}
        for name, limit in limits.items():
            if len(row.get(name, "")) > limit:
                messages.append(f"{name.replace('_', ' ').capitalize()} is longer than {limit} characters")
                errors = True

        values.update({
            "title": row.get("title"),
            "passage_ref": row.get("passage_ref"),
            "passage_translation": (row.get("translation") or default_translation).lower()[:20],
            "passage_text": row.get("passage_text"),
            "suggested_word": word,
            "still_breath_in": row.get("still_breath_in") or None,
            "still_breath_out": row.get("still_breath_out") or None,
            "reflection_md": row.get("reflection"),
            "pray_question": row.get("pray_question"),
            "pray_text": row.get("pray_text"),
            "carry_verse_ref": row.get("carry_verse_ref") or None,
            "moment_start_s": start,
            "moment_end_s": end,
        })
        status = "error" if errors else ("warning" if messages else "ready")
        rows.append(_Row(
            index=index,
            values={"date": day, **values},
            result=ImportRowResult(
                row=index, date=day, title=row.get("title") or None,
                passage_ref=row.get("passage_ref") or None, suggested_word=word,
                status=status, messages=messages,
            ),
        ))
    return rows


async def import_csv(
    db: AsyncSession,
    raw: bytes,
    actor: User,
    *,
    dry_run: bool,
    as_status: str = "draft",
    on_clash: str = "skip",
) -> ImportResult:
    if as_status not in ("draft", "approved"):
        raise ContentError("`as` must be draft or approved", 400)
    if on_clash not in ("skip", "replace_draft", "to_pool"):
        raise ContentError("`on_clash` must be skip, replace_draft or to_pool", 400)
    if as_status == "approved" and actor.role == UserRole.EDITOR:
        raise ContentError("Only managers and admins can import straight to approved", 403)

    church = await load_settings(db)
    rows = _parse_rows(raw, church.devotional_default_translation)

    # Sermon ids must exist.
    sermon_ids = {r.values["moment_sermon_id"] for r in rows if r.values.get("moment_sermon_id")}
    known = set()
    if sermon_ids:
        known = set((await db.execute(
            select(Sermon.id).where(Sermon.id.in_(sermon_ids))
        )).scalars().all())
    for r in rows:
        sid = r.values.get("moment_sermon_id")
        if sid and sid not in known:
            r.result.messages.append("That sermon id doesn't exist")
            r.result.status = "error"

    # Clashes: within the file, and with existing devotionals.
    dates = [r.values["date"] for r in rows if r.values["date"] is not None]
    existing = {}
    if dates:
        existing = {
            d.date: d for d in (await db.execute(
                select(Devotional).where(Devotional.date.in_(dates))
            )).scalars().all()
        }
    seen: dict[date, int] = {}
    for r in rows:
        day = r.values["date"]
        if day is None or r.result.status == "error":
            continue
        if day in seen:
            r.result.messages.append(f"Same date as row {seen[day]}")
            r.result.status = "error"
            continue
        seen[day] = r.index
        if day in existing:
            r.result.status = "clash"
            r.result.clash_with = existing[day].title

    result = ImportResult(
        dry_run=dry_run,
        rows=[r.result for r in rows],
        ready=sum(r.result.status == "ready" for r in rows),
        warnings=sum(r.result.status == "warning" for r in rows),
        errors=sum(r.result.status == "error" for r in rows),
        clashes=sum(r.result.status == "clash" for r in rows),
    )
    if dry_run:
        return result

    target = DevotionalStatus.APPROVED if as_status == "approved" else DevotionalStatus.DRAFT
    for r in rows:
        status = r.result.status
        if status == "error":
            continue
        values = dict(r.values)
        day = values.pop("date")
        if status == "clash":
            current = existing[day]
            if on_clash == "skip":
                result.skipped += 1
                continue
            if on_clash == "replace_draft":
                if current.status not in _EDITABLE_STATES:
                    result.skipped += 1
                    continue
                await db.delete(current)
                await db.flush()
                result.replaced += 1
            else:  # to_pool: the imported row goes to the evergreen pool
                day = None
                result.pooled += 1
        dev = Devotional(**values, status=target, created_by=actor.id)
        _apply_date(dev, day)
        db.add(dev)
        await db.flush()
        if target != DevotionalStatus.DRAFT:
            db.add(DevotionalApprovalLog(
                devotional_id=dev.id, from_status=None, to_status=target.value,
                actor_id=actor.id, note="Bulk import",
            ))
        result.created += 1
    await db.commit()
    log.info(
        "devotional_import", by=str(actor.id), created=result.created,
        replaced=result.replaced, pooled=result.pooled, skipped=result.skipped,
    )
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# Settings (columns on the church_settings singleton)
# ═══════════════════════════════════════════════════════════════════════════════
_SETTING_COLUMNS = {
    "reading_fallback": "devotional_reading_fallback",
    "allow_override": "devotional_allow_override",
    "tts_voice": "devotional_tts_voice",
    "tts_rate_pct": "devotional_tts_rate_pct",
    "publish_hour": "devotional_publish_hour",
    "gap_alert_days": "devotional_gap_alert_days",
    "still_seconds": "devotional_still_seconds",
    "default_translation": "devotional_default_translation",
}


def settings_to_dto(row: ChurchSettings) -> DevotionalSettings:
    return DevotionalSettings(
        **{name: getattr(row, col) for name, col in _SETTING_COLUMNS.items()},
        version=row.version,
    )


async def get_settings_dto(db: AsyncSession) -> DevotionalSettings:
    return settings_to_dto(await load_settings(db))


async def update_settings(
    db: AsyncSession, data: DevotionalSettingsUpdate, actor: User, ctx: AuditContext
) -> DevotionalSettings:
    row = await load_settings(db)
    stale = ContentError(
        "Someone else changed these settings. Reload to see the latest version, "
        "then reapply your edits.", status_code=409,
    )
    if row.version != data.version:
        raise stale

    provided = data.model_dump(exclude_unset=True, exclude={"version"})
    if "default_translation" in provided and provided["default_translation"]:
        provided["default_translation"] = provided["default_translation"].lower()
    before: dict = {}
    after: dict = {}
    for name, value in provided.items():
        if value is None and name != "tts_voice":
            continue
        col = _SETTING_COLUMNS[name]
        if getattr(row, col) != value:
            before[col] = getattr(row, col)
            after[col] = value
    if not after:
        return settings_to_dto(row)

    res = await db.execute(
        sa_update(ChurchSettings)
        .where(ChurchSettings.id == _SETTINGS_ID, ChurchSettings.version == data.version)
        .values(
            **after,
            version=ChurchSettings.version + 1,
            updated_at=func.now(),
            updated_by_id=actor.id,
        )
        .execution_options(synchronize_session=False)
    )
    if res.rowcount == 0:
        await db.rollback()
        raise stale
    await audit_service.record(
        db, AuditAction.SETTINGS_UPDATED,
        actor=actor,
        target=AuditTarget(type="church_settings", id=None, label="Devotional settings"),
        details={"changed": sorted(after), "before": before, "after": after},
        outcome=AuditOutcome.SUCCESS, ctx=ctx,
    )
    await db.commit()
    # The public settings payload carries `version` in its ETag.
    from app.services import settings_service

    await settings_service.invalidate_public_cache()
    await db.refresh(row)
    return settings_to_dto(row)
