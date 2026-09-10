"""add activated_at to users

Revision ID: a6b7c8d9e0f1
Revises: f5a6b7c8d9e0
Create Date: 2026-09-10 12:00:00.000000

Additive: one nullable, timezone-aware timestamp column, no default and no
server_default. It is the DB-authoritative answer to "has this staff account
finished its invite?" — NULL means invited-but-never-set-a-password, non-NULL is
the instant ``reset_password`` first completed for the account. ``resend_invite``
gates on it (non-NULL -> 409), replacing the earlier no-TTL ``invite_pending``
Redis key, which had a Redis-blip account-takeover window (security review of
commit a0c2575; ADR 0005 section 4).

Set inside the same transaction as the password write in
``auth_service.reset_password`` when it is currently NULL, so it can never lag
the password. A forgot-password reset on an already-activated account leaves the
existing (earlier) timestamp untouched.
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a6b7c8d9e0f1"
down_revision: Union[str, Sequence[str], None] = "f5a6b7c8d9e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "activated_at")
