"""Bootstrap the first admin account.

There is no admin to authorise the first admin, so this is done from the CLI,
directly against the database. After this, that admin creates all other staff
through the API.

    uv run python -m scripts.create_admin --email you@example.com

You'll be prompted for a password (hidden). Pass --password to skip the prompt
in automated setups (less safe — it can land in shell history).
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import sys

from app.core.security import hash_password
from app.db.database import PrimarySession
from app.models.models import User, UserRole
from app.models.schemas import _validate_password_strength
from app.services.auth_service import get_user_by_email


async def _create(email: str, password: str, full_name: str | None) -> None:
    email = email.lower().strip()
    async with PrimarySession() as db:
        existing = await get_user_by_email(db, email)
        if existing is not None:
            if existing.role == UserRole.ADMIN:
                print(f"[=] {email} is already an admin. Nothing to do.")
                return
            existing.role = UserRole.ADMIN
            existing.is_active = True
            await db.commit()
            print(f"[+] Promoted existing user {email} to admin.")
            return

        user = User(
            email=email,
            full_name=full_name,
            password_hash=hash_password(password),
            role=UserRole.ADMIN,
        )
        db.add(user)
        await db.commit()
        print(f"[+] Created admin {email}.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or promote the first admin.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", help="Skip the interactive prompt (less safe).")
    parser.add_argument("--full-name", default=None)
    args = parser.parse_args()

    password = args.password or getpass.getpass("Password (min 12 chars): ")
    try:
        _validate_password_strength(password)
    except ValueError as exc:
        print(f"[!] {exc}", file=sys.stderr)
        sys.exit(1)

    asyncio.run(_create(args.email, password, args.full_name))


if __name__ == "__main__":
    main()
