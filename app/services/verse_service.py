"""Verse service: Home's "verse of the day" (mobile `VerseStrip`) + plain admin CRUD.

No editorial workflow — unlike `Announcement`, a `Verse` has no draft/review/publish
state machine. Rows are either active or not; `get_verse_of_the_day` picks among the
active ones. Verse *text* is sourced from bible-api.com (KJV, public domain) by the
operational script `app.scripts.seed_verses`, not typed by hand into this codebase.
"""
from __future__ import annotations

import random
import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_schemas import VerseCreate, VerseUpdate
from app.models.models import Verse


class VerseError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code


async def get_verse_of_the_day(db: AsyncSession) -> Verse:
    """One active verse, deterministically picked by the current day (stable all day,
    changes at local-midnight-ish granularity — same seeding technique as Home's
    other daily-varying shelves, `content_service._daily_shuffle`, but shared across
    every viewer rather than salted per-user: a verse of the day is meant to be the
    same for everyone, not personalized)."""
    rows = (await db.execute(select(Verse).where(Verse.is_active.is_(True)))).scalars().all()
    if not rows:
        raise VerseError("No verses available", status_code=404)
    ordered = sorted(rows, key=lambda v: v.id)
    return random.Random(date.today().isoformat()).choice(ordered)


async def list_all(db: AsyncSession) -> list[Verse]:
    rows = (await db.execute(select(Verse).order_by(Verse.created_at.desc()))).scalars().all()
    return list(rows)


async def get_any(db: AsyncSession, verse_id: uuid.UUID) -> Verse:
    verse = await db.get(Verse, verse_id)
    if verse is None:
        raise VerseError("Verse not found", status_code=404)
    return verse


async def create(db: AsyncSession, data: VerseCreate, creator_id: uuid.UUID | None) -> Verse:
    verse = Verse(
        reference=data.reference,
        text=data.text,
        translation=data.translation,
        is_active=data.is_active,
        created_by=creator_id,
    )
    db.add(verse)
    await db.commit()
    await db.refresh(verse)
    return verse


async def update(db: AsyncSession, verse_id: uuid.UUID, data: VerseUpdate) -> Verse:
    verse = await get_any(db, verse_id)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(verse, key, value)
    await db.commit()
    await db.refresh(verse)
    return verse


async def delete(db: AsyncSession, verse_id: uuid.UUID) -> None:
    verse = await get_any(db, verse_id)
    await db.delete(verse)
    await db.commit()
