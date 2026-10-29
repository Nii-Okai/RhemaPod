import asyncio
import uuid
from collections.abc import Awaitable, Callable, Sequence
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security, token_store
from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.rate_limit import check_rate_limit
from app.core.token_store import TokenStoreUnavailable
from app.models.models import (
    AuditAction,
    AuditLog,
    AuditOutcome,
    AuthProvider,
    Gender,
    Playlist,
    User,
    UserIdentity,
    UserRole,
)
from app.models.schemas import AvatarTicket, UserPublic, UserRegister
from app.services import audit_service
from app.services.audit_service import AuditContext, AuditTarget
from app.services.content_service import ALLOWED_IMAGE_TYPES, ContentError

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

# Default for callers with no request (scripts, direct service tests): the
# audit row is still written, just without ip / user agent / correlation id.
_NO_CTX = AuditContext()


def _user_target(user: User) -> AuditTarget:
    return AuditTarget(type="user", id=user.id, label=user.email)


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


def _avatar_url(key: str | None) -> str | None:
    """Turn a stored avatar key into a fetchable URL — same presigned-then-
    `cdn_url_for` path `content_service._thumbnail_url` uses for a sermon/series
    cover image, not duplicated logic reinvented here, just the user-domain copy
    of it (avatars are a `User` concern, not a `content_service` one)."""
    if not key:
        return None
    from app.core import storage as storage_module

    return storage_module.stable_image_url(key)


async def linked_providers_by_user(
    db: AsyncSession, user_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[AuthProvider]]:
    """OAuth providers linked to each of `user_ids`, in one query (no N+1 for
    the members list). Users with no link are absent from the map."""
    if not user_ids:
        return {}
    rows = (await db.execute(
        select(UserIdentity.user_id, UserIdentity.provider)
        .where(UserIdentity.user_id.in_(list(user_ids)))
        .order_by(UserIdentity.provider)
    )).all()
    out: dict[uuid.UUID, list[AuthProvider]] = {}
    for uid, provider in rows:
        out.setdefault(uid, []).append(provider)
    return out


async def to_user_public_linked(db: AsyncSession, user: User) -> UserPublic:
    """`to_user_public` with the account's linked providers filled in."""
    providers = (await linked_providers_by_user(db, [user.id])).get(user.id, [])
    return to_user_public(user, providers)


def to_user_public(user: User, linked_providers: Sequence[AuthProvider] = ()) -> UserPublic:
    """Builds `UserPublic` field-by-field rather than `UserPublic.model_validate(user)`
    — `avatar_url` is derived from `avatar_key` (same reason `to_list_item` builds
    `SermonListItem` explicitly instead of blind-validating the ORM row), so a plain
    `from_attributes` validate would just silently leave it `None` forever."""
    return UserPublic(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        first_name=user.first_name,
        last_name=user.last_name,
        gender=user.gender,
        avatar_url=_avatar_url(user.avatar_key),
        role=user.role,
        is_active=user.is_active,
        has_password=bool(user.password_hash),
        linked_providers=list(linked_providers),
        activated_at=user.activated_at,
        comments_terms_accepted_at=user.comments_terms_accepted_at,
        created_at=user.created_at,
    )


async def update_gender(db: AsyncSession, actor: User, gender: Gender) -> User:
    """No moderation/rate-limit concern — unlike a name, this is never shown to
    other viewers and has no free-text injection surface (a fixed enum)."""
    actor.gender = gender
    await db.commit()
    await db.refresh(actor)
    log.info("profile_gender_updated", user_id=str(actor.id))
    return actor


def _validate_avatar_image_type(content_type: str) -> None:
    if content_type.lower() not in ALLOWED_IMAGE_TYPES:
        raise ContentError(
            f"Unsupported image type '{content_type}'. Use JPEG, PNG, or WebP.",
            status_code=400,
        )


async def create_avatar_ticket(actor: User, filename: str, content_type: str) -> AvatarTicket:
    """Issue a pre-signed PUT for a profile picture — same direct-to-storage
    pattern `content_service.create_thumbnail_ticket` uses; the image never
    passes through this API."""
    from app.core import storage as storage_module

    _validate_avatar_image_type(content_type)
    key = storage_module.avatar_key(actor.id, filename)
    url = storage_module.get_storage().presigned_upload_url(
        settings.object_store_media_bucket, key, content_type,
        settings.upload_url_expire_seconds,
    )
    return AvatarTicket(
        upload_url=url,
        headers={"Content-Type": content_type},
        expires_in=settings.upload_url_expire_seconds,
        avatar_key=key,
    )


async def confirm_avatar(db: AsyncSession, actor: User, key: str) -> str | None:
    """Attach an uploaded profile picture after verifying it actually landed —
    same verification sequence `content_service.confirm_thumbnail` runs (prefix
    check, object exists, size cap), just against the user's own row instead of
    a sermon/series."""
    from app.core import storage as storage_module

    expected_prefix = f"avatars/{actor.id}/"
    if not key.startswith(expected_prefix):
        raise ContentError("Avatar key does not belong to this account", 400)

    store = storage_module.get_storage()
    if not store.object_exists(settings.object_store_media_bucket, key):
        raise ContentError(
            "No uploaded image found — complete the PUT first", status_code=409
        )

    size = store.object_size(settings.object_store_media_bucket, key)
    if size is not None and size > settings.max_thumbnail_bytes:
        try:
            store.delete_object(settings.object_store_media_bucket, key)
        except Exception:  # noqa: BLE001 - best-effort cleanup, still reject
            log.warning("oversize_avatar_cleanup_failed", key=key)
        raise ContentError(
            f"Image is larger than the "
            f"{settings.max_thumbnail_bytes // (1024 * 1024)} MB limit.",
            status_code=413,
        )

    actor.avatar_key = key
    await db.commit()
    log.info("avatar_set", user_id=str(actor.id))
    return _avatar_url(key)


async def _create_viewer(
    db: AsyncSession,
    email: str,
    password_hash: str | None,
    *,
    email_verified: bool = False,
) -> User:
    """Shared account-creation core for a fresh viewer: the user row
    (activated immediately — a brand-new account, whether self-registered or
    OAuth-created, is never a "pending invite") plus the FREE-tier
    `Subscription` row every account owns from the moment it exists.

    Flushes but does NOT commit — the PK is assigned so a caller can attach
    anything else that belongs in the same transaction (e.g. ADR 0015's
    `UserIdentity` row for an OAuth sign-in) before committing once,
    atomically. `register_user` below and `oauth_service.sign_in_with_identity`
    are the two callers; neither duplicates the subscription-creation logic.

    `email_verified` is True only for OAuth (the provider verified the
    address); a self-registered account waits for its emailed code.
    """
    now = datetime.now(timezone.utc)
    user = User(
        email=email,
        password_hash=password_hash,
        role=UserRole.VIEWER,
        # `activated_at` must be non-NULL here or `resend_invite` (which reads
        # NULL as "invite still pending") would mint a working set-password
        # link for a live account (CWE-620/640).
        activated_at=now,
        email_verified_at=now if email_verified else None,
    )
    db.add(user)
    await db.flush()

    # Every user owns exactly one subscription row from the moment they exist,
    # so entitlement checks never have to cope with a missing record.
    from app.models.models import Subscription, SubscriptionTier

    db.add(Subscription(user_id=user.id, tier=SubscriptionTier.FREE))
    return user


async def register_user(db: AsyncSession, data: UserRegister) -> User:
    existing = await get_user_by_email(db, data.email)
    if existing is not None:
        # Do not reveal whether the email exists — generic message.
        raise AuthError("Could not complete registration")

    # Self-registration chooses its own password at creation.
    user = await _create_viewer(
        db, data.email.lower(), security.hash_password(data.password)
    )

    await db.commit()
    await db.refresh(user)
    log.info("user_registered", user_id=str(user.id))
    return user


def _email_code_digest(user_id: uuid.UUID, code: str) -> str:
    """Keyed digest of a verification code, bound to its account: Redis never
    holds a usable code, and a digest can't be replayed against another user."""
    import hashlib
    import hmac

    msg = f"{user_id}:{code}".encode()
    return hmac.new(settings.secret_key.encode(), msg, hashlib.sha256).hexdigest()


def needs_email_verification(user: User) -> bool:
    """Whether `/auth/login` must refuse this (already authenticated) account
    until it enters its emailed code. Viewers only: staff prove their address
    by completing the invite link."""
    return (
        settings.require_email_verification
        and user.role == UserRole.VIEWER
        and user.email_verified_at is None
    )


async def issue_email_verification_code(user_id: uuid.UUID) -> str:
    """Mint and record a fresh 6-digit code for the account, replacing any earlier
    one. Returns the code for the caller to email. Fails closed
    (`TokenStoreUnavailable`) — a code we could not record would be useless."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    await token_store.store_email_code(
        str(user_id),
        _email_code_digest(user_id, code),
        settings.email_verification_expire_minutes * 60,
    )
    return code


async def verify_email(db: AsyncSession, email: str, code: str) -> User:
    """Confirm a self-registered account's address with its emailed code.

    One generic error for every failure (unknown email, already verified,
    wrong/expired/burned code, deactivated) so this is not an enumeration
    oracle."""
    generic = AuthError("Invalid or expired code")
    user = await get_user_by_email(db, email)
    if user is None or not user.is_active or user.email_verified_at is not None:
        raise generic
    ok = await token_store.consume_email_code(
        str(user.id),
        _email_code_digest(user.id, code.strip()),
        settings.email_verification_max_attempts,
    )
    if not ok:
        raise generic
    user.email_verified_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)
    log.info("email_verified", user_id=str(user.id))
    return user


async def authenticate(db: AsyncSession, email: str, password: str) -> User:
    user = await get_user_by_email(db, email)
    # verify_password runs a dummy verify when user is None, so an unknown
    # email costs the same time as a wrong password (no enumeration oracle).
    # It must run unconditionally: `user is None or not verify_password(...)`
    # short-circuits past the dummy verify, and unknown emails then answered
    # ~10x faster than known ones (measured while building S8).
    stored = user.password_hash if user is not None else None
    password_ok = security.verify_password(password, stored)
    if user is None or not password_ok:
        raise AuthError("Invalid email or password")
    if not user.is_active:
        raise AuthError("Invalid email or password")

    # `password_hash` is nullable since ADR 0015 (password-less OAuth
    # accounts), but `verify_password` above only returns True when `hashed`
    # was a real string (its `None` branch always returns False, never
    # matches) — reaching here proves `user.password_hash` is not None.
    assert user.password_hash is not None
    # Transparent hash upgrade if Argon2 parameters have been raised since the
    # password was set. The user notices nothing and never resets a password.
    _, new_hash = security.verify_and_rehash(password, user.password_hash)
    if new_hash is not None:
        user.password_hash = new_hash
        # Defensive: a successful authentication with an active row is proof the
        # account is live. Backfill + the first-password paths should already
        # have stamped it, but stamp here too rather than leave any NULL that
        # reached this point (same transaction, only when NULL).
        if user.activated_at is None:
            user.activated_at = datetime.now(timezone.utc)
        await db.commit()
        log.info("password_hash_upgraded", user_id=str(user.id))

    return user


async def issue_token_pair(user: User) -> tuple[str, str]:
    """Mint a brand-new session (login). `sid` identifies the session and is
    stable across rotations (D1); a fresh `jti` names this particular refresh
    token. The session is recorded in the store BEFORE the refresh JWT is
    minted with that exact jti — same claim-first ordering as rotation, so a
    token is never returned that the store doesn't already know about."""
    sid = str(uuid.uuid4())
    jti = str(uuid.uuid4())
    await token_store.create_session(str(user.id), sid, jti)
    access = security.create_access_token(str(user.id), user.role.value)
    refresh = security.create_refresh_token(str(user.id), sid, jti)
    return access, refresh


async def rotate_refresh(db: AsyncSession, refresh_token: str) -> tuple[str, str]:
    """Rotate a refresh token via the atomic claim-first path (status.md
    "W0.4 kickoff decisions", D3): the new jti is pre-generated and claimed
    in the store BEFORE it is minted into a JWT, closing the check-then-write
    race the old GET-then-SET version had (two concurrent refreshes on the
    same still-valid jti could both pass the check before either wrote)."""
    payload = security.decode_token(refresh_token, security.REFRESH)
    if payload is None:
        raise AuthError("Invalid or expired refresh token")

    user_id = payload["sub"]
    presented_jti = payload["jti"]
    sid = payload.get("sid")
    if not sid:
        # Every refresh token minted after this rework carries a `sid`. One
        # that doesn't predates it and is rejected outright, no legacy
        # fallback — Isaac, status.md "sid rollout decision": deploying this
        # logs out every session that was live before the deploy, once.
        log.info("refresh_rejected_no_sid", user_id=user_id)
        raise AuthError("Invalid or expired refresh token")

    new_jti = str(uuid.uuid4())
    outcome = await token_store.claim_and_rotate(user_id, sid, presented_jti, new_jti)

    if outcome is token_store.ClaimOutcome.NO_SESSION:
        raise AuthError("Invalid or expired refresh token")
    if outcome is token_store.ClaimOutcome.REUSE_REVOKED:
        # Load-bearing for D2: the scoped revoke this session just took
        # (claim_and_rotate already HDEL'd it) is only defensible alongside
        # this being observable. Do not drop this log line.
        log.warning("refresh_reuse_detected", user_id=user_id, sid=sid)
        raise AuthError("Invalid or expired refresh token")
    if outcome is token_store.ClaimOutcome.ROTATED_VIA_GRACE:
        log.info("refresh_rotated_via_grace", user_id=user_id, sid=sid)

    # The claim is already burned in the store at this point (ROTATED or
    # ROTATED_VIA_GRACE). The DB round-trip runs AFTER the claim, not before
    # (D3 point 4) — a claimed-but-inactive user must not get a token pair,
    # and the claim stays burned in that case: fail-closed, worst case is a
    # re-login, never a grant on an unverified claim.
    user = await get_user_by_id(db, uuid.UUID(user_id))
    if user is None or not user.is_active:
        raise AuthError("Invalid or expired refresh token")

    access = security.create_access_token(str(user.id), user.role.value)
    refresh = security.create_refresh_token(str(user.id), sid, new_jti)
    return access, refresh


async def logout(user_id: str, refresh_token: str) -> None:
    """Per-device logout (plan §A.3 #4): revoke only the session the
    presented refresh token identifies, not every device the user has.
    Global revoke stays reserved for reset_password / change_password /
    change_role / set_active, unchanged by this rework.

    If the refresh token is missing, expired, malformed, or was minted for a
    different user than the authenticated caller, there is no session this
    can safely identify — it no-ops rather than falling back to a global
    revoke, which would reintroduce the exact cross-device eviction bug this
    rework removes (a logout from any one device killing every other)."""
    payload = security.decode_token(refresh_token, security.REFRESH)
    sid = payload.get("sid") if payload is not None else None
    if payload is None or not sid or payload.get("sub") != user_id:
        log.info("logout_no_session_identified", user_id=user_id)
        return
    await token_store.revoke_session(user_id, sid)
    log.info("logout", user_id=user_id, sid=sid)


async def reset_password(
    db: AsyncSession, token: str, new_password: str, ctx: AuditContext = _NO_CTX
) -> None:
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
    # Following the emailed link proves the address, so a viewer still waiting
    # on their sign-up code can recover through Forgot Password too.
    if user.email_verified_at is None:
        user.email_verified_at = datetime.now(timezone.utc)
    # The account holder is the actor: whoever held the emailed link set this
    # password. `token_type` tells a forgot-password reset from an invite's
    # first set-password.
    await audit_service.record(
        db, AuditAction.PASSWORD_RESET,
        actor=user, target=None, details={"token_type": payload.get("type")},
        outcome=AuditOutcome.SUCCESS, ctx=ctx,
    )
    await db.commit()
    # Force re-login everywhere after a password change.
    await token_store.revoke_refresh(str(user.id))
    log.info("password_reset", user_id=str(user.id), token_type=payload.get("type"))


async def change_password(
    db: AsyncSession,
    user_id: uuid.UUID,
    current_password: str,
    new_password: str,
    ctx: AuditContext = _NO_CTX,
) -> None:
    """Change an authenticated user's password. Requires the current password —
    an access token alone is not enough."""
    user = await get_user_by_id(db, user_id)
    if user is None:
        raise AuthError("User not found")

    # A password-less (OAuth-only) account has nothing for "current password"
    # to match against — `verify_password(_, None)` would just run its dummy
    # verify and always say "incorrect", which is accurate but misleading for
    # this account shape. Distinct message, same 400 the router already maps
    # every AuthError from this function to.
    if user.password_hash is None:
        raise AuthError(
            "No password is set on this account. Use Forgot Password to set one."
        )

    if not security.verify_password(current_password, user.password_hash):
        log.warning("password_change_denied", user_id=str(user.id))
        raise AuthError("Current password is incorrect")

    user.password_hash = security.hash_password(new_password)
    # Defensive: anyone changing their password demonstrably has a live account,
    # so it cannot still be a "pending invite". Stamp `activated_at` when NULL,
    # in the same transaction as the password write (mirrors reset_password), so
    # `resend_invite` can never mint a working set-password link for this account
    # (CWE-620/640).
    if user.activated_at is None:
        user.activated_at = datetime.now(timezone.utc)
    # Revoke every session BEFORE the write commits (as reset_password sequences
    # consume-before-write). If Redis is unreachable revoke_refresh raises
    # TokenStoreUnavailable -> 503 and the pending hash change rolls back with
    # the session — rather than persisting a new password whose old sessions
    # were never cut while telling the caller "unavailable, retry".
    # Audit flush first, so a failed insert aborts before any session is cut.
    await audit_service.record(
        db, AuditAction.PASSWORD_CHANGED,
        actor=user, target=None, details=None,
        outcome=AuditOutcome.SUCCESS, ctx=ctx,
    )
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
    ctx: AuditContext = _NO_CTX,
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

    # Same transaction as the account: if the audit insert fails, nothing is
    # created and no invite is minted or sent.
    await audit_service.record(
        db, AuditAction.STAFF_INVITED,
        actor=actor, target=_user_target(user), details={"role": role.value},
        outcome=AuditOutcome.SUCCESS, ctx=ctx,
    )

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
    db: AsyncSession,
    target_id: uuid.UUID,
    new_role: _UserRole,
    actor: User,
    ctx: AuditContext = _NO_CTX,
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
    await audit_service.record(
        db, AuditAction.ROLE_CHANGED,
        actor=actor, target=_user_target(target),
        details={"from": old_role.value, "to": new_role.value},
        outcome=AuditOutcome.SUCCESS, ctx=ctx,
    )
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
    db: AsyncSession,
    target_id: uuid.UUID,
    is_active: bool,
    actor: User,
    ctx: AuditContext = _NO_CTX,
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

    # Mirror the role matrix: managers reach editors only; admins reach any
    # staff account, and also mobile (viewer) accounts — only for switching
    # them off and on, never for assigning the viewer role.
    admin_on_viewer = (
        actor.role == _UserRole.ADMIN and target.role == _UserRole.VIEWER
    )
    if not (admin_on_viewer or _may_assign(actor.role, target.role)):
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
        # `revocation_deferred` is only known after this commit, so it goes to
        # structlog below, not into the row (§A.3).
        await audit_service.record(
            db, AuditAction.DEACTIVATED,
            actor=actor, target=_user_target(target), details=None,
            outcome=AuditOutcome.SUCCESS, ctx=ctx,
        )
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
    await audit_service.record(
        db, AuditAction.REACTIVATED,
        actor=actor, target=_user_target(target), details=None,
        outcome=AuditOutcome.SUCCESS, ctx=ctx,
    )
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


# Human labels for the tables whose `users` FK is RESTRICT — the history a
# delete would have to erase or falsify, so it refuses instead.
_HISTORY_LABELS = {
    "sermons": "sermons",
    "series": "series",
    "approval_log": "sermon review steps",
    "upload_jobs": "media uploads",
    "announcements": "announcements",
    "announcement_approval_log": "announcement review steps",
}


async def _authored_history(db: AsyncSession, user_id: uuid.UUID) -> dict[str, int]:
    """Rows in RESTRICT-FK tables that point at `user_id`, by table. Read off
    the metadata so a new RESTRICT reference is covered without a code
    change here."""
    from sqlalchemy import func

    from app.db.database import Base

    users = User.__table__
    counts: dict[str, int] = {}
    for table in Base.metadata.sorted_tables:
        for fk in table.foreign_keys:
            if fk.column.table is not users:
                continue
            if (fk.ondelete or "RESTRICT").upper() not in ("RESTRICT", "NO ACTION"):
                continue
            n = (await db.execute(
                select(func.count()).select_from(table).where(fk.parent == user_id)
            )).scalar_one()
            if n:
                counts[table.name] = counts.get(table.name, 0) + n
    return counts


async def delete_user(
    db: AsyncSession,
    target_id: uuid.UUID,
    actor: User,
    ctx: AuditContext = _NO_CTX,
) -> bool:
    """Permanently remove a staff or mobile (viewer) account. Returns
    `revocation_deferred`.

    Admin only, and deliberately narrower than deactivation:

    * never your own account;
    * the account must already be deactivated, so removing someone is always
      two steps and the lockout (reversible) comes first;
    * refused (409) while the account authored sermons, series, announcements
      or uploads, or took part in a review: those rows reference the user with
      ON DELETE RESTRICT, and erasing or reassigning them would rewrite who
      did what. Such accounts stay deactivated instead.

    What does go with the row (ON DELETE CASCADE / SET NULL) is the account's
    own listener data: sign-in identities, subscription, playlists, likes,
    comments. The audit row keeps the email as its target label for staff;
    for a viewer it is pseudonymized (see `_erase_user`).
    """
    if actor.role != _UserRole.ADMIN:
        raise ContentError("Only an admin can remove an account.", status_code=403)
    target = await get_user_by_id(db, target_id)
    if target is None:
        raise ContentError("User not found", status_code=404)
    if target.id == actor.id:
        raise ContentError("You can't remove your own account.", status_code=403)
    if target.is_active:
        raise ContentError(
            "Deactivate this account before removing it.", status_code=409
        )

    history = await _authored_history(db, target.id)
    if history:
        parts = ", ".join(
            f"{_HISTORY_LABELS.get(name, name)} ({n})" for name, n in sorted(history.items())
        )
        raise ContentError(
            f"This account can't be removed because it is linked to {parts}. "
            "Keep it deactivated instead — it can't sign in.",
            status_code=409,
        )

    return await _erase_user(db, target, actor, ctx, {})


async def _erase_user(
    db: AsyncSession,
    target: User,
    actor: User,
    ctx: AuditContext,
    details: dict,
) -> bool:
    """The one erasure path, shared by admin `delete_user` and self-service
    deletion (§A.3 steps 6, 8-10 of plans/plan-account-deletion-backend.md).
    Callers own authz and preconditions (deactivated-first, RESTRICT precheck,
    re-auth, Apple revocation); this owns the data.

    1. Snapshots the email, avatar key and every playlist cover key.
    2. One transaction: for a *viewer* target, NULLs the email-bearing audit
       columns on rows that name the user (`actor_email`, `target_label`),
       writes the `USER_DELETED` row with no email for the user, deletes the
       row (FK cascades run here) and commits. Staff targets keep today's
       snapshot label (ADR 0018 accountability).
    3. Best-effort after commit, never raising: refresh-token revocation and
       object deletes (`orphaned_object` is logged, with the key and never
       the email, when one fails).

    `details` is merged over `{"role": ...}` into the audit row. When
    `actor` is the target, the row's `actor_email` is NULL too. Returns
    `revocation_deferred` (the token store was unreachable).
    """
    user_id = target.id
    email, role = target.email, target.role.value
    is_viewer = target.role == _UserRole.VIEWER
    object_keys = await _owned_object_keys(db, target)

    if is_viewer:
        await db.execute(
            update(AuditLog).where(AuditLog.actor_id == user_id).values(actor_email=None)
        )
        await db.execute(
            update(AuditLog)
            .where(AuditLog.target_id == user_id, AuditLog.target_type == "user")
            .values(target_label=None)
        )
    row = await audit_service.record(
        db, AuditAction.USER_DELETED,
        actor=actor,
        target=AuditTarget(
            type="user", id=user_id, label=None if is_viewer else email
        ),
        details={"role": role, **details},
        outcome=AuditOutcome.SUCCESS, ctx=ctx,
    )
    if is_viewer and actor.id == user_id:
        row.actor_email = None
    await db.delete(target)
    await db.commit()

    revocation_deferred = False
    try:
        await token_store.revoke_refresh(str(user_id))
    except TokenStoreUnavailable:
        # The row is gone, so no token can authenticate anyway.
        revocation_deferred = True

    from app.core import storage as storage_module

    store = storage_module.get_storage()
    for key in object_keys:
        try:
            await asyncio.to_thread(
                store.delete_object, settings.object_store_media_bucket, key
            )
        except Exception:  # noqa: BLE001 - best-effort; the account is already gone
            log.warning("orphaned_object", key=key, user_id=str(user_id))

    log.info("user_deleted", user_id=str(user_id), by=str(actor.id))
    return revocation_deferred


async def _owned_object_keys(db: AsyncSession, user: User) -> list[str]:
    """Storage keys the account owns: its avatar and every playlist cover,
    de-duplicated, NULLs dropped. Read before the delete cascades them away."""
    covers = (await db.execute(
        select(Playlist.cover_key).where(
            Playlist.user_id == user.id, Playlist.cover_key.is_not(None)
        )
    )).scalars().all()
    keys = [user.avatar_key, *covers]
    return list(dict.fromkeys(k for k in keys if k))


async def resend_invite(
    db: AsyncSession,
    target_id: uuid.UUID,
    actor: User,
    send_invite: Callable[[str, str | None, str], Awaitable[None]],
    ctx: AuditContext = _NO_CTX,
) -> tuple[User, str]:
    """Re-issue the invite for a staff account that has not finished
    set-password: a fresh single-use jti and a fresh invite email.

    Authz matrix is `set_active`'s. If the account has already set its own
    password (`users.activated_at is not None`) there is nothing to resend → 409.
    Capped at 3/hour per target (fixed window, fails open). Each resend retires
    the previously *pointed* invite link before minting the new one; combined
    with the rate limit this bounds live set-password links to **at most `limit`
    per rate-limit window** — not strictly one. Two concurrent resends can each
    register a live jti (only one wins the pointer GETDEL), and a
    `TokenStoreUnavailable` while consuming the prior jti leaves it live for its
    TTL with the pointer already gone. If Redis is unreachable this **does** 503
    (via `TokenStoreUnavailable`): the whole operation is the single-use jti, and
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

    # Flushed before any Redis or email work and committed only after the send
    # succeeds: a failed audit insert retires and mints nothing, and a failed
    # send leaves no row claiming a resend happened.
    await audit_service.record(
        db, AuditAction.INVITE_RESENT,
        actor=actor, target=_user_target(target), details=None,
        outcome=AuditOutcome.SUCCESS, ctx=ctx,
    )

    # Retire the previously *pointed* invite link BEFORE minting a new one, so
    # the fan-out of live links stays bounded (CWE-770). take_invite_jti pops the
    # pointer; consume_single_use kills the jti. This does NOT guarantee "exactly
    # one live link" (see the docstring) — it guarantees no *unbounded* fan-out.
    prev_jti = await token_store.take_invite_jti(str(target.id))
    if prev_jti is not None:
        await token_store.consume_single_use(prev_jti)

    invite_token, invite_jti = security.create_invite_token(str(target.id))
    invite_ttl_seconds = settings.invite_token_expire_hours * 60 * 60

    try:
        # register_single_use + remember_invite_jti share one try: if either
        # raises TokenStoreUnavailable the caller gets a clean 503 and we
        # best-effort consume the jti we just registered, so a 503 never leaves a
        # live-but-un-pointed set-password link (consistent with create_staff and
        # ADR 0005 §4 — "Redis down -> 503, nothing minted"). A failed *send*
        # (generic Exception) keeps the new link, which is pointed, so the next
        # resend can still retire it; the admin simply resends.
        await token_store.register_single_use(invite_jti, invite_ttl_seconds)
        await token_store.remember_invite_jti(
            str(target.id), invite_jti, invite_ttl_seconds
        )
        await send_invite(target.email, target.full_name, invite_token)
    except TokenStoreUnavailable:
        try:
            await token_store.consume_single_use(invite_jti)
        except TokenStoreUnavailable:
            pass
        raise
    except Exception:
        log.warning("staff_invite_resend_failed", user_id=str(target.id))
        raise AuthError(
            "Could not send the invite email. Please try again."
        )

    await db.commit()
    await db.refresh(target)
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


MEMBER_STATUSES = ("all", "active", "deactivated")


async def list_members(
    db: AsyncSession,
    *,
    limit: int = 25,
    offset: int = 0,
    search: str | None = None,
    status: str = "all",
) -> tuple[list[User], int]:
    """Mobile app accounts (role `viewer`), newest first, for the admin-only
    Mobile users screen. `search` matches email or name (case-insensitive);
    `status` narrows to active or deactivated accounts."""
    from sqlalchemy import func, or_

    conditions = [User.role == _UserRole.VIEWER]
    if status == "active":
        conditions.append(User.is_active.is_(True))
    elif status == "deactivated":
        conditions.append(User.is_active.is_(False))
    if search:
        # Escape LIKE wildcards so a search for "50%" means the literal text.
        needle = (
            search.strip().lower()
            .replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        pattern = f"%{needle}%"
        conditions.append(or_(
            func.lower(User.email).like(pattern, escape="\\"),
            func.lower(func.coalesce(User.full_name, "")).like(pattern, escape="\\"),
        ))

    total = (await db.execute(
        _select(func.count()).select_from(User).where(*conditions)
    )).scalar_one()
    rows = (await db.execute(
        _select(User)
        .where(*conditions)
        .order_by(User.created_at.desc(), User.id)
        .limit(max(1, min(limit, 100)))
        .offset(max(0, offset))
    )).scalars().all()
    return list(rows), total


async def confirm_password(actor: User, password: str | None) -> None:
    """Re-check the signed-in admin's password before an irreversible action
    (wiping the database or the audit trail). A stolen session cookie alone
    is then not enough. Capped at 5 attempts per 15 minutes per account.
    Refusals are 403, never 401, so the portal doesn't treat them as an
    expired session."""
    if not await check_rate_limit(
        f"reauth:{actor.id}", limit=5, window_seconds=15 * 60
    ):
        raise ContentError(
            "Too many password attempts. Wait 15 minutes and try again.",
            status_code=429,
        )
    if not actor.password_hash:
        raise ContentError(
            "Your account has no password to confirm with. Set one from "
            "Settings › Profile first.",
            status_code=403,
        )
    if not password or not security.verify_password(password, actor.password_hash):
        raise ContentError("That password isn't right.", status_code=403)


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
