"""Notes service: a member's private, timestamped notes on a sermon.

Design notes
------------
* **Strictly user-owned, no exceptions.** Every lookup in this module is
  ownership-only — `note.user_id == requester.id` — not `require_role`.
  Unlike every content-read function in `content_service.py` (which grants
  editors/managers a bypass by design, e.g. `staff_scope_hides`), this module
  has none: a manager or admin calling these functions on someone else's note
  gets exactly the same "not found" a stranger would. A note is a person's
  own study; the review queue and any staff surface have no business reading
  it. If a staff read path for notes is ever wanted, that is a product
  decision for a human to make explicitly, not a default to fall into here.
* **No existence leak.** `create_note` and `list_notes_for_sermon` (the two
  entry points keyed on a `sermon_id` path param) 404 the same way for a
  sermon that doesn't exist, isn't published, or hasn't reached its
  `publish_at` yet — a caller cannot distinguish "no such sermon" from
  "sermon exists but isn't visible to you" from the response. `update_note`
  and `delete_note` (keyed on `note_id`) don't re-check sermon visibility —
  ownership of the note is the only gate, so a member can still edit or
  delete their own note if staff later unpublish the sermon it references.
  That note already belongs to them and reveals nothing to anyone else.
* `position_seconds` is clamped to the sermon's known `duration_seconds`
  (when set) rather than rejected outright — the same precedent
  `analytics_service.record_progress` already established for the identical
  field on the same entity, so there is one house convention for "how far
  into a sermon can a timestamp be", not two. Non-negativity is enforced at
  the schema edge (`NoteCreate`/`NoteUpdate`, `Field(ge=0)`).
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.content_schemas import NoteCreate, NoteUpdate
from app.models.models import Sermon, SermonNote, User, VIEWER_VISIBLE_STATUSES
from app.services.content_service import ContentError, sermon_publish_time_passed

log = get_logger("notes")


def _sermon_visible(sermon: Sermon | None) -> bool:
    """The same visibility rule the public catalog detail read applies to
    viewers — published status + `publish_at` passed. Deliberately no
    staff/role branching: this module makes no staff exception on any axis,
    sermon visibility included.
    """
    return (
        sermon is not None
        and sermon.status in VIEWER_VISIBLE_STATUSES
        and sermon_publish_time_passed(sermon)
    )


async def _visible_sermon_or_404(db: AsyncSession, sermon_id: uuid.UUID) -> Sermon:
    sermon = await db.get(Sermon, sermon_id)
    if not _sermon_visible(sermon):
        raise ContentError("Sermon not found", status_code=404)
    return sermon


def _clamp_position(position_seconds: int, sermon: Sermon) -> int:
    if sermon.duration_seconds:
        return min(position_seconds, sermon.duration_seconds)
    return position_seconds


async def _get_owned_note(
    db: AsyncSession, user: User, note_id: uuid.UUID
) -> SermonNote:
    """Ownership-only lookup — the one thing this module exists to get right.
    A note belonging to someone else returns exactly the same 404 a
    nonexistent note id would, for every caller regardless of role.
    """
    note = await db.get(SermonNote, note_id)
    if note is None or note.user_id != user.id:
        raise ContentError("Note not found", status_code=404)
    return note


async def create_note(
    db: AsyncSession, user: User, sermon_id: uuid.UUID, data: NoteCreate
) -> SermonNote:
    sermon = await _visible_sermon_or_404(db, sermon_id)
    note = SermonNote(
        user_id=user.id,
        sermon_id=sermon_id,
        position_seconds=_clamp_position(data.position_seconds, sermon),
        body=data.body,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)
    log.info(
        "note_created", note_id=str(note.id), sermon_id=str(sermon_id),
        user_id=str(user.id),
    )
    return note


async def list_notes_for_sermon(
    db: AsyncSession, user: User, sermon_id: uuid.UUID
) -> list[SermonNote]:
    """The caller's own notes on one sermon, in timeline order (earliest
    position first). Requires the sermon still be visible — see module
    docstring for why this endpoint 404s the same way a missing note would.
    """
    await _visible_sermon_or_404(db, sermon_id)
    rows = (await db.execute(
        select(SermonNote)
        .where(SermonNote.user_id == user.id, SermonNote.sermon_id == sermon_id)
        .order_by(SermonNote.position_seconds)
    )).scalars().all()
    return list(rows)


async def list_my_notes(db: AsyncSession, user: User) -> list[SermonNote]:
    """Every note the caller has ever taken, across all sermons, most recent
    first. Not filtered by current sermon visibility — this is the member's
    own library of their own writing, keyed only on ownership, and reveals
    nothing to anyone but them regardless of a sermon's later status.
    """
    rows = (await db.execute(
        select(SermonNote)
        .where(SermonNote.user_id == user.id)
        .order_by(SermonNote.created_at.desc())
    )).scalars().all()
    return list(rows)


async def update_note(
    db: AsyncSession, user: User, note_id: uuid.UUID, data: NoteUpdate
) -> SermonNote:
    note = await _get_owned_note(db, user, note_id)
    fields = data.model_dump(exclude_unset=True)
    if "position_seconds" in fields:
        sermon = await db.get(Sermon, note.sermon_id)
        if sermon is not None:
            fields["position_seconds"] = _clamp_position(
                fields["position_seconds"], sermon
            )
    for key, value in fields.items():
        setattr(note, key, value)
    await db.commit()
    await db.refresh(note)
    log.info("note_updated", note_id=str(note.id), user_id=str(user.id))
    return note


async def delete_note(db: AsyncSession, user: User, note_id: uuid.UUID) -> None:
    note = await _get_owned_note(db, user, note_id)
    await db.delete(note)
    await db.commit()
    log.info("note_deleted", note_id=str(note_id), user_id=str(user.id))
