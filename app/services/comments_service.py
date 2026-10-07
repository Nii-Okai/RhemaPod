"""Sermon comments: viewer-side service (plan §A.2, §A.4, §A.5, §A.7).

Rules enforced here, in the order a request meets them:

* **Visibility.** The sermon must be viewer-visible (published, `publish_at`
  passed) or the call 404s uniformly (lifted from the removed Notes service),
  and a PAID sermon needs the same entitlement playback needs (staff exempt,
  as in playback). Notes had no entitlement check; this is built fresh on
  `subscription_service.is_entitled`.
* **Rate limits** are per user, fixed window, fail-open (see
  `app/core/rate_limit.py`), charged at the top of every post / report / block
  attempt: a rejected attempt still costs budget (pin A6), so the URL and
  blocklist filters cannot be probed for free.
* **Comment bodies are never logged**, at any level, including error paths.
  Log events here carry ids and counts only. Database failures are caught at
  the write boundary and re-raised as a typed 500 *without* the SQLAlchemy
  exception, whose `str()` embeds the bound parameters (the body).
* **Auto-hide** reads the threshold from settings at call time and counts only
  reports filed after the comment's most recent moderator `restore` or
  `dismiss_reports` (re-arm rule, §A.5.3). The comment row is locked (`FOR UPDATE`) for every report, so
  concurrent reporters serialise: `report_count` is exact and exactly one
  `auto_hide` log row is written. Report and log timestamps use
  `clock_timestamp()` (not the transaction-start `now()`), so ordering against
  a restore follows the lock order.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal

from redis.exceptions import RedisError
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import rate_limit
from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.rate_limit import check_rate_limit
from app.core.text_safety import (
    contains_blocked_term,
    contains_contact,
    contains_url,
    has_visible_text,
    normalise_text,
    raw_length_exceeded,
    starts_with_reserved_title,
)
from app.models.content_schemas import (
    COMMENT_BODY_MAX,
    BlockCreated,
    BlockPublic,
    CommentAdmin,
    CommentAdminForEditor,
    CommentCreate,
    CommentPublic,
    CommentReportCreate,
    Page,
)
from app.models.models import (
    VIEWER_VISIBLE_STATUSES,
    CommentModerationLog,
    CommentStatus,
    ContentTier,
    ModerationAction,
    Series,
    Sermon,
    SermonComment,
    SermonCommentReport,
    User,
    UserBlock,
    UserRole,
)
from app.services import subscription_service
from app.services.content_service import (
    ContentError,
    editor_scope_filter,
    effective_tier,
    public_display_name,
    sermon_publish_time_passed,
)

log = get_logger("comments")

FULL_NAME_MAX = 100
NAME_REJECTED_MESSAGE = "This name can't be used"

# (window label, limit, window seconds). Module constants so tests can
# pre-seed `rate_limit_key(...)` counters in real Redis instead of waiting.
POST_LIMITS = (("1m", 5, 60), ("1h", 30, 3600))
REPORT_LIMITS = (("1h", 15, 3600),)
BLOCK_LIMITS = (("1h", 30, 3600),)
PROFILE_LIMITS = (("1h", 5, 3600),)

_STAFF_ROLES = (UserRole.EDITOR, UserRole.MANAGER, UserRole.ADMIN)


def rate_limit_key(action: str, window: str, user_id: uuid.UUID | str) -> str:
    """The key handed to `check_rate_limit` (Redis stores it as
    `ratelimit:<key>`). Per user, never per IP."""
    return f"comments:{action}:{window}:{user_id}"


# ── Sermon gate ──────────────────────────────────────────────────────────────
def _sermon_visible(sermon: Sermon | None) -> bool:
    return (
        sermon is not None
        and sermon.status in VIEWER_VISIBLE_STATUSES
        and sermon_publish_time_passed(sermon)
    )


async def visible_sermon_or_404(db: AsyncSession, sermon_id: uuid.UUID) -> Sermon:
    sermon = await db.get(Sermon, sermon_id)
    if not _sermon_visible(sermon):
        raise ContentError("Sermon not found", status_code=404)
    return sermon


async def _gate_sermon(db: AsyncSession, sermon_id: uuid.UUID, actor: User) -> Sermon:
    """Visible sermon + the playback entitlement rule for PAID content: same
    403 `upgrade_required`, staff exempt."""
    sermon = await visible_sermon_or_404(db, sermon_id)
    if actor.role not in _STAFF_ROLES:
        series = await db.get(Series, sermon.series_id) if sermon.series_id else None
        if effective_tier(
            sermon, series
        ) == ContentTier.PAID and not await subscription_service.is_entitled(db, actor):
            raise ContentError("upgrade_required", status_code=403)
    return sermon


# ── Rate limiting ────────────────────────────────────────────────────────────
async def _retry_after(key: str, window_seconds: int) -> int:
    try:
        ttl = await rate_limit.get_redis().ttl(f"ratelimit:{key}")
    except (
        RedisError,
        OSError,
    ) as exc:  # fail open: a Redis hiccup must not turn a 429 into a 500
        log.debug("comment_retry_after_unavailable", error=type(exc).__name__)
        return window_seconds
    return ttl if isinstance(ttl, int) and ttl > 0 else window_seconds


async def _charge(user_id: uuid.UUID, action: str, limits) -> None:
    for window, limit, seconds in limits:
        key = rate_limit_key(action, window, user_id)
        if not await check_rate_limit(key, limit, seconds):
            retry = await _retry_after(key, seconds)
            log.info(
                "comment_rate_limited",
                action=action,
                window=window,
                user_id=str(user_id),
            )
            raise ContentError(
                "Too many requests. Please try again shortly.",
                status_code=429,
                headers={"Retry-After": str(retry)},
            )


# ── Write boundary ───────────────────────────────────────────────────────────
@asynccontextmanager
async def _write_guard(db: AsyncSession, event: str) -> AsyncIterator[None]:
    """Turn a database failure into a typed 500 that carries no SQLAlchemy
    exception (its message embeds statement parameters, i.e. comment text)."""
    try:
        yield
    except SQLAlchemyError as exc:
        # Event, exception class and SQLSTATE only: str(exc) embeds statement
        # parameters, i.e. comment text.
        sqlstate = getattr(getattr(exc, "orig", None), "sqlstate", None)
        log.error(event, error=type(exc).__name__, sqlstate=sqlstate)
        try:
            await db.rollback()
        except SQLAlchemyError as rollback_exc:  # must not mask the typed 500 below
            log.error(event + "_rollback_failed", error=type(rollback_exc).__name__)
        raise ContentError(
            "Could not complete that right now. Please retry.", status_code=500
        ) from None


# ── Text rules ───────────────────────────────────────────────────────────────
def validate_comment_body(raw: str) -> str:
    """Normalise then enforce 1-1000 chars, no URL, no blocklisted term."""
    if raw_length_exceeded(raw, COMMENT_BODY_MAX):
        raise ContentError(
            f"Comment must be between 1 and {COMMENT_BODY_MAX} characters",
            status_code=422,
        )
    body = normalise_text(raw)
    if not body or not has_visible_text(body) or len(body) > COMMENT_BODY_MAX:
        raise ContentError(
            f"Comment must be between 1 and {COMMENT_BODY_MAX} characters",
            status_code=422,
        )
    if contains_url(body):
        raise ContentError("Links are not allowed in comments", status_code=422)
    if contains_contact(body):
        raise ContentError(
            "Contact details are not allowed in comments", status_code=422
        )
    if contains_blocked_term(body):
        raise ContentError("This comment can't be posted", status_code=422)
    return body


def validate_full_name(raw: str) -> str:
    """Same normalisation, URL, contact and blocklist rules as a comment body,
    plus the reserved-title rule, 1-100 chars, single line (the name is shown to
    every viewer as "First L."). Every content rule fails with the same message
    so the response never says which rule fired or what matched (C-3)."""
    if raw_length_exceeded(raw, FULL_NAME_MAX):
        raise ContentError(
            f"Name must be between 1 and {FULL_NAME_MAX} characters", status_code=422
        )
    name = normalise_text(raw, multiline=False)
    if not name or not has_visible_text(name) or len(name) > FULL_NAME_MAX:
        raise ContentError(
            f"Name must be between 1 and {FULL_NAME_MAX} characters", status_code=422
        )
    if (
        contains_url(name)
        or contains_contact(name)
        or contains_blocked_term(name)
        or starts_with_reserved_title(name)
    ):
        raise ContentError(NAME_REJECTED_MESSAGE, status_code=422)
    return name


# ── DTO mapping ──────────────────────────────────────────────────────────────
def _to_public(
    comment: SermonComment, full_name: str | None, viewer_id: uuid.UUID
) -> CommentPublic:
    mine = comment.user_id == viewer_id
    label = None
    if mine and comment.status == CommentStatus.HIDDEN:
        label = "under_review" if comment.hidden_auto else "removed_by_moderator"
    return CommentPublic(
        id=comment.id,
        sermon_id=comment.sermon_id,
        # Defensive only: posting requires a name, so this is never empty in
        # practice. Deliberately no "Member"-style fallback (D6).
        author_display_name=public_display_name(full_name) or "",
        body=comment.body,
        created_at=comment.created_at,
        is_mine=mine,
        status=comment.status,
        hidden_label=label,
    )


# ── Viewer list ──────────────────────────────────────────────────────────────
async def list_comments(
    db: AsyncSession, actor: User, sermon_id: uuid.UUID, limit: int, offset: int
) -> Page[CommentPublic]:
    """Recent first. Excludes other people's HIDDEN rows and authors the
    viewer blocked; `total` uses the identical filter. Primary DB."""
    await _gate_sermon(db, sermon_id, actor)
    blocked = select(UserBlock.blocked_id).where(UserBlock.blocker_id == actor.id)
    visible = and_(
        SermonComment.sermon_id == sermon_id,
        or_(
            SermonComment.status == CommentStatus.VISIBLE,
            SermonComment.user_id == actor.id,
        ),
        SermonComment.user_id.not_in(blocked),
    )
    total = (
        await db.execute(select(func.count()).select_from(SermonComment).where(visible))
    ).scalar_one()
    rows = (
        await db.execute(
            select(SermonComment, User.full_name)
            .join(User, User.id == SermonComment.user_id)
            .where(visible)
            .order_by(SermonComment.created_at.desc(), SermonComment.id)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return Page[CommentPublic](
        items=[_to_public(c, name, actor.id) for c, name in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


# ── Post ─────────────────────────────────────────────────────────────────────
async def post_comment(
    db: AsyncSession, actor: User, sermon_id: uuid.UUID, data: CommentCreate
) -> CommentPublic:
    await _charge(actor.id, "post", POST_LIMITS)
    await _gate_sermon(db, sermon_id, actor)
    if not public_display_name(actor.full_name):
        raise ContentError("Add your name before commenting", status_code=403)
    if actor.comments_terms_accepted_at is None:
        raise ContentError(
            "Accept the comment terms before commenting", status_code=403
        )
    body = validate_comment_body(data.body)

    comment = SermonComment(sermon_id=sermon_id, user_id=actor.id, body=body)
    async with _write_guard(db, "comment_write_failed"):
        db.add(comment)
        await db.commit()
        await db.refresh(comment)
    log.info(
        "comment_posted",
        comment_id=str(comment.id),
        sermon_id=str(sermon_id),
        user_id=str(actor.id),
        length=len(body),
    )
    return _to_public(comment, actor.full_name, actor.id)


# ── Self-delete ──────────────────────────────────────────────────────────────
async def delete_own_comment(
    db: AsyncSession, actor: User, comment_id: uuid.UUID
) -> None:
    """Hard delete by the author, with a `self_delete` log row and NO body
    snapshot. Ownership only: the sermon's visibility is not rechecked (an
    author may remove their own words after the sermon is unpublished). Not
    allowed while HIDDEN (409). Non-owner and unknown ids 404 identically."""
    async with _write_guard(db, "comment_write_failed"):
        comment = (
            await db.execute(
                select(SermonComment)
                .where(
                    SermonComment.id == comment_id, SermonComment.user_id == actor.id
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if comment is None:
            await db.rollback()
            raise ContentError("Comment not found", status_code=404)
        if comment.status == CommentStatus.HIDDEN:
            await db.rollback()
            raise ContentError(
                "This comment can't be deleted right now", status_code=409
            )
        db.add(
            CommentModerationLog(
                comment_id=comment.id,
                actor_id=actor.id,
                action=ModerationAction.SELF_DELETE,
                reason=None,
                sermon_id=comment.sermon_id,
                author_id=comment.user_id,
                body_snapshot=None,
                created_at=func.clock_timestamp(),
            )
        )
        sermon_id = comment.sermon_id
        await db.delete(comment)
        await db.commit()
    log.info(
        "comment_self_deleted",
        comment_id=str(comment_id),
        sermon_id=str(sermon_id),
        user_id=str(actor.id),
    )


# ── Report ───────────────────────────────────────────────────────────────────
async def _load_actionable_comment(
    db: AsyncSession, actor: User, comment_id: uuid.UUID
) -> SermonComment | None:
    """Shared by report and block. Returns None for the caller's own comment
    (both actions are ignored on it). 404 for unknown ids, other people's
    HIDDEN rows, sermons the caller cannot see, and PAID sermons the caller is
    not entitled to (uniform "Comment not found", SF-6)."""
    comment = await db.get(SermonComment, comment_id)
    if comment is None:
        raise ContentError("Comment not found", status_code=404)
    if comment.user_id == actor.id:
        return None
    if comment.status == CommentStatus.HIDDEN:
        raise ContentError("Comment not found", status_code=404)
    try:
        await _gate_sermon(db, comment.sermon_id, actor)
    except ContentError:
        # SF-6: an unentitled caller must not learn that a comment id exists on
        # a PAID sermon, so every gate failure is the unknown-id response.
        # (List and post on the sermon itself keep 403 upgrade_required: the
        # sermon's existence is public.)
        raise ContentError("Comment not found", status_code=404) from None
    return comment


async def report_comment(
    db: AsyncSession, actor: User, comment_id: uuid.UUID, data: CommentReportCreate
) -> None:
    """Record one report per (comment, reporter) and apply the auto-hide rule.

    Self-report is ignored; a duplicate is idempotent (the first reason is
    kept). Everything below the lock is one transaction."""
    await _charge(actor.id, "report", REPORT_LIMITS)
    comment = await _load_actionable_comment(db, actor, comment_id)
    if comment is None:
        return

    async with _write_guard(db, "comment_write_failed"):
        locked = (
            await db.execute(
                select(SermonComment)
                .where(SermonComment.id == comment_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if locked is None:  # deleted while we were reading
            await db.rollback()
            raise ContentError("Comment not found", status_code=404)

        inserted = (
            await db.execute(
                pg_insert(SermonCommentReport)
                .values(
                    comment_id=comment_id,
                    reporter_id=actor.id,
                    reason=data.reason,
                    detail=data.detail,
                    created_at=func.clock_timestamp(),
                )
                .on_conflict_do_nothing(constraint="uq_comment_report_reporter")
                .returning(SermonCommentReport.id)
            )
        ).scalar_one_or_none()
        if inserted is None:  # duplicate: idempotent, nothing changes
            await db.rollback()
            return

        locked.report_count = locked.report_count + 1
        auto_hidden = False
        if locked.status == CommentStatus.VISIBLE:
            restored_at = (
                await db.execute(
                    select(func.max(CommentModerationLog.created_at)).where(
                        CommentModerationLog.comment_id == comment_id,
                        CommentModerationLog.action.in_(
                            (ModerationAction.RESTORE, ModerationAction.DISMISS_REPORTS)
                        ),
                    )
                )
            ).scalar_one()
            counted = (
                select(func.count())
                .select_from(SermonCommentReport)
                .where(SermonCommentReport.comment_id == comment_id)
            )
            if restored_at is not None:
                counted = counted.where(SermonCommentReport.created_at > restored_at)
            distinct_reporters = (await db.execute(counted)).scalar_one()
            if distinct_reporters >= get_settings().comments_auto_hide_threshold:
                locked.status = CommentStatus.HIDDEN
                locked.hidden_auto = True
                locked.hidden_at = func.clock_timestamp()
                locked.hidden_by_id = None
                locked.hidden_reason = None
                db.add(
                    CommentModerationLog(
                        comment_id=comment_id,
                        actor_id=None,
                        action=ModerationAction.AUTO_HIDE,
                        reason=None,
                        sermon_id=locked.sermon_id,
                        author_id=locked.user_id,
                        body_snapshot=None,
                        created_at=func.clock_timestamp(),
                    )
                )
                auto_hidden = True
        await db.commit()
    log.info(
        "comment_reported",
        comment_id=str(comment_id),
        reporter_id=str(actor.id),
        reason=data.reason.value,
        auto_hidden=auto_hidden,
    )


# ── Block ────────────────────────────────────────────────────────────────────
async def block_author(
    db: AsyncSession, actor: User, comment_id: uuid.UUID
) -> BlockCreated:
    """Block the comment's author for this viewer, by comment id (no endpoint
    maps a user id or email to a block). Idempotent; own comment ignored."""
    await _charge(actor.id, "block", BLOCK_LIMITS)
    comment = await _load_actionable_comment(db, actor, comment_id)
    if comment is None:
        return BlockCreated(id=None)
    author_id = comment.user_id

    async with _write_guard(db, "block_write_failed"):
        await db.execute(
            pg_insert(UserBlock)
            .values(blocker_id=actor.id, blocked_id=author_id)
            .on_conflict_do_nothing(constraint="uq_user_blocks_pair")
        )
        await db.commit()
        block_id = (
            await db.execute(
                select(UserBlock.id).where(
                    UserBlock.blocker_id == actor.id, UserBlock.blocked_id == author_id
                )
            )
        ).scalar_one_or_none()
    log.info(
        "comment_author_blocked", blocker_id=str(actor.id), comment_id=str(comment_id)
    )
    return BlockCreated(id=block_id)


async def list_blocks(db: AsyncSession, actor: User) -> list[BlockPublic]:
    rows = (
        await db.execute(
            select(UserBlock, User.full_name)
            .join(User, User.id == UserBlock.blocked_id)
            .where(UserBlock.blocker_id == actor.id)
            .order_by(UserBlock.created_at.desc(), UserBlock.id)
        )
    ).all()
    return [
        BlockPublic(
            id=b.id,
            display_name=public_display_name(name) or "",
            created_at=b.created_at,
        )
        for b, name in rows
    ]


async def unblock(db: AsyncSession, actor: User, block_id: uuid.UUID) -> None:
    """Remove one of the caller's own blocks. Anyone else's block id, an
    unknown id and a repeat all 404 identically."""
    async with _write_guard(db, "block_write_failed"):
        removed = (
            await db.execute(
                delete(UserBlock)
                .where(UserBlock.id == block_id, UserBlock.blocker_id == actor.id)
                .returning(UserBlock.id)
            )
        ).scalar_one_or_none()
        await db.commit()
    if removed is None:
        raise ContentError("Block not found", status_code=404)
    log.info("comment_author_unblocked", blocker_id=str(actor.id))


# ── Terms and profile name ───────────────────────────────────────────────────
async def accept_terms(db: AsyncSession, actor: User) -> None:
    """Idempotent: sets the timestamp only while it is NULL, atomically."""
    async with _write_guard(db, "terms_write_failed"):
        await db.execute(
            update(User)
            .where(User.id == actor.id, User.comments_terms_accepted_at.is_(None))
            .values(comments_terms_accepted_at=func.now())
        )
        await db.commit()
    log.info("comment_terms_accepted", user_id=str(actor.id))


async def update_full_name(db: AsyncSession, actor: User, raw_name: str) -> User:
    # Charged before validation, like every comment action (A6): a rejected name
    # still costs an attempt, so the limit also bounds rule probing.
    await _charge(actor.id, "profile", PROFILE_LIMITS)
    name = validate_full_name(raw_name)
    async with _write_guard(db, "profile_write_failed"):
        actor.full_name = name
        await db.commit()
        await db.refresh(actor)
    log.info("profile_name_updated", user_id=str(actor.id))
    return actor


# ── Moderation (admin side, plan §A.4 / §A.5 / §A.6) ─────────────────────────
AdminSort = Literal["recent", "most_reported"]


def _to_admin(
    comment: SermonComment, author: User, sermon_title: str, actor: User
) -> CommentAdmin | CommentAdminForEditor:
    """EDITOR gets the schema without the author's email and id; MANAGER and
    ADMIN get the full one. The branch is on the schema, not on a null field."""
    fields = _to_public(comment, author.full_name, actor.id).model_dump()
    fields.update(
        status=comment.status,
        hidden_at=comment.hidden_at,
        hidden_reason=comment.hidden_reason,
        hidden_auto=comment.hidden_auto,
        report_count=comment.report_count,
        sermon_title=sermon_title,
    )
    if actor.role == UserRole.EDITOR:
        return CommentAdminForEditor(**fields)
    return CommentAdmin(
        **fields,
        hidden_by_id=comment.hidden_by_id,
        author_id=author.id,
        author_email=author.email,
    )


def _needs_review():
    """Nav badge rule (pin A7): auto-hidden, or visible and reported. Clears on
    restore (count reset) or a manual hide."""
    # `report_count > 0` is stated outside the OR so the planner can prove the
    # partial index ix_sermon_comments_reported (WHERE report_count > 0) applies.
    # It is redundant for the hidden_auto branch only because of the invariant
    # hidden_auto => report_count > 0: auto-hide runs after a report increments
    # the count, and restore / manual hide clear hidden_auto.
    return and_(
        SermonComment.report_count > 0,
        or_(
            SermonComment.hidden_auto.is_(True),
            SermonComment.status == CommentStatus.VISIBLE,
        ),
    )


async def list_admin_comments(
    db: AsyncSession,
    actor: User,
    *,
    sermon_id: uuid.UUID | None,
    status: CommentStatus | None,
    reported_only: bool,
    needs_review: bool,
    sort: AdminSort,
    limit: int,
    offset: int,
) -> Page[CommentAdmin] | Page[CommentAdminForEditor]:
    """The moderation queue. An EDITOR is confined to comments on their own
    sermons by the ADR-0004 predicate, ANDed with every filter: a foreign or
    unknown `sermon_id` returns an empty page, indistinguishable from each
    other. Auto-hidden rows always sort first (P5)."""
    conditions = []
    scope = editor_scope_filter(actor)
    if scope is not None:
        conditions.append(scope)
    if sermon_id is not None:
        conditions.append(SermonComment.sermon_id == sermon_id)
    if status is not None:
        conditions.append(SermonComment.status == status)
    if reported_only:
        conditions.append(SermonComment.report_count > 0)
    if needs_review:
        conditions.append(_needs_review())

    base = (
        select(SermonComment, User, Sermon.title)
        .join(Sermon, Sermon.id == SermonComment.sermon_id)
        .join(User, User.id == SermonComment.user_id)
        .where(*conditions)
    )
    total = (
        await db.execute(
            select(func.count())
            .select_from(SermonComment)
            .join(Sermon, Sermon.id == SermonComment.sermon_id)
            .where(*conditions)
        )
    ).scalar_one()

    order = [SermonComment.hidden_auto.desc()]
    if sort == "most_reported":
        order.append(SermonComment.report_count.desc())
    order += [SermonComment.created_at.desc(), SermonComment.id]
    rows = (await db.execute(base.order_by(*order).limit(limit).offset(offset))).all()
    items = [_to_admin(c, author, title, actor) for c, author, title in rows]
    page = (
        Page[CommentAdminForEditor]
        if actor.role == UserRole.EDITOR
        else Page[CommentAdmin]
    )
    return page(items=items, total=total, limit=limit, offset=offset)


async def _admin_row(
    db: AsyncSession, actor: User, comment_id: uuid.UUID
) -> CommentAdmin | CommentAdminForEditor:
    c, author, title = (
        await db.execute(
            select(SermonComment, User, Sermon.title)
            .join(Sermon, Sermon.id == SermonComment.sermon_id)
            .join(User, User.id == SermonComment.user_id)
            .where(SermonComment.id == comment_id)
            .execution_options(populate_existing=True)
        )
    ).one()
    return _to_admin(c, author, title, actor)


async def _lock_for_moderation(
    db: AsyncSession, comment_id: uuid.UUID
) -> SermonComment:
    comment = (
        await db.execute(
            select(SermonComment)
            .where(SermonComment.id == comment_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if comment is None:
        await db.rollback()
        raise ContentError("Comment not found", status_code=404)
    return comment


def _moderation_log(
    comment: SermonComment,
    actor: User,
    action: ModerationAction,
    reason: str | None,
    snapshot: str | None = None,
    cleared_report_count: int | None = None,
) -> CommentModerationLog:
    # clock_timestamp() (not the transaction-start now()) so a restore row is
    # ordered against concurrent reports by lock order: S6's re-arm rule counts
    # only reports strictly after the latest restore row.
    return CommentModerationLog(
        comment_id=comment.id,
        actor_id=actor.id,
        action=action,
        reason=reason,
        sermon_id=comment.sermon_id,
        author_id=comment.user_id,
        body_snapshot=snapshot,
        cleared_report_count=cleared_report_count,
        created_at=func.clock_timestamp(),
    )


async def hide_comment(
    db: AsyncSession, actor: User, comment_id: uuid.UUID, reason: str
) -> CommentAdmin | CommentAdminForEditor:
    """Manual hide. Idempotent on an already manually hidden comment (no state
    change, no log row). On an auto-hidden comment it converts the hide to a
    manual one (`hidden_auto=false`, pin A9) and logs a `hide` with the reason."""
    async with _write_guard(db, "comment_moderation_failed"):
        comment = await _lock_for_moderation(db, comment_id)
        if comment.status == CommentStatus.HIDDEN and not comment.hidden_auto:
            result = await _admin_row(db, actor, comment_id)
            await (
                db.rollback()
            )  # release the lock; rollback expires loaded rows, so read first
            return result
        comment.status = CommentStatus.HIDDEN
        comment.hidden_auto = False
        comment.hidden_at = func.clock_timestamp()
        comment.hidden_by_id = actor.id
        comment.hidden_reason = reason
        db.add(_moderation_log(comment, actor, ModerationAction.HIDE, reason))
        await db.commit()
        result = await _admin_row(db, actor, comment_id)
    log.info("comment_hidden", comment_id=str(comment_id), actor_id=str(actor.id))
    return result


async def restore_comment(
    db: AsyncSession, actor: User, comment_id: uuid.UUID
) -> CommentAdmin | CommentAdminForEditor:
    """Restore a HIDDEN comment: VISIBLE, hide fields cleared, `report_count`
    reset to 0 (pin A7) and a `restore` log row written under the row lock.
    That row is the re-arm baseline, so a restore of an already VISIBLE comment
    is a no-op that writes nothing."""
    async with _write_guard(db, "comment_moderation_failed"):
        comment = await _lock_for_moderation(db, comment_id)
        if comment.status == CommentStatus.VISIBLE:
            result = await _admin_row(db, actor, comment_id)
            await db.rollback()
            return result
        comment.status = CommentStatus.VISIBLE
        comment.hidden_auto = False
        comment.hidden_at = None
        comment.hidden_by_id = None
        comment.hidden_reason = None
        comment.report_count = 0
        db.add(_moderation_log(comment, actor, ModerationAction.RESTORE, None))
        await db.commit()
        result = await _admin_row(db, actor, comment_id)
    log.info("comment_restored", comment_id=str(comment_id), actor_id=str(actor.id))
    return result


async def dismiss_reports(
    db: AsyncSession, actor: User, comment_id: uuid.UUID, reason: str
) -> CommentAdmin | CommentAdminForEditor:
    """Clear the reports on a VISIBLE comment: `report_count` to 0, status and
    hide fields untouched, one `dismiss_reports` log row written under the row
    lock, carrying the reason (required) and `cleared_report_count`. The row is a
    re-arm baseline like `restore`. A VISIBLE comment with no reports is a no-op
    that writes nothing (the reason is still validated at the edge); a HIDDEN comment is a 409 (use
    restore)."""
    async with _write_guard(db, "comment_moderation_failed"):
        comment = await _lock_for_moderation(db, comment_id)
        if comment.status == CommentStatus.HIDDEN:
            await db.rollback()
            raise ContentError(
                "Comment is hidden; restore it instead of dismissing reports",
                status_code=409,
            )
        if comment.report_count == 0:
            result = await _admin_row(db, actor, comment_id)
            await db.rollback()
            return result
        cleared = comment.report_count
        comment.report_count = 0
        db.add(
            _moderation_log(
                comment,
                actor,
                ModerationAction.DISMISS_REPORTS,
                reason,
                cleared_report_count=cleared,
            )
        )
        await db.commit()
        result = await _admin_row(db, actor, comment_id)
    log.info(
        "comment_reports_dismissed", comment_id=str(comment_id), actor_id=str(actor.id)
    )
    return result


async def hard_delete_comment(
    db: AsyncSession, actor: User, comment_id: uuid.UUID, reason: str
) -> None:
    """Physical DELETE plus a `hard_delete` log row carrying the reason and the
    body snapshot, in one transaction. The snapshot is nulled by the 90-day
    purge script. Reports go with the comment (FK cascade)."""
    async with _write_guard(db, "comment_moderation_failed"):
        comment = await _lock_for_moderation(db, comment_id)
        db.add(
            _moderation_log(
                comment,
                actor,
                ModerationAction.HARD_DELETE,
                reason,
                snapshot=comment.body,
            )
        )
        sermon_id = comment.sermon_id
        await db.delete(comment)
        await db.commit()
    log.info(
        "comment_hard_deleted",
        comment_id=str(comment_id),
        sermon_id=str(sermon_id),
        actor_id=str(actor.id),
    )
