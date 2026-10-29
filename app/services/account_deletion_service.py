"""Self-service account deletion (ADR 0020; §A.3 of
plans/plan-account-deletion-backend.md).

Split with the router (`POST /auth/me/delete`) in the order the plan pins:

1. router: viewer-only, per-user limiter (fail closed), shared login key;
2. `prepare_account_deletion`: load the account and its linked providers and
   settle the Apple-fork preconditions (409s), *before* any proof is checked;
3. router: verify the proof (it owns `_claim_oauth_token_once`);
4. `delete_own_account`: lock the row, RESTRICT precheck, snapshot providers,
   Apple revocation (before any data is touched), then the shared
   `auth_service._erase_user` transaction, then the best-effort notice email.

Typed `ContentError`s carry the §A.2 status; the router maps them to HTTP.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import email as email_module
from app.core.apple_revocation import AppleRevocationClient, AppleRevocationError
from app.core.logging import get_logger
from app.models.models import AuthProvider, User, UserIdentity, UserRole
from app.services import auth_service
from app.services.audit_service import AuditContext
from app.services.content_service import ContentError

log = get_logger("account_deletion")

STAFF_MESSAGE = "Staff accounts are removed by an administrator"
APPLE_REAUTH_REQUIRED = "Apple re-auth required"
APPLE_ONLY_MESSAGE = (
    "Apple is the only sign-in method on this account, so it can't be removed "
    "without Apple. Contact support to delete this account."
)
APPLE_UNAVAILABLE_MESSAGE = "Apple is unavailable right now. Try again shortly."
APPLE_EXPIRED_MESSAGE = "Apple sign-in expired. Sign in with Apple again and retry."
REAUTH_FAILED_MESSAGE = "Could not confirm your identity"
_HISTORY_MESSAGE = (
    "This account can't be deleted automatically because it is linked to {parts}. "
    "Contact support to have it removed."
)


@dataclass(frozen=True)
class DeletionTarget:
    """The account plus what re-auth needs: its linked provider subjects, and
    whether the caller's `apple_unavailable` flag is honoured (Apple linked,
    a non-Apple proof, flag set)."""

    user: User
    subjects: dict[AuthProvider, str]
    skip_apple: bool


def ensure_viewer(role: UserRole) -> None:
    if role != UserRole.VIEWER:
        raise ContentError(STAFF_MESSAGE, status_code=403)


async def _identity_subjects(
    db: AsyncSession, user_id: uuid.UUID
) -> dict[AuthProvider, str]:
    rows = (await db.execute(
        select(UserIdentity.provider, UserIdentity.provider_subject).where(
            UserIdentity.user_id == user_id
        )
    )).all()
    return {provider: subject for provider, subject in rows}


async def prepare_account_deletion(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    method: str,
    apple_unavailable: bool,
) -> DeletionTarget:
    user = await auth_service.get_user_by_id(db, user_id)
    if user is None:
        raise ContentError("Could not validate credentials", status_code=401)
    ensure_viewer(user.role)
    subjects = await _identity_subjects(db, user.id)

    skip_apple = False
    if AuthProvider.APPLE in subjects and method != "apple":
        if not apple_unavailable:
            raise ContentError(APPLE_REAUTH_REQUIRED, status_code=409)
        if not user.password_hash and set(subjects) == {AuthProvider.APPLE}:
            raise ContentError(APPLE_ONLY_MESSAGE, status_code=409)
        skip_apple = True
    return DeletionTarget(user=user, subjects=subjects, skip_apple=skip_apple)


def _restrict_conflict(parts: str | None = None) -> ContentError:
    return ContentError(
        _HISTORY_MESSAGE.format(parts=parts or "authored content"), status_code=409
    )


async def delete_own_account(
    db: AsyncSession,
    target: DeletionTarget,
    ctx: AuditContext,
    *,
    apple_client: AppleRevocationClient,
    authorization_code: str | None,
) -> None:
    """Runs after the proof is verified. `authorization_code` is the fresh
    Apple code (apple method only)."""
    user_id = target.user.id

    # Serialise concurrent deletes of one account: the loser blocks here until
    # the winner commits, then finds no row and gets a 401 instead of writing a
    # second USER_DELETED row. Held across the Apple call on purpose.
    user = (await db.execute(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if user is None:
        raise ContentError("Could not validate credentials", status_code=401)
    ensure_viewer(user.role)

    history = await auth_service._authored_history(db, user_id)
    if history:
        parts = ", ".join(
            f"{auth_service._HISTORY_LABELS.get(name, name)} ({n})"
            for name, n in sorted(history.items())
        )
        raise _restrict_conflict(parts)

    # Snapshot taken after the lock, so the audit row reflects what was erased.
    subjects = await _identity_subjects(db, user_id)
    email = user.email
    details: dict = {"self_service": True, "providers": sorted(p.value for p in subjects)}

    if AuthProvider.APPLE not in subjects:
        details["apple_revoked"] = None
    elif authorization_code is not None:
        await _revoke_apple(apple_client, authorization_code)
        details["apple_revoked"] = True
    elif target.skip_apple:
        details["apple_revoked"] = False
        details["apple_skip_reason"] = "apple_unavailable"
    else:
        # Apple appeared between prepare and the lock with no code to revoke.
        raise ContentError(APPLE_REAUTH_REQUIRED, status_code=409)

    try:
        revocation_deferred = await auth_service._erase_user(db, user, user, ctx, details)
    except IntegrityError:
        # Backstop for a RESTRICT row created after the precheck: nothing was
        # committed, so the account is intact.
        await db.rollback()
        log.warning("account_deletion_restrict_backstop", user_id=str(user_id))
        raise _restrict_conflict() from None
    if revocation_deferred:
        log.warning("refresh_revocation_deferred", user_id=str(user_id))

    try:
        await email_module.send_account_deleted(email)
    except Exception as exc:  # noqa: BLE001 - best-effort; the account is already gone
        log.warning(
            "account_deleted_notice_failed", user_id=str(user_id), error=type(exc).__name__
        )


async def _revoke_apple(client: AppleRevocationClient, authorization_code: str) -> None:
    try:
        await client.revoke_authorization(authorization_code)
    except AppleRevocationError as exc:
        if exc.reason == "invalid_grant":
            raise ContentError(APPLE_EXPIRED_MESSAGE, status_code=400) from None
        if exc.reason == "misconfigured":
            log.error("apple_revocation_misconfigured")
        raise ContentError(APPLE_UNAVAILABLE_MESSAGE, status_code=503) from None
