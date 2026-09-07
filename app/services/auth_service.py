import uuid
from collections.abc import Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security, token_store
from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.token_store import TokenStoreUnavailable
from app.models.models import User, UserRole
from app.models.schemas import UserRegister

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
        await send_invite(user.email, user.full_name, invite_token)
    except TokenStoreUnavailable:
        # Fail closed: don't create an account whose invite we couldn't record.
        await db.rollback()
        raise
    except Exception:
        await db.rollback()
        log.warning("staff_invite_send_failed", email=email)
        raise AuthError(
            "Could not send the invite email — the account was not created. "
            "Please try again."
        )

    await db.commit()
    await db.refresh(user)

    log.info("staff_created", user_id=str(user.id), role=role.value, by=str(actor.id))

    return user, invite_token


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

    old_role = target.role
    target.role = new_role
    # Revoke BEFORE commit (see change_password): a Redis outage raises
    # TokenStoreUnavailable -> 503 with the role change rolled back, never a
    # persisted new role whose still-live sessions carry the old one.
    await token_store.revoke_refresh(str(target.id))
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


async def list_users(
    db: AsyncSession, limit: int = 25, offset: int = 0
) -> tuple[list[User], int]:
    """Returns (rows, total) — total is the count before paging."""
    from sqlalchemy import func

    total = (await db.execute(_select(func.count()).select_from(User))).scalar_one()
    rows = (await db.execute(
        _select(User)
        .order_by(User.created_at.desc())
        .limit(max(1, min(limit, 100)))
        .offset(max(0, offset))
    )).scalars().all()
    return list(rows), total
