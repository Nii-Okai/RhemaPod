"""Resolution logic for "Sign in with Google" / "Sign in with Apple" (ADR
0015) — what a verified provider identity (`app.core.oauth.VerifiedIdentity`)
turns into: an existing user, a freshly created one, or an auto-linked one.

Staff exclusion (Isaac's explicit decision, binding): only `role == viewer`
accounts may ever use OAuth sign-in — checked on EVERY path that resolves to
an existing user, not just at link time, so a viewer later promoted to staff
loses OAuth sign-in on their very next attempt. Same symmetry applies to
`is_active`: both the "already linked" fast path and the auto-link path check
it before proceeding — a deactivated account must never reach the
password-wipe/session-revoke/identity-link side effects, exactly as
`auth_service.authenticate` blocks it before issuing any token.

Auto-link policy (Isaac's explicit decision, binding): a verified-email OAuth
sign-in that matches an existing password-based account by email auto-links
it — and, in the SAME transaction, clears that account's password and revokes
every refresh session. This closes a real pre-registration account-takeover
hole: without it, an attacker who registered the victim's email with a
password first would retain access after the victim links their real Google/
Apple account.

Create/link race (reviewer-gilfoyle finding): two concurrent sign-ins for the
same provider `sub` are realistic (a client retrying a timed-out request mints
a second, byte-distinct ID token for the same underlying identity) —
`claim_once`'s replay guard is keyed on raw token bytes, so it does not see
these as the same attempt. Both requests can pass the "no existing identity"
check and race to insert, tripping `uq_user_identities_provider_subject`,
`uq_user_identities_user_provider`, or `users.email`'s own unique constraint.
Both the create path and the auto-link path catch that `IntegrityError` and
re-resolve by (provider, subject) rather than hard-failing the loser: this is
a sign-in racing itself, not a user-initiated create, so the loser should walk
away signed in via the winner's row, not 409.
"""
from __future__ import annotations

from datetime import datetime, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import email as email_module
from app.core import token_store
from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.oauth import VerifiedIdentity
from app.models.models import AuthProvider, User, UserIdentity, UserRole
from app.services.auth_service import AuthError, _create_viewer, get_user_by_email
from app.services.content_service import ContentError

log = get_logger("oauth_service")
settings = get_settings()

# Isaac's explicit decision: a provider-supplied profile picture is synced
# as the new user's avatar ONLY at the moment of fresh account creation —
# never on auto-link (an existing password account matched by email), and
# never re-synced on any later sign-in. A user who later uploads their own
# custom avatar must never have it silently overwritten by a future Google
# sign-in. See `_sync_avatar_from_provider_picture`'s one call site below.
_AVATAR_FETCH_TIMEOUT_SECONDS = 5.0

_IMAGE_SUFFIX_BY_CONTENT_TYPE: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}

_PROVIDER_DISPLAY_NAME: dict[AuthProvider, str] = {
    AuthProvider.GOOGLE: "Google",
    AuthProvider.APPLE: "Apple",
}

# Same generic message `auth_service.authenticate` uses for an inactive/bad
# password login — an inactive account gets no more detail via OAuth than it
# would via password sign-in.
_INVALID_CREDENTIALS_MESSAGE = "Invalid email or password"
_STAFF_MUST_USE_PASSWORD_MESSAGE = "Staff accounts must sign in with email and password"
_RACE_LOST_MESSAGE = "Could not complete sign-in — please try again"


class OAuthError(AuthError):
    """An OAuth sign-in was rejected for a reason the caller can act on
    (staff account, unverified email, conflicting link). Carries a
    `status_code`, same shape as `ContentError` — unlike plain `AuthError`,
    which every other auth endpoint maps to one fixed status per route, this
    path needs 401/403/409 depending on which rule fired."""

    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.status_code = status_code


async def _prefill_name(db: AsyncSession, user: User, identity: VerifiedIdentity) -> None:
    """Best-effort prefill of a brand-new account's name from the provider's
    claims. Goes through the same per-field moderation
    `comments_service.update_profile_name` already applies to a user-entered
    name (URL/contact/blocklist/reserved-title, 1-100 chars) — a malicious or
    malformed provider-supplied name can't smuggle anything past this any
    more than a user typing it in themselves could. A moderation failure
    silently drops the name fields (left NULL) rather than failing the whole
    sign-in — this is a UX nicety, not a reason to block authentication.

    Imports `comments_service` lazily to avoid a import-time cycle:
    `comments_service` imports `content_service`, which several `auth_service`
    call sites already import lazily for the same reason.
    """
    if not identity.given_name or not identity.family_name:
        return

    from app.services.comments_service import validate_full_name

    try:
        first_name = validate_full_name(identity.given_name)
        last_name = validate_full_name(identity.family_name)
    except ContentError:
        log.info(
            "oauth_name_prefill_rejected",
            provider=identity.provider.value,
            user_id=str(user.id),
        )
        return

    user.first_name = first_name
    user.last_name = last_name
    user.full_name = f"{first_name} {last_name}"


async def _sync_avatar_from_provider_picture(
    db: AsyncSession, user: User, picture_url: str
) -> None:
    """Best-effort sync of a brand-new account's avatar from the identity's
    `picture` claim (currently only Google populates it — Apple's identity
    token has none — but this function itself makes no provider assumption,
    so a future provider that adds one would just work). Entirely
    server-side: fetches the bytes directly, no client ticket/PUT/confirm
    round trip like `auth_service.create_avatar_ticket`/`confirm_avatar`.

    Deliberately NEVER raises and never fails/rolls back the sign-up, which
    has already committed by the time this runs — any failure (network, bad
    content-type, oversize, storage write) is logged and swallowed, same
    "best-effort, never blocks the real operation" posture as
    `sign_in_with_identity`'s `send_sign_in_method_linked` call below.

    The response is streamed with a running byte count rather than trusting
    `Content-Length` — a lying/attacker-controlled server could otherwise
    report a small size and send more.
    """
    from app.core import storage as storage_module
    from app.services.content_service import ALLOWED_IMAGE_TYPES

    try:
        max_bytes = settings.max_thumbnail_bytes
        async with httpx.AsyncClient(timeout=_AVATAR_FETCH_TIMEOUT_SECONDS) as client:
            async with client.stream("GET", picture_url) as resp:
                resp.raise_for_status()

                content_type = (
                    resp.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                )
                if content_type not in ALLOWED_IMAGE_TYPES:
                    log.info(
                        "oauth_avatar_sync_skipped",
                        user_id=str(user.id),
                        reason="content_type",
                    )
                    return

                chunks: list[bytes] = []
                total = 0
                async for chunk in resp.aiter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        log.warning(
                            "oauth_avatar_sync_failed",
                            user_id=str(user.id),
                            reason="oversize",
                        )
                        return
                    chunks.append(chunk)
        data = b"".join(chunks)

        key = storage_module.avatar_key(
            user.id, f"avatar.{_IMAGE_SUFFIX_BY_CONTENT_TYPE[content_type]}"
        )
        storage_module.get_storage().put_object(
            settings.object_store_media_bucket, key, data, content_type
        )
        user.avatar_key = key
        await db.commit()
        log.info("oauth_avatar_synced", user_id=str(user.id))
    except Exception as exc:
        log.warning(
            "oauth_avatar_sync_failed",
            user_id=str(user.id),
            reason="exception",
            error=type(exc).__name__,
        )


async def _load_by_identity(db: AsyncSession, identity: VerifiedIdentity) -> User | None:
    """Look up an existing `(provider, subject)` link and, if found, its
    user — applying the same staff-exclusion / active-account checks the
    normal "already linked" sign-in path always has. Returns None if no link
    exists yet (not an error — the caller moves on to the create/auto-link
    paths). Used both for that normal fast path and to re-resolve after
    losing a create/link race (see the module docstring).
    """
    row = (
        await db.execute(
            select(UserIdentity).where(
                UserIdentity.provider == identity.provider,
                UserIdentity.provider_subject == identity.subject,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None

    user = await db.get(User, row.user_id)
    if user is None:
        # Orphaned identity row — should be impossible (FK CASCADE deletes
        # it with the user), but never authenticate into nothing.
        log.warning("oauth_identity_orphaned", identity_id=str(row.id))
        raise OAuthError(_INVALID_CREDENTIALS_MESSAGE, 401)

    if user.role != UserRole.VIEWER:
        raise OAuthError(_STAFF_MUST_USE_PASSWORD_MESSAGE, 403)
    if not user.is_active:
        raise OAuthError(_INVALID_CREDENTIALS_MESSAGE, 401)

    # A `sub` that resolves correctly but whose token email now differs from
    # the stored email (changed Google email, rotated Apple relay address) is
    # NOT an error — `sub` is authoritative, never touch `user.email` off the
    # back of it.
    if identity.email and identity.email.lower() != user.email:
        log.info("oauth_email_drift", provider=identity.provider.value, user_id=str(user.id))

    row.last_used_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)
    return user


async def sign_in_with_identity(
    db: AsyncSession, identity: VerifiedIdentity
) -> tuple[User, bool]:
    """Returns `(user, new_account)`. `new_account` is True only when this call
    created the account; the router records it on the `auth.login` audit row
    (`plan-admin-settings.md` §A.3)."""
    provider_name = _PROVIDER_DISPLAY_NAME[identity.provider]

    user = await _load_by_identity(db, identity)
    if user is not None:
        log.info("oauth_sign_in", provider=identity.provider.value, user_id=str(user.id))
        return user, False

    if not identity.email or not identity.email_verified:
        raise OAuthError("Email not verified by provider", 403)

    email = identity.email.lower()
    existing_user = await get_user_by_email(db, email)

    if existing_user is None:
        try:
            user = await _create_viewer(db, email, password_hash=None)
            await _prefill_name(db, user, identity)
            db.add(
                UserIdentity(
                    user_id=user.id,
                    provider=identity.provider,
                    provider_subject=identity.subject,
                    email_at_link=identity.email,
                    is_private_email=identity.is_private_email,
                    last_used_at=datetime.now(timezone.utc),
                )
            )
            await db.commit()
        except IntegrityError:
            # Someone else won the create/link race for this exact
            # provider+subject (or this exact email) between our lookups
            # above and our insert — re-resolve rather than fail a sign-in
            # that is, from the caller's perspective, legitimate.
            await db.rollback()
            resolved = await _load_by_identity(db, identity)
            if resolved is not None:
                log.info(
                    "oauth_sign_in_resolved_after_race",
                    provider=identity.provider.value,
                    user_id=str(resolved.id),
                )
                return resolved, False
            # Should not happen (see module docstring: the winner's full
            # transaction, identity row included, commits atomically before
            # the loser's commit can fail) — but never fall through silently.
            log.warning("oauth_create_race_unresolved", provider=identity.provider.value)
            raise OAuthError(_RACE_LOST_MESSAGE, 409) from None

        await db.refresh(user)
        log.info("oauth_account_created", provider=identity.provider.value, user_id=str(user.id))

        # First-creation-only avatar sync (Isaac's explicit decision — see
        # the module-level note above `_sync_avatar_from_provider_picture`).
        # Naturally a no-op for Apple, whose identity token never carries a
        # `picture` claim.
        if identity.picture:
            await _sync_avatar_from_provider_picture(db, user, identity.picture)

        return user, True

    if existing_user.role != UserRole.VIEWER:
        raise OAuthError(_STAFF_MUST_USE_PASSWORD_MESSAGE, 403)
    if not existing_user.is_active:
        # Symmetric with `_load_by_identity`'s check above: a deactivated
        # account must never reach the password-wipe / session-revoke /
        # identity-link side effects below, exactly as `authenticate` blocks
        # it before issuing any token (security-reviewer finding).
        raise OAuthError(_INVALID_CREDENTIALS_MESSAGE, 401)

    # This user already has a DIFFERENT identity row for this same provider —
    # shouldn't happen (the subject lookup above would have matched first if
    # it were the same one), but naming it explicitly rather than silently
    # overwriting a link.
    other = (
        await db.execute(
            select(UserIdentity).where(
                UserIdentity.user_id == existing_user.id,
                UserIdentity.provider == identity.provider,
            )
        )
    ).scalar_one_or_none()
    if other is not None:
        raise OAuthError(
            f"This account is already linked to a different {provider_name} account",
            409,
        )

    # Auto-link: closes the pre-registration takeover hole described in the
    # module docstring. All in one transaction with the identity-row insert.
    existing_user.password_hash = None
    await token_store.revoke_refresh(str(existing_user.id))
    try:
        db.add(
            UserIdentity(
                user_id=existing_user.id,
                provider=identity.provider,
                provider_subject=identity.subject,
                email_at_link=identity.email,
                is_private_email=identity.is_private_email,
                last_used_at=datetime.now(timezone.utc),
            )
        )
        await db.commit()
    except IntegrityError:
        await db.rollback()
        resolved = await _load_by_identity(db, identity)
        if resolved is not None:
            log.info(
                "oauth_sign_in_resolved_after_race",
                provider=identity.provider.value,
                user_id=str(resolved.id),
            )
            return resolved, False
        log.warning("oauth_link_race_unresolved", provider=identity.provider.value)
        raise OAuthError(_RACE_LOST_MESSAGE, 409) from None

    await db.refresh(existing_user)
    log.info(
        "oauth_account_auto_linked",
        provider=identity.provider.value,
        user_id=str(existing_user.id),
    )

    # Best-effort notification — must never fail the sign-in it's reporting
    # on, same swallow-and-log posture as `auth.py`'s own
    # `_dispatch_password_reset`.
    try:
        await email_module.send_sign_in_method_linked(existing_user.email, provider_name)
    except Exception as exc:
        log.warning(
            "sign_in_method_linked_email_failed",
            user_id=str(existing_user.id),
            error=type(exc).__name__,
        )

    return existing_user, False
