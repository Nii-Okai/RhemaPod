"""Create (or promote) the real staff accounts: 1 admin, 2 managers, 2 editors.

Emails are fixed below (not secret); each account's password is read from its
own environment variable so no real password is ever committed to the repo —
set them in `.env` (gitignored) or export them inline before running:

    STAFF_ADMIN_PASSWORD=... \\
    STAFF_MANAGER1_PASSWORD=... STAFF_MANAGER2_PASSWORD=... \\
    STAFF_EDITOR1_PASSWORD=... STAFF_EDITOR2_PASSWORD=... \\
    uv run python -m app.scripts.seed_staff

Safe to re-run: an account that already exists is promoted to the target role
(if needed) and left alone otherwise, same idempotent pattern as create_admin.
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone

from app.core.security import hash_password
from app.db.database import PrimarySession
from app.models.models import User, UserRole
from app.models.schemas import _validate_password_strength
from app.services.auth_service import get_user_by_email

# (email, role, password env var name)
ACCOUNTS: list[tuple[str, UserRole, str]] = [
    ("admin@rhemapod.com", UserRole.ADMIN, "STAFF_ADMIN_PASSWORD"),
    ("manager1@rhemapod.com", UserRole.MANAGER, "STAFF_MANAGER1_PASSWORD"),
    ("manager2@rhemapod.com", UserRole.MANAGER, "STAFF_MANAGER2_PASSWORD"),
    ("editor1@rhemapod.com", UserRole.EDITOR, "STAFF_EDITOR1_PASSWORD"),
    ("editor2@rhemapod.com", UserRole.EDITOR, "STAFF_EDITOR2_PASSWORD"),
]


async def _create_or_promote(email: str, role: UserRole, password: str) -> None:
    email = email.lower().strip()
    async with PrimarySession() as db:
        existing = await get_user_by_email(db, email)
        if existing is not None:
            if existing.role == role:
                print(f"[=] {email} is already {role.value}. Nothing to do.")
                return
            existing.role = role
            existing.is_active = True
            if existing.activated_at is None:
                existing.activated_at = datetime.now(timezone.utc)
            await db.commit()
            print(f"[+] Promoted existing user {email} to {role.value}.")
            return

        user = User(
            email=email,
            password_hash=hash_password(password),
            role=role,
            activated_at=datetime.now(timezone.utc),
        )
        db.add(user)
        await db.commit()
        print(f"[+] Created {role.value} {email}.")


def main() -> None:
    missing = [env_var for (_, _, env_var) in ACCOUNTS if not os.environ.get(env_var)]
    if missing:
        print(f"[!] Missing required env var(s): {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    for email, role, env_var in ACCOUNTS:
        password = os.environ[env_var]
        try:
            _validate_password_strength(password)
        except ValueError as exc:
            print(f"[!] {email} ({env_var}): {exc}", file=sys.stderr)
            sys.exit(1)

    for email, role, env_var in ACCOUNTS:
        asyncio.run(_create_or_promote(email, role, os.environ[env_var]))


if __name__ == "__main__":
    main()
