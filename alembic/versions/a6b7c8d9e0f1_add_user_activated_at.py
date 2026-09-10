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

Stamped on every path that sets a self-chosen first password — invite
acceptance (``auth_service.reset_password``), self-registration
(``register_user``), the ``create_admin`` break-glass script, and defensively on
``change_password`` — each in the same transaction as the password write, and
only when currently NULL. ``create_staff`` is the one path that leaves it NULL
(it creates the still-pending invite).

``upgrade`` also **backfills** every row that predates the column: those
accounts have been in use, so they are activated by definition. Backfilling with
``created_at`` keeps the resend-invite guard from minting a working
set-password link for a live account (security review of d3390d7).
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
    # Backfill every pre-existing row. Any account that existed before this
    # migration has been using the system, so it is activated *by definition*.
    # ``activated_at IS NULL`` is the "invite still pending" signal
    # (``resend_invite`` gates on it); leaving live accounts NULL here would let
    # a working set-password link be minted for them (security review of
    # d3390d7, CWE-620/640). Stamp with the account's own ``created_at`` — more
    # truthful than ``now()`` about the account's real age, and always present
    # (``created_at`` is NOT NULL with a server default). The safe direction: a
    # genuinely-pending pre-migration invite becoming non-resendable is
    # acceptable; a genuinely-active account staying resendable is the
    # vulnerability — so backfill ALL NULLs.
    op.execute(
        "UPDATE users SET activated_at = created_at WHERE activated_at IS NULL"
    )


def downgrade() -> None:
    op.drop_column("users", "activated_at")
