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
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.database import PrimarySession
from app.models.models import AuditAction, AuditLog, AuditOutcome, User

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

