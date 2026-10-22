"""add email_verified_at to users

Revision ID: b7e2c4d9a1f3
Revises: e5a68425e539
Create Date: 2026-10-22 18:30:00.000000

Additive: one nullable, timezone-aware timestamp column. NULL means a
self-registered (email/password) viewer has not yet entered the 6-digit code
emailed at sign-up, and `/auth/login` refuses it with 403 until they do. Every
other path that proves the address stamps it: the code itself
(`/auth/verify-email`), a completed reset or staff invite (the emailed link was
followed), and Google/Apple sign-in (the provider verified the email).

``upgrade`` backfills every pre-existing row with ``created_at``: those
accounts were created before verification existed and are grandfathered, so
the deploy signs nobody out.
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7e2c4d9a1f3"
down_revision: Union[str, Sequence[str], None] = "e5a68425e539"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        "UPDATE users SET email_verified_at = created_at "
        "WHERE email_verified_at IS NULL"
    )


def downgrade() -> None:
    op.drop_column("users", "email_verified_at")
