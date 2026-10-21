"""System audit trail writer (`plan-admin-settings.md` §A.3/§A.6, step S6).

Two entry points, matching §A.3's two transaction shapes:

* `record()` — for a privileged mutation that must be atomic with its audit
  row (staff invites, role changes, settings updates, ...). It **adds and
  flushes** onto the caller's own session and never commits: the caller's
  existing `db.commit()` decides the row's fate together with whatever it
  documents, and a forced audit-insert failure rolls the mutation back with
  it (DoD bullet 2, K3).
* `record_detached()` — for a fail-open event (`auth.login`, `auth.logout`)
  that must never block the caller. It opens and commits its own session,
  so a broken audit insert cannot roll back work the caller has already
  committed (tokens already issued by the time this runs), and swallows any
  exception after logging `audit_write_failed` — there is nothing for the
  caller to check.

Routers build an `AuditContext` from request-derived fields (correlation id,
client IP, `User-Agent`) and pass it in; services never read `Request`
themselves (§A.3). Call sites: staff mutations in `auth_service` (S7);
login/logout/password events in `app/api/auth.py` and `auth_service` (S8);
settings (S12) and report export (S13) are still to come.

The read side (`list_entries`, S10, D9) is a query-time `UNION ALL` of
`audit_log` with the three domain logs that predate it (`approval_log`,
`announcement_approval_log`, `comment_moderation_log`), normalised to one
row shape. No DB VIEW, and the legacy tables are not altered.
"""
from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import String, cast, func, literal, null, or_, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.database import PrimarySession
from app.models.models import (
    Announcement,
    AnnouncementApprovalLog,
    ApprovalLog,
    AuditAction,
    AuditLog,
    AuditOutcome,
    CommentModerationLog,
    ModerationAction,
    Sermon,
    User,
)

log = get_logger("audit")


@dataclass(frozen=True, slots=True)
class AuditContext:
    """Request-derived fields a service must not reach for itself. Routers
    build one per request: `correlation_id` from
    `app.core.logging.correlation_id`'s contextvar, `ip` from
    `app.core.net.client_ip(request)`, and `user_agent` from the raw
    `User-Agent` header (truncated to 512 chars, matching the column)."""

    correlation_id: str | None = None
    ip: str | None = None
    user_agent: str | None = None


@dataclass(frozen=True, slots=True)
class AuditTarget:
    """What an audit row's `target_*` columns describe. `target_type` is a
    short tag (e.g. `"user"`, `"church_settings"`) — not an FK, since the
    referent's type varies per action and some actions have no target at
    all. `label` is a human-readable snapshot (e.g. an email), taken at
    write time because the referenced row can later be hard-deleted."""

    type: str
    id: uuid.UUID | None = None
    label: str | None = None


async def record(
    db: AsyncSession,
    action: AuditAction,
    *,
    actor: User | None,
    target: AuditTarget | None,
    details: dict | None,
    outcome: AuditOutcome,
    ctx: AuditContext,
) -> AuditLog:
    """Add (and flush) one `audit_log` row onto `db`'s current transaction.

    Never commits. The caller's own `db.commit()` (or an exception that
    rolls it back) decides this row's fate atomically with whatever
    privileged mutation it documents.
    """
    row = AuditLog(
        action=action,
        outcome=outcome,
        actor_id=actor.id if actor is not None else None,
        actor_email=actor.email if actor is not None else None,
        actor_role=actor.role.value if actor is not None else None,
        target_type=target.type if target is not None else None,
        target_id=target.id if target is not None else None,
        target_label=target.label if target is not None else None,
        ip=ctx.ip,
        user_agent=ctx.user_agent,
        correlation_id=ctx.correlation_id,
        details=details or {},
    )
    db.add(row)
    await db.flush()
    return row


async def record_detached(
    action: AuditAction,
    *,
    actor: User | None,
    target: AuditTarget | None,
    details: dict | None,
    outcome: AuditOutcome,
    ctx: AuditContext,
) -> None:
    """Fail-open audit write for events that must never block the caller
    (§A.3: `auth.login`, `auth.logout`). Opens and commits its own session.
    Any exception — a DB outage, a constraint violation, anything — is
    caught, logged once as `audit_write_failed`, and swallowed (K3):
    callers get no exception and nothing to check, by design.
    """
    try:
        async with PrimarySession() as db:
            await record(
                db, action,
                actor=actor, target=target, details=details,
                outcome=outcome, ctx=ctx,
            )
            await db.commit()
    except Exception as exc:
        log.error(
            "audit_write_failed",
            action=action.value,
            actor_id=str(actor.id) if actor is not None else None,
            correlation_id=ctx.correlation_id,
            error=type(exc).__name__,
        )


async def record_login_failed(email: str, *, ctx: AuditContext) -> None:
    """`auth.login_failed` for a password login (§A.3). Runs as a
    `BackgroundTasks` job **after** the 401 has been sent, so the account
    lookup it needs adds nothing to the request path: `authenticate`'s
    equal-cost guarantee for unknown vs known emails stays intact.

    Writes a row only when `email` matches an account (an unknown email
    identifies no one, so there is nothing to attribute); the account is
    recorded as the actor. `reason` is `inactive` for a deactivated account,
    else `bad_password`. Fail-open exactly like `record_detached`.
    """
    try:
        async with PrimarySession() as db:
            user = (
                await db.execute(select(User).where(User.email == email.lower()))
            ).scalar_one_or_none()
            if user is None:
                return
            reason = "bad_password" if user.is_active else "inactive"
            await record(
                db, AuditAction.LOGIN_FAILED,
                actor=user, target=None,
                details={"method": "password", "reason": reason},
                outcome=AuditOutcome.FAILURE, ctx=ctx,
            )
            await db.commit()
    except Exception as exc:
        log.error(
            "audit_write_failed",
            action=AuditAction.LOGIN_FAILED.value,
            correlation_id=ctx.correlation_id,
            error=type(exc).__name__,
        )


# ── Read side: the unified audit feed (S10) ─────────────────────────────────

SOURCE_AUDIT_LOG = "audit_log"
SOURCE_SERMON_APPROVALS = "approval_log"
SOURCE_ANNOUNCEMENT_APPROVALS = "announcement_approval_log"
SOURCE_COMMENT_MODERATION = "comment_moderation_log"

SERMON_STATUS_CHANGED = "sermon.status_changed"
ANNOUNCEMENT_STATUS_CHANGED = "announcement.status_changed"
_COMMENT_PREFIX = "comment."

# `category` filter → the action prefix (audit_log) or legacy source it
# selects (§A.5).
_CATEGORY_PREFIX = {
    "auth": "auth.",
    "users": "user.",
    "settings": "settings.",
    "reports": "report.",
    "sermons": "sermon.",
    "announcements": "announcement.",
    "moderation": _COMMENT_PREFIX,
}
CATEGORIES = tuple(_CATEGORY_PREFIX)

_STAFF_ROLES = ("editor", "manager", "admin")
# A comment's own author deleting it is a viewer action, not a staff one, so
# the staff-only view leaves it out. Every other legacy row is a staff
# decision (or `auto_hide`, the system acting on staff-configured rules).
_VIEWER_LEGACY_ACTIONS = (_COMMENT_PREFIX + ModerationAction.SELF_DELETE.value,)

_DELETED_ACCOUNT = "Deleted account"
_SYSTEM = "System"


@dataclass(frozen=True, slots=True)
class AuditFilters:
    actor_id: uuid.UUID | None = None
    actions: Sequence[str] = ()
    category: str | None = None
    staff_only: bool = True
    target_type: str | None = None
    target_id: uuid.UUID | None = None
    outcome: AuditOutcome | None = None
    from_: datetime | None = None
    to: datetime | None = None


@dataclass(frozen=True, slots=True)
class AuditFeedRow:
    """One normalised row of the feed. `actor_label` is the email snapshot
    (`audit_log`) or the joined account's email (legacy rows, NULL when the
    account is gone). `summary` is built from `action` + `details`."""

    source: str
    id: uuid.UUID
    created_at: datetime
    action: str
    outcome: str
    actor_id: uuid.UUID | None
    actor_label: str | None
    actor_role: str | None
    target_type: str | None
    target_id: uuid.UUID | None
    target_label: str | None
    ip: str | None
    user_agent: str | None
    details: dict[str, Any]
    summary: str


def _s(col, length: int = 64):
    """Enum-typed columns come back as their Python enum; in a UNION the
    first branch's type would be imposed on every branch, so each column is
    cast to a plain string up front."""
    return cast(col, String(length))


def _feed_union():
    """The four sources, normalised. Extra legacy-only columns (status pair,
    note, reason, ...) ride along as NULL elsewhere and become `details` in
    Python, which keeps the SQL identical on SQLite and Postgres (no
    dialect-specific JSON builders)."""
    t = AuditLog.__table__.c
    details_type = t.details.type
    ip_type = t.ip.type
    actor = User.__table__.alias("actor")
    actor_role = func.lower(cast(actor.c.role, String(20)))

    def _legacy_cols(**over):
        cols = dict(
            ip=cast(null(), ip_type),
            user_agent=cast(null(), String(512)),
            details=cast(null(), details_type),
            from_status=cast(null(), String(20)),
            to_status=cast(null(), String(20)),
            note=cast(null(), String),
            reason=cast(null(), String),
            cleared_report_count=cast(null(), String(12)),
            comment_sermon_id=cast(null(), String(36)),
        )
        cols.update(over)
        return [v.label(k) for k, v in cols.items()]

    own = select(
        literal(SOURCE_AUDIT_LOG, String(32)).label("source"),
        t.id.label("id"),
        t.created_at.label("created_at"),
        _s(t.action, 40).label("action"),
        _s(t.outcome, 10).label("outcome"),
        t.actor_id.label("actor_id"),
        t.actor_email.label("actor_label"),
        t.actor_role.label("actor_role"),
        t.target_type.label("target_type"),
        t.target_id.label("target_id"),
        t.target_label.label("target_label"),
        t.ip.label("ip"),
        t.user_agent.label("user_agent"),
        t.details.label("details"),
        *[
            cast(null(), typ).label(name)
            for name, typ in (
                ("from_status", String(20)), ("to_status", String(20)),
                ("note", String), ("reason", String),
                ("cleared_report_count", String(12)), ("comment_sermon_id", String(36)),
            )
        ],
    )

    a = ApprovalLog.__table__.c
    sermon = Sermon.__table__.c
    sermons = (
        select(
            literal(SOURCE_SERMON_APPROVALS, String(32)),
            a.id, a.created_at,
            literal(SERMON_STATUS_CHANGED, String(40)),
            literal(AuditOutcome.SUCCESS.value, String(10)),
            a.actor_id, actor.c.email, actor_role,
            literal("sermon", String(30)), a.sermon_id, cast(sermon.title, String(200)),
            *_legacy_cols(from_status=a.from_status, to_status=a.to_status, note=a.note),
        )
        .select_from(ApprovalLog.__table__)
        .outerjoin(actor, actor.c.id == a.actor_id)
        .outerjoin(Sermon.__table__, sermon.id == a.sermon_id)
    )

    n = AnnouncementApprovalLog.__table__.c
    ann = Announcement.__table__.c
    announcements = (
        select(
            literal(SOURCE_ANNOUNCEMENT_APPROVALS, String(32)),
            n.id, n.created_at,
            literal(ANNOUNCEMENT_STATUS_CHANGED, String(40)),
            literal(AuditOutcome.SUCCESS.value, String(10)),
            n.actor_id, actor.c.email, actor_role,
            literal("announcement", String(30)), n.announcement_id, cast(ann.title, String(200)),
            *_legacy_cols(from_status=n.from_status, to_status=n.to_status, note=n.note),
        )
        .select_from(AnnouncementApprovalLog.__table__)
        .outerjoin(actor, actor.c.id == n.actor_id)
        .outerjoin(Announcement.__table__, ann.id == n.announcement_id)
    )

    c = CommentModerationLog.__table__.c
    comments = (
        select(
            literal(SOURCE_COMMENT_MODERATION, String(32)),
            c.id, c.created_at,
            literal(_COMMENT_PREFIX, String(40)) + _s(c.action, 20),
            literal(AuditOutcome.SUCCESS.value, String(10)),
            c.actor_id, actor.c.email, actor_role,
            # The comment body is moderated content (and purged on its own
            # retention clock) — it is never copied into the feed.
            literal("comment", String(30)), c.comment_id, cast(null(), String(200)),
            *_legacy_cols(
                reason=c.reason,
                cleared_report_count=cast(c.cleared_report_count, String(12)),
                comment_sermon_id=cast(c.sermon_id, String(36)),
            ),
        )
        .select_from(CommentModerationLog.__table__)
        .outerjoin(actor, actor.c.id == c.actor_id)
    )

    return union_all(own, sermons, announcements, comments).subquery("feed")


def _where(feed, f: AuditFilters) -> list:
    clauses: list = []
    if f.actor_id is not None:
        clauses.append(feed.c.actor_id == f.actor_id)
    if f.actions:
        clauses.append(feed.c.action.in_(list(f.actions)))
    if f.category is not None:
        clauses.append(feed.c.action.startswith(_CATEGORY_PREFIX[f.category]))
    if f.staff_only:
        clauses.append(
            or_(
                (feed.c.source == SOURCE_AUDIT_LOG) & feed.c.actor_role.in_(_STAFF_ROLES),
                (feed.c.source != SOURCE_AUDIT_LOG)
                & feed.c.action.not_in(_VIEWER_LEGACY_ACTIONS),
            )
        )
    if f.target_type is not None:
        clauses.append(feed.c.target_type == f.target_type)
    if f.target_id is not None:
        clauses.append(feed.c.target_id == f.target_id)
    if f.outcome is not None:
        clauses.append(feed.c.outcome == f.outcome.value)
    if f.from_ is not None:
        clauses.append(feed.c.created_at >= f.from_)
    if f.to is not None:
        clauses.append(feed.c.created_at < f.to)
    return clauses


def _legacy_details(row) -> dict[str, Any]:
    if row.source in (SOURCE_SERMON_APPROVALS, SOURCE_ANNOUNCEMENT_APPROVALS):
        out: dict[str, Any] = {"from": row.from_status, "to": row.to_status}
        if row.note:
            out["note"] = row.note
        return out
    out = {"sermon_id": row.comment_sermon_id}
    if row.reason:
        out["reason"] = row.reason
    if row.cleared_report_count is not None:
        out["cleared_report_count"] = int(row.cleared_report_count)
    return out


def _actor_label(row) -> str:
    if row.actor_label:
        return row.actor_label
    if row.action == _COMMENT_PREFIX + ModerationAction.AUTO_HIDE.value:
        return _SYSTEM
    return _DELETED_ACCOUNT


_COMMENT_VERBS = {
    ModerationAction.HIDE.value: "hid a comment",
    ModerationAction.RESTORE.value: "restored a comment",
    ModerationAction.HARD_DELETE.value: "permanently deleted a comment",
    ModerationAction.SELF_DELETE.value: "deleted their own comment",
    ModerationAction.AUTO_HIDE.value: "auto-hid a comment after reports",
    ModerationAction.DISMISS_REPORTS.value: "dismissed reports on a comment",
}


def build_summary(
    action: str, actor: str, target: str | None, details: dict[str, Any]
) -> str:
    """One readable line per row (§A.5 `summary`), from a per-action
    template. Unknown actions fall back to the raw action name, so a new
    event never breaks the feed."""
    target = target or "an account"
    if action == AuditAction.LOGIN.value:
        method = details.get("method", "password")
        suffix = " (new account)" if details.get("new_account") else ""
        return f"{actor} signed in with {method}{suffix}"
    if action == AuditAction.LOGIN_FAILED.value:
        why = "account deactivated" if details.get("reason") == "inactive" else "wrong password"
        return f"Failed sign-in for {actor} ({why})"
    if action == AuditAction.LOGOUT.value:
        return f"{actor} signed out"
    if action == AuditAction.PASSWORD_CHANGED.value:
        return f"{actor} changed their password"
    if action == AuditAction.PASSWORD_RESET.value:
        if details.get("token_type") == "invite":
            return f"{actor} set their password from an invite"
        return f"{actor} reset their password"
    if action == AuditAction.STAFF_INVITED.value:
        return f"{actor} invited {target} as {details.get('role', 'staff')}"
    if action == AuditAction.INVITE_RESENT.value:
        return f"{actor} resent the invite to {target}"
    if action == AuditAction.ROLE_CHANGED.value:
        return f"{actor} changed {target}'s role from {details.get('from')} to {details.get('to')}"
    if action == AuditAction.DEACTIVATED.value:
        return f"{actor} deactivated {target}"
    if action == AuditAction.REACTIVATED.value:
        return f"{actor} reactivated {target}"
    if action == AuditAction.SETTINGS_UPDATED.value:
        changed = ", ".join(details.get("changed") or []) or "church settings"
        return f"{actor} updated {changed}"
    if action == AuditAction.REPORT_EXPORTED.value:
        return f"{actor} exported the {details.get('kind', 'usage')} report"
    if action in (SERMON_STATUS_CHANGED, ANNOUNCEMENT_STATUS_CHANGED):
        kind = "sermon" if action == SERMON_STATUS_CHANGED else "announcement"
        frm, to = details.get("from"), details.get("to")
        moved = f"from {frm} to {to}" if frm else f"to {to}"
        return f"{actor} moved {kind} \"{target}\" {moved}"
    if action.startswith(_COMMENT_PREFIX):
        verb = _COMMENT_VERBS.get(action[len(_COMMENT_PREFIX):], action)
        return f"{actor} {verb}"
    return f"{actor}: {action}"


async def list_entries(
    db: AsyncSession, filters: AuditFilters, *, limit: int, offset: int
) -> tuple[list[AuditFeedRow], int]:
    """Filtered, newest-first page of the unified feed, plus the filtered
    total. Ordered `(created_at DESC, id DESC)` so rows sharing a timestamp
    page deterministically."""
    feed = _feed_union()
    where = _where(feed, filters)

    total = (
        await db.execute(select(func.count()).select_from(feed).where(*where))
    ).scalar_one()
    rows = (
        await db.execute(
            select(feed)
            .where(*where)
            .order_by(feed.c.created_at.desc(), feed.c.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    items: list[AuditFeedRow] = []
    for row in rows:
        details = (
            dict(row.details or {}) if row.source == SOURCE_AUDIT_LOG else _legacy_details(row)
        )
        actor_label = _actor_label(row)
        items.append(
            AuditFeedRow(
                source=row.source,
                id=row.id,
                created_at=row.created_at,
                action=row.action,
                outcome=row.outcome,
                actor_id=row.actor_id,
                actor_label=actor_label,
                actor_role=row.actor_role,
                target_type=row.target_type,
                target_id=row.target_id,
                target_label=row.target_label,
                ip=row.ip,
                user_agent=row.user_agent,
                details=details,
                summary=build_summary(row.action, actor_label, row.target_label, details),
            )
        )
    return items, total
