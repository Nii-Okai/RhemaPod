import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models.models import UserRole

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
    role: UserRole
    is_active: bool
    created_at: datetime


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


class StaffCreateResponse(BaseModel):
    user: UserPublic
    # Present only when the console email backend is active, so you can grab the
    # link in local/dev without a mailbox. Omitted once real email is wired.
    invite_link: str | None = None
