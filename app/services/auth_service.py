import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security, token_store
from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.rate_limit import check_rate_limit
from app.core.token_store import TokenStoreUnavailable
from app.models.models import User, UserRole
from app.models.schemas import UserRegister
from app.services.content_service import ContentError

import secrets  # noqa: E402

from sqlalchemy import select as _select  # noqa: E402

from app.models.models import UserRole as _UserRole  # noqa: E402

log = get_logger("auth")
settings = get_settings()

# Who may assign which roles. Managers can create/manage editors; only admins
# can mint or grant manager/admin. Prevents a manager escalating to admin.
_ASSIGNABLE_BY: dict[_UserRole, set[_UserRole]] = {
    _UserRole.MANAGER: {_UserRole.EDITOR},
    _UserRole.ADMIN: {_UserRole.EDITOR, _UserRole.MANAGER, _UserRole.ADMIN},
}

class AuthError(Exception):
    """Raised for expected auth failures; carries a public-safe message."""

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def _may_assign(actor_role: _UserRole, target_role: _UserRole) -> bool:
    return target_role in _ASSIGNABLE_BY.get(actor_role, set())

async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email.lower()))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    return await db.get(User, user_id)


async def register_user(db: AsyncSession, data: UserRegister) -> User:
    existing = await get_user_by_email(db, data.email)
    if existing is not None:
        # Do not reveal whether the email exists — generic message.
        raise AuthError("Could not complete registration")

    user = User(
        email=data.email.lower(),
        password_hash=security.hash_password(data.password),
        role=UserRole.VIEWER,
    )
    db.add(user)
    await db.flush()

    # Every user owns exactly one subscription row from the moment they exist,
    # so entitlement checks never have to cope with a missing record.
    from app.models.models import Subscription, SubscriptionTier

    db.add(Subscription(user_id=user.id, tier=SubscriptionTier.FREE))

    await db.commit()
    await db.refresh(user)
    log.info("user_registered", user_id=str(user.id))
    return user


async def authenticate(db: AsyncSession, email: str, password: str) -> User:
    user = await get_user_by_email(db, email)
    # verify_password runs a dummy verify when user is None, so an unknown
    # email costs the same time as a wrong password (no enumeration oracle).
    stored = user.password_hash if user is not None else None
    if user is None or not security.verify_password(password, stored):
        raise AuthError("Invalid email or password")
    if not user.is_active:
        raise AuthError("Invalid email or password")

    # Transparent hash upgrade if Argon2 parameters have been raised since the
    # password was set. The user notices nothing and never resets a password.
    _, new_hash = security.verify_and_rehash(password, user.password_hash)
    if new_hash is not None:
        user.password_hash = new_hash
        await db.commit()
        log.info("password_hash_upgraded", user_id=str(user.id))

    return user


async def issue_token_pair(user: User) -> tuple[str, str]:
    access = security.create_access_token(str(user.id), user.role.value)
    refresh, jti = security.create_refresh_token(str(user.id))
    await token_store.store_refresh_jti(str(user.id), jti)
    return access, refresh


async def rotate_refresh(db: AsyncSession, refresh_token: str) -> tuple[str, str]:
    payload = security.decode_token(refresh_token, security.REFRESH)
    if payload is None:
        raise AuthError("Invalid or expired refresh token")

    user_id = payload["sub"]
    jti = payload["jti"]

    if not await token_store.is_current_refresh_jti(user_id, jti):
        # Token reuse or already rotated — revoke everything as a precaution.
        await token_store.revoke_refresh(user_id)
        raise AuthError("Invalid or expired refresh token")

    user = await get_user_by_id(db, uuid.UUID(user_id))
    if user is None or not user.is_active:
        raise AuthError("Invalid or expired refresh token")

    return await issue_token_pair(user)


async def logout(user_id: str) -> None:
    await token_store.revoke_refresh(user_id)


async def reset_password(db: AsyncSession, token: str, new_password: str) -> None:
    payload = security.decode_token(token, {security.RESET, security.INVITE})
    if payload is None:
        raise AuthError("Invalid or expired reset token")

    # Consume the one-shot jti BEFORE touching the password. A replay inside the
    # token's TTL finds nothing to consume and is rejected here. If Redis is
    # unreachable, consume_single_use raises TokenStoreUnavailable -> 503 and the
    # password is left unchanged (the Step 2 fail-closed contract).
    jti = payload.get("jti")
    if jti is None or not await token_store.consume_single_use(jti):
        raise AuthError("Invalid or expired reset token")

    user = await get_user_by_id(db, uuid.UUID(payload["sub"]))
    if user is None:
        raise AuthError("Invalid or expired reset token")

    user.password_hash = security.hash_password(new_password)
    # First password the account has chosen for itself → its staff invite is now
    # complete. Stamp `activated_at` in the SAME transaction as the password
    # write (before commit) so the "is this account still pending?" fact can
    # never lag the password — fail-closed. Only when currently NULL: a
    # forgot-password reset on an already-activated account leaves the earlier
    # timestamp untouched. `resend_invite` reads this column, not Redis.
    if user.activated_at is None:
        user.activated_at = datetime.now(timezone.utc)
    await db.commit()
    # Force re-login everywhere after a password change.
    await token_store.revoke_refresh(str(user.id))
    log.info("password_reset", user_id=str(user.id), token_type=payload.get("type"))


async def change_password(
    db: AsyncSession, user_id: uuid.UUID, current_password: str, new_password: str
) -> None:
    """Change an authenticated user's password. Requires the current password —
    an access token alone is not enough."""
    user = await get_user_by_id(db, user_id)
    if user is None:
        raise AuthError("User not found")

    if not security.verify_password(current_password, user.password_hash):
        log.warning("password_change_denied", user_id=str(user.id))
        raise AuthError("Current password is incorrect")

    user.password_hash = security.hash_password(new_password)
    # Revoke every session BEFORE the write commits (as reset_password sequences
    # consume-before-write). If Redis is unreachable revoke_refresh raises
    # TokenStoreUnavailable -> 503 and the pending hash change rolls back with
    # the session — rather than persisting a new password whose old sessions
    # were never cut while telling the caller "unavailable, retry".
    await token_store.revoke_refresh(str(user.id))
    await db.commit()
    log.info("password_changed", user_id=str(user.id))


async def create_staff(
    db: AsyncSession,
    email: str,
    full_name: str | None,
    role: _UserRole,
    actor: User,
    send_invite: Callable[[str, str | None, str], Awaitable[None]],
) -> tuple[User, str]:
    """Create a staff account and send its invite atomically.

    The invite email is sent *before* the transaction commits. If sending
    fails, the whole thing rolls back — so we never leave an orphaned account
    that can't be activated and whose email address is now unusable. Pass
    send_invite as an async callable (to, full_name, invite_token).
    """
    if not _may_assign(actor.role, role):
        raise AuthError(f"You are not permitted to create a '{role.value}' account")

    email = email.lower().strip()
    if await get_user_by_email(db, email) is not None:
        raise AuthError("A user with that email already exists")

    # A long random password the account holder never learns — the account is
    # unusable until they set their own via the invite link.
    temp_password = secrets.token_urlsafe(32)

    user = User(
        email=email,
        full_name=full_name,
        password_hash=security.hash_password(temp_password),
        role=role,
    )

    db.add(user)
    # flush() assigns the PK within the transaction without committing, so we
    # can mint the invite token and attempt delivery before making it permanent.
    await db.flush()
    await db.refresh(user)

    # Staff get a free subscription row too — role governs their content
    # privileges, entitlement governs paid playback; the two are independent.
    from app.models.models import Subscription, SubscriptionTier

    db.add(Subscription(user_id=user.id, tier=SubscriptionTier.FREE))

    invite_token, invite_jti = security.create_invite_token(str(user.id))
    invite_ttl_seconds = settings.invite_token_expire_hours * 60 * 60

    try:
        # Register the one-shot jti inside the pre-commit sequence: if anything
        # below rolls the transaction back, all that is left is an orphaned
        # ledger entry that expires on its own TTL — never a usable account.
        await token_store.register_single_use(invite_jti, invite_ttl_seconds)
        # Pointer to the live invite jti so a later resend can retire this link.
        # Self-expiring (invite TTL); "is this account pending?" is now the
        # `users.activated_at` column, not Redis (ADR 0005 §4).
        await token_store.remember_invite_jti(
            str(user.id), invite_jti, invite_ttl_seconds
        )
        await send_invite(user.email, user.full_name, invite_token)
    except TokenStoreUnavailable:
        # Fail closed: don't create an account whose invite we couldn't record.
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        log.warning("staff_invite_send_failed", user_id=str(user.id))
        raise AuthError(
            "Could not send the invite email — the account was not created. "
            "Please try again."
        )

    await db.commit()
    await db.refresh(user)

    log.info("staff_created", user_id=str(user.id), role=role.value, by=str(actor.id))

    return user, invite_token


async def _assert_not_last_active_admin(db: AsyncSession, target: User) -> None:
    """Refuse a change that would drop the active-admin count to zero.

    The minimum-cardinality invariant (plan §A.5): there must always be at
    least one `role='admin' AND is_active=true` user. Called in-transaction on
    **both** paths that can violate it — `change_role` (demotion out of admin)
    and `set_active` (deactivating an admin) — from one helper so the two can
    neither drift nor race each other.

    Mechanism (GATE 6 = A): lock every active-admin row `FOR UPDATE`, then
    count. If `target` is the only one, the caller's pending change would zero
    the count → 409. The lock set always contains `target`, because this is
    only reached when `target` is itself an active admin. Precedent for the
    construct is `content_service.transition` / `take_over_review`
    (`stmt.with_for_update()`), and it carries the same harness caveat: SQLite
    ignores `FOR UPDATE`, so the default suite proves only the *sequential*
    invariant — the concurrent race has one PG-gated module
    (`tests/test_last_admin_concurrent.py`, plan §A.5 / decision 10).

    A partial unique index cannot express this: a unique constraint bounds
    cardinality from *above* ("at most one"), and this is a *lower* bound.
    """
    if not (target.role == _UserRole.ADMIN and target.is_active):
        # `target` does not count toward the invariant; no change to it can
        # reduce the active-admin population.
        return

    active_admin_ids = (await db.execute(
        _select(User.id)
        .where(User.role == _UserRole.ADMIN, User.is_active.is_(True))
        # Deterministic lock order so two of these racing each other block
        # rather than deadlock (Postgres would abort one with a deadlock error
        # instead of the clean 409 below).
        .order_by(User.id)
        .with_for_update()
    )).scalars().all()

    if len(active_admin_ids) <= 1:
        raise ContentError(
            "This is the last active administrator. Promote or activate "
            "another admin before changing this account.",
            status_code=409,
        )


async def change_role(
    db: AsyncSession, target_id: uuid.UUID, new_role: _UserRole, actor: User
) -> User:
    if not _may_assign(actor.role, new_role):
        raise AuthError(f"You are not permitted to assign the '{new_role.value}' role")

    target = await get_user_by_id(db, target_id)
    if target is None:
        raise AuthError("User not found")

    # Guard against self-demotion locking you out of your own privileges.
    if target.id == actor.id and new_role != actor.role:
        raise AuthError("You cannot change your own role")

    # A manager may not modify an existing manager/admin (only admins touch those).
    if actor.role == _UserRole.MANAGER and target.role in (
        _UserRole.MANAGER, _UserRole.ADMIN
    ):
        raise AuthError("Only an admin can modify a manager or admin account")

    # Revoke BEFORE commit (see change_password): a Redis outage raises
    # TokenStoreUnavailable -> 503 with the role change rolled back, never a
    # persisted new role whose still-live sessions carry the old one. Done
    # *ahead of* the last-admin guard so no Redis round-trip ever happens while
    # that guard holds its FOR UPDATE locks on the active-admin rows (gilfoyle
    # review of a0c2575). set_active revokes after commit; change_role keeps its
    # fail-closed 503 semantics (ADR 0005 §3), so it revokes before commit but
    # before the lock instead of inside it. Cost: a demotion refused by the
    # near-unreachable 409 path has already revoked the target admin's sessions
    # (their role is unchanged) — a forced re-login, not a privilege issue.
    await token_store.revoke_refresh(str(target.id))

    # Last-admin invariant, shared with set_active. Only a demotion *out of*
    # admin can violate it; the helper no-ops for every other case.
    if new_role != _UserRole.ADMIN:
        await _assert_not_last_active_admin(db, target)

    old_role = target.role
    target.role = new_role
    await db.commit()
    await db.refresh(target)
    log.info(
        "role_changed",
        user_id=str(target.id),
        from_role=old_role.value,
        to_role=new_role.value,
        by=str(actor.id),
    )
    return target


async def set_active(
    db: AsyncSession, target_id: uuid.UUID, is_active: bool, actor: User
) -> tuple[User, bool]:
    """Deactivate (`is_active=False`) or reactivate a staff account.

    Returns `(user, revocation_deferred)`. Authz mirrors `_ASSIGNABLE_BY`
    (plan §W18): a manager may act on an **editor** only — a manager targeting
    a manager/admin (self included) is refused 403; an admin may act on anyone,
    subject to the last-admin invariant.

    Deactivation is **commit-first** (GATE 6 = Option B): `is_active=False`
    commits, *then* refresh-token revocation is attempted best-effort. A Redis
    outage does **not** 503 this call — `get_current_user` re-reads `is_active`
    on every request, so the account is locked out regardless, and keeping the
    lockout control usable during a Redis outage outweighs symmetry with
    `change_role` (which revokes-before-commit and does 503). On a deferred
    revoke the second tuple element is `True` and a warning is logged.
    """
    target = await get_user_by_id(db, target_id)
    if target is None:
        raise ContentError("User not found", status_code=404)

    # Mirror the role matrix: managers reach editors only; admins reach anyone.
    if not _may_assign(actor.role, target.role):
        raise ContentError(
            "You are not permitted to change this account's active status.",
            status_code=403,
        )

    if target.is_active == is_active:
        # Idempotent no-op — nothing to write, no sessions to cut.
        return target, False

    if not is_active:
        # Would deactivating this account strand the admin role?
        await _assert_not_last_active_admin(db, target)
        target.is_active = False
        await db.commit()
        await db.refresh(target)

        revocation_deferred = False
        try:
            await token_store.revoke_refresh(str(target.id))
        except TokenStoreUnavailable:
            # Commit already landed; every request re-checks is_active. The
            # un-revoked refresh token can still mint an access token, but
            # get_current_user rejects it on the inactive row — residual
            # exposure is one access-token lifetime, not a failed lockout.
            revocation_deferred = True
            log.warning(
                "deactivate_revoke_deferred",
                user_id=str(target.id),
                by=str(actor.id),
            )

        log.info(
            "user_deactivated",
            user_id=str(target.id),
            by=str(actor.id),
            revocation_deferred=revocation_deferred,
        )
        return target, revocation_deferred

    # Reactivation only ever raises the active-admin count, so no invariant
    # check. It still revokes refresh tokens best-effort: if the *prior*
    # deactivation deferred its revoke (Redis was down), `refresh:{uid}` still
    # holds the pre-deactivation jti, and reactivating within the 30-day refresh
    # TTL would otherwise re-arm a credential the deactivation was meant to kill
    # (CWE-613). Same commit-first posture as deactivate: the row change lands
    # first, then the revoke; a Redis outage still returns 200 with
    # `revocation_deferred=true` rather than 503.
    target.is_active = True
    await db.commit()
    await db.refresh(target)

    revocation_deferred = False
    try:
        await token_store.revoke_refresh(str(target.id))
    except TokenStoreUnavailable:
        revocation_deferred = True
        log.warning(
            "reactivate_revoke_deferred",
            user_id=str(target.id),
            by=str(actor.id),
        )

    log.info(
        "user_reactivated",
        user_id=str(target.id),
        by=str(actor.id),
        revocation_deferred=revocation_deferred,
    )
    return target, revocation_deferred


async def resend_invite(
    db: AsyncSession,
    target_id: uuid.UUID,
    actor: User,
    send_invite: Callable[[str, str | None, str], Awaitable[None]],
) -> tuple[User, str]:
    """Re-issue the invite for a staff account that has not finished
    set-password: a fresh single-use jti and a fresh invite email.

    Authz matrix is `set_active`'s. If the account has already set its own
    password (`users.activated_at is not None`) there is nothing to resend → 409.
    Capped at 3/hour per target (fixed window, fails open). The previously issued
    invite link is retired before the new one is minted, so only the newest link
    completes set-password. If Redis is unreachable this **does** 503 (via
    `TokenStoreUnavailable`): the whole operation is the single-use jti, and
    without it the emailed link would not work (plan §W18).
    """
    target = await get_user_by_id(db, target_id)
    if target is None:
        raise ContentError("User not found", status_code=404)

    if not _may_assign(actor.role, target.role):
        raise ContentError(
            "You are not permitted to manage this account's invite.",
            status_code=403,
        )

    if target.activated_at is not None:
        raise ContentError(
            "This account has already been activated — there is no invite to "
            "resend.",
            status_code=409,
        )

    # Per-target fixed-window cap. A resend emails a fresh set-password link, so
    # an uncapped endpoint is a mail-bombing / link-spraying primitive
    # (CWE-770). Keyed on the target, 3/hour. Fails OPEN on a Redis outage
    # (check_rate_limit), same posture as login — the 503 below is the real
    # backstop when Redis is down.
    if not await check_rate_limit(
        f"resend_invite:{target.id}", limit=3, window_seconds=3600
    ):
        raise ContentError(
            "This invite has been resent too many times in the last hour. "
            "Wait a while before trying again.",
            status_code=429,
        )

    # Retire the previously issued invite link BEFORE minting a new one, so only
    # the newest set-password link ever completes (CWE-770 — no fan-out of live
    # links). take_invite_jti pops the pointer; consume_single_use kills the jti.
    # A failed send below then leaves the account with no live link, and the
    # admin simply resends again — never a link they cannot invalidate.
    prev_jti = await token_store.take_invite_jti(str(target.id))
    if prev_jti is not None:
        await token_store.consume_single_use(prev_jti)

    invite_token, invite_jti = security.create_invite_token(str(target.id))
    invite_ttl_seconds = settings.invite_token_expire_hours * 60 * 60

    await token_store.register_single_use(invite_jti, invite_ttl_seconds)
    await token_store.remember_invite_jti(
        str(target.id), invite_jti, invite_ttl_seconds
    )
    try:
        await send_invite(target.email, target.full_name, invite_token)
    except TokenStoreUnavailable:
        raise
    except Exception:
        log.warning("staff_invite_resend_failed", user_id=str(target.id))
        raise AuthError(
            "Could not send the invite email. Please try again."
        )

    log.info("staff_invite_resent", user_id=str(target.id), by=str(actor.id))
    return target, invite_token


# The staff-management list is an enumeration (names, emails, ids), so it is
# hard-scoped to staff roles for every actor — a viewer is never a row, with or
# without a filter (plan §A.6, resolved decision 5). This is deliberately NOT
# the same scope as `role_counts` below, which is a full-table aggregate: a
# count identifies nobody, a list of addresses identifies everybody.
_STAFF_ROLES: tuple[_UserRole, ...] = (
    _UserRole.EDITOR,
    _UserRole.MANAGER,
    _UserRole.ADMIN,
)


async def list_users(
    db: AsyncSession,
    limit: int = 25,
    offset: int = 0,
    role_filter: _UserRole | None = None,
) -> tuple[list[User], int]:
    """Staff accounts only, newest first. Returns (rows, total) — total is the
    staff-scoped count before paging.

    `role_filter` narrows *within* staff (editor / manager / admin). A
    `viewer` filter is rejected at the router boundary before it reaches here
    (never a viewer page), so this function never has to represent it.
    """
    from sqlalchemy import func

    conditions = [User.role.in_(_STAFF_ROLES)]
    if role_filter is not None:
        conditions.append(User.role == role_filter)

    total = (await db.execute(
        _select(func.count()).select_from(User).where(*conditions)
    )).scalar_one()
    rows = (await db.execute(
        _select(User)
        .where(*conditions)
        .order_by(User.created_at.desc())
        .limit(max(1, min(limit, 100)))
        .offset(max(0, offset))
    )).scalars().all()
    return list(rows), total


async def role_counts(db: AsyncSession) -> dict[str, int]:
    """Full-table `SELECT role, COUNT(*) FROM users GROUP BY role`, returned as
    a `{role_value: count}` map with **every** role bucket present and
    zero-filled — `viewer` included (plan §A.6).

    This is an aggregate, not an enumeration, so unlike `list_users` it is not
    staff-scoped: "there are N viewers" identifies nobody. Do not "fix" this to
    match the list's scoping — a test asserts the `viewer` bucket is real.
    """
    from sqlalchemy import func

    rows = (await db.execute(
        _select(User.role, func.count()).select_from(User).group_by(User.role)
    )).all()
    counts = {role.value: 0 for role in _UserRole}
    for role, n in rows:
        # `role` comes back as the UserRole enum under the ORM mapping; be
        # tolerant of a raw string too.
        key = role.value if isinstance(role, _UserRole) else str(role)
        counts[key] = int(n or 0)
    return counts
