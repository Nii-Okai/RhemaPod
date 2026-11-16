"""add user_identities (ADR 0015) and make users.password_hash nullable

Revision ID: c9b3e7a1f2d4
Revises: f3a9c7d2b4e1
Create Date: 2026-10-15 00:00:00.000000

Backend support for "Sign in with Google" / "Sign in with Apple" (ADR 0015).
Purely additive:

1. A new `user_identities` table — one row per (user, OAuth provider) link.
   `(provider, provider_subject)` is the real lookup key a sign-in resolves
   against (`provider_subject` is that provider's stable `sub` claim, never
   the user's email); `(user_id, provider)` caps it to at most one Google +
   one Apple identity per user. `ON DELETE CASCADE` on `user_id`: deleting a
   user must not leave an orphaned identity row pointing nowhere.

2. Relaxes `users.password_hash` from NOT NULL to nullable. A viewer who
   signs in only via Google/Apple never sets a password — ADR 0015's
   auto-link policy also *clears* an existing account's password to NULL
   when a verified-email OAuth sign-in links to it (closes a pre-registration
   account-takeover hole: see the ADR for the full reasoning). Every write
   path that sets this column already supplies a real hash when the account
   has one (`auth_service`, `app/scripts/create_admin.py`,
   `app/scripts/seed_staff.py`, `app/scripts/seed_dev.py`) — this migration
   changes the column's nullability, not any existing row's data.

Nothing here is run against the live database by this change — see
status.md / the backend agent's report for the explicit halt after writing
this file (same pattern as `f3a9c7d2b4e1`).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c9b3e7a1f2d4"
down_revision: Union[str, Sequence[str], None] = "f3a9c7d2b4e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_identities",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("provider_subject", sa.String(length=255), nullable=False),
        sa.Column("email_at_link", sa.String(length=320), nullable=True),
        sa.Column(
            "is_private_email", sa.Boolean(), server_default=sa.false(), nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "provider", "provider_subject", name="uq_user_identities_provider_subject"
        ),
        sa.UniqueConstraint(
            "user_id", "provider", name="uq_user_identities_user_provider"
        ),
    )
    op.create_index(
        op.f("ix_user_identities_user_id"), "user_identities", ["user_id"]
    )

    op.alter_column(
        "users", "password_hash",
        existing_type=sa.String(length=255),
        nullable=True,
    )


def downgrade() -> None:
    # Restoring NOT NULL here would 500 on any row this release let go
    # password-less (an OAuth-only viewer) — a real downgrade has to backfill
    # or delete those rows first; deliberately not attempted automatically.
    op.alter_column(
        "users", "password_hash",
        existing_type=sa.String(length=255),
        nullable=False,
    )

    op.drop_index(op.f("ix_user_identities_user_id"), table_name="user_identities")
    op.drop_table("user_identities")
