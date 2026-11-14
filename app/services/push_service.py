"""Push notifications: device registration and "new sermon" announcements.

The daily devotional reminder is scheduled on the phone itself (it follows the
listener's own time zone and needs no server), so this module only handles
pushes the server has to originate.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.push import PushMessage, PushSender, get_push_sender
from app.models.models import PushDevice, Sermon, Speaker
from app.services.content_service import sermon_visibility_clause

log = get_logger("push_service")

# Fixed key for pg_try_advisory_xact_lock so several API instances (or the API
# plus the cron script) never announce the same sermon twice.
PUSH_ADVISORY_LOCK_KEY = 7_316_221_904

# A burst of uploads should not become a burst of buzzing phones: announce at
# most this many sermons per pass; the rest go on the next pass.
MAX_SERMONS_PER_PASS = 3

PLATFORMS = ("ios", "android")


async def register_device(
    db: AsyncSession,
    user_id: uuid.UUID,
    token: str,
    platform: str,
    new_sermons: bool,
) -> PushDevice:
    """Create or update the row for this install's token. A token already held
    by another account moves to this one (shared phone, new sign-in)."""
    device = (await db.execute(select(PushDevice).where(PushDevice.token == token))).scalar_one_or_none()
    if device is None:
        device = PushDevice(user_id=user_id, token=token, platform=platform, new_sermons=new_sermons)
        db.add(device)
    else:
        device.user_id = user_id
        device.platform = platform
        device.new_sermons = new_sermons
        device.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(device)
    return device


async def unregister_device(db: AsyncSession, user_id: uuid.UUID, token: str) -> None:
    """Forget this install's token, only if it belongs to the caller."""
    await db.execute(
        delete(PushDevice).where(PushDevice.token == token, PushDevice.user_id == user_id)
    )
    await db.commit()


@dataclass
class PushPassResult:
    sermons: int = 0
    sent: int = 0
    removed_tokens: int = 0


def _message_for(sermon: Sermon, speaker_name: str | None) -> tuple[str, str]:
    title = "New sermon"
    body = f"{sermon.title} · {speaker_name}" if speaker_name else sermon.title
    return title, body


async def announce_new_sermons(
    db: AsyncSession, sender: PushSender | None = None
) -> PushPassResult | None:
    """Push every newly visible sermon to opted-in devices, once each.

    Returns None if another instance holds the lock. A sermon is stamped
    before the send, so a crash mid-send skips it rather than repeating it on
    the next pass (a missed push is better than a duplicate).
    """
    sender = sender or get_push_sender()
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        got = (await db.execute(select(func.pg_try_advisory_xact_lock(PUSH_ADVISORY_LOCK_KEY)))).scalar()
        if not got:
            return None

    rows = (await db.execute(
        select(Sermon, Speaker.name)
        .outerjoin(Speaker, Speaker.id == Sermon.speaker_id)
        .where(*sermon_visibility_clause(), Sermon.push_notified_at.is_(None))
        .order_by(Sermon.published_at.asc().nullsfirst(), Sermon.id)
        .limit(MAX_SERMONS_PER_PASS)
    )).all()
    result = PushPassResult()
    if not rows:
        await db.commit()
        return result

    now = datetime.now(timezone.utc)
    for sermon, _ in rows:
        sermon.push_notified_at = now
    await db.commit()

    tokens = (await db.execute(
        select(PushDevice.token).where(PushDevice.new_sermons.is_(True))
    )).scalars().all()

    messages: list[PushMessage] = []
    for sermon, speaker_name in rows:
        title, body = _message_for(sermon, speaker_name)
        data = {"url": f"/sermon/{sermon.id}", "kind": "new_sermon", "sermon_id": str(sermon.id)}
        messages.extend(PushMessage(token=t, title=title, body=body, data=data) for t in tokens)

    sent = await sender.send(messages)
    if sent.dead_tokens:
        await db.execute(delete(PushDevice).where(PushDevice.token.in_(set(sent.dead_tokens))))
        await db.commit()

    result.sermons = len(rows)
    result.sent = sent.sent
    result.removed_tokens = len(set(sent.dead_tokens))
    log.info(
        "push_new_sermons",
        sermons=result.sermons,
        devices=len(tokens),
        sent=result.sent,
        removed=result.removed_tokens,
    )
    return result
