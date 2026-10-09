import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models.models import Gender, UserRole

# Obvious values rejected regardless of length. Length is the dominant factor
# in resistance to offline cracking, so we require 12 rather than imposing
# character-class rules that push people toward "Password1!" — a pattern that
# satisfies complexity checks while appearing in every breach corpus.
_COMMON_PASSWORDS = {
    "password", "123456789012", "qwertyuiop", "letmein12345",
    "administrator", "welcome12345", "changeme1234", "password1234",
}


def _validate_password_strength(v: str) -> str:
    if len(v) < 12:
        raise ValueError("Password must be at least 12 characters")
    stripped = v.lower().strip("0123456789!")
    if v.lower() in _COMMON_PASSWORDS or stripped in _COMMON_PASSWORDS:
        raise ValueError("Password is too common — choose something less predictable")
    return v


# --- Requests ---
class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    """Per-device logout (plan §A.3 #4): the presented refresh token's `sid`
    is what identifies which session to revoke. Public API contract change
    from the pre-rework `/auth/logout` (no body, revoked by user id / every
    device) — see status.md "W0.4 multi-session refresh"."""

    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=12, max_length=128)

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=12, max_length=128)

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


# --- Responses ---
class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    full_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    gender: Gender | None = None
    # Resolved from `avatar_key` at read time (`auth_service._avatar_url`), same
    # presigned/CDN path as a sermon's `thumbnail_url` — never the raw key itself.
    avatar_url: str | None = None
    role: UserRole
    is_active: bool
    # NULL while the staff invite is still outstanding; the timestamp the account
    # first set its own password otherwise. Lets the portal (resend-invite) tell a
    # pending account from an active one without a second call.
    activated_at: datetime | None = None
    # NULL until the viewer accepts the comments Terms (gates the first post).
    comments_terms_accepted_at: datetime | None = None
    created_at: datetime


class ProfileUpdate(BaseModel):
    """Self-edit of the caller's profile via `full_name` directly — unchanged,
    still used by the comments flow's own name prompt (`comments_service.
    update_full_name`). Role, email and activation are never self-editable
    (extra keys are a 422). Normalisation and the URL/blocklist checks live in
    the service."""

    model_config = ConfigDict(extra="forbid")

    full_name: str


class ProfileDetailsUpdate(BaseModel):
    """Me-page profile edit (Isaac's ask, session 2026-10-09): first/last
    name and gender, independent of `ProfileUpdate`'s single `full_name`
    field above and of avatar upload (its own ticket/confirm pair below).
    `first_name`/`last_name` must be given together or not at all — the
    service rejects one without the other (a name can't be half-updated);
    `gender` can be set on its own. Saving a name goes through the same
    content-moderation rules `full_name` always has
    (`comments_service.update_profile_name`), since it still recomputes and
    publicly displays as `full_name`."""

    model_config = ConfigDict(extra="forbid")

    first_name: str | None = None
    last_name: str | None = None
    gender: Gender | None = None


class AvatarUploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=3, max_length=120)


class AvatarTicket(BaseModel):
    """Pre-signed PUT for a profile picture — same direct-to-storage pattern
    sermon/series thumbnails already use."""

    upload_url: str
    method: str = "PUT"
    headers: dict[str, str] = Field(default_factory=dict)
    expires_in: int
    avatar_key: str


class AvatarResponse(BaseModel):
    avatar_url: str | None


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Access token lifetime in seconds")


class MessageResponse(BaseModel):
    message: str


# --- User management (managers/admins) ---
class StaffCreateRequest(BaseModel):
    """Admin-created staff account. No password here — a temporary one is set
    server-side and the user chooses their own via an emailed invite link."""

    email: EmailStr
    full_name: str | None = Field(default=None, max_length=255)
    role: UserRole = UserRole.EDITOR

    @field_validator("role")
    @classmethod
    def not_viewer(cls, v: UserRole) -> UserRole:
        # Viewers self-register; this endpoint is for staff roles.
        if v == UserRole.VIEWER:
            raise ValueError("Use self-registration for viewer accounts")
        return v


class RoleUpdateRequest(BaseModel):
    role: UserRole


class ActiveUpdateRequest(BaseModel):
    """Target active state for `PATCH /users/{id}/active` — `false` deactivates
    the staff account, `true` reactivates it."""

    is_active: bool


class UserActiveResponse(BaseModel):
    """The updated account, plus a flag set when a Redis outage forced
    refresh-token revocation to be deferred (plan §W18, GATE 6 = commit-first).
    Set on **deactivation** when the lockout committed but the token revoke could
    not be recorded, and on **reactivation** when the best-effort revoke of any
    still-live pre-deactivation refresh token could not be recorded (CWE-613).
    The state change still committed and every request re-checks `is_active`, so
    the flag only tells an operator a Redis-backed revoke did not land."""

    user: UserPublic
    revocation_deferred: bool = False


class StaffCreateResponse(BaseModel):
    user: UserPublic
    # Present only when the console email backend is active, so you can grab the
    # link in local/dev without a mailbox. Omitted once real email is wired.
    invite_link: str | None = None


class RoleCounts(BaseModel):
    """Full-table `GROUP BY role` count, for the Users & roles tiles.

    Every bucket is always present and zero-filled — `viewer` included. This is
    an aggregate, not an enumeration: it is deliberately full-table and NOT
    staff-scoped like `GET /users` (plan §A.6).
    """

    viewer: int
    editor: int
    manager: int
    admin: int
    total: int
