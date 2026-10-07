"""drop sermon_notes

Revision ID: d1e2f3a4b5c6
Revises: c7d8e9f0a1b2
Create Date: 2026-10-02 16:00:00.000000

DESTRUCTIVE (deliberately; see HUMAN_GATE C1 and ADR-0012). Drops the
`sermon_notes` table and its four indexes; the Notes feature is replaced by
sermon comments.

Schema-reversible, not data-reversible: `downgrade` recreates the empty table
and indexes exactly as `3a78d016e403_add_sermon_notes.py` defined them, but any
rows present at upgrade time are gone. Run `SELECT count(*) FROM sermon_notes;`
against every target DB first; the plan requires zero.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, Sequence[str], None] = "c7d8e9f0a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_sermon_notes_user_created", table_name="sermon_notes")
    op.drop_index(
        "ix_sermon_notes_user_sermon_position", table_name="sermon_notes"
    )
    op.drop_index(op.f("ix_sermon_notes_sermon_id"), table_name="sermon_notes")
    op.drop_index(op.f("ix_sermon_notes_user_id"), table_name="sermon_notes")
    op.drop_table("sermon_notes")


def downgrade() -> None:
    op.create_table(
        "sermon_notes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sermon_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("position_seconds", sa.Integer(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=True,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sermon_id"], ["sermons.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_sermon_notes_user_id"), "sermon_notes", ["user_id"]
    )
    op.create_index(
        op.f("ix_sermon_notes_sermon_id"), "sermon_notes", ["sermon_id"]
    )
    op.create_index(
        "ix_sermon_notes_user_sermon_position",
        "sermon_notes", ["user_id", "sermon_id", "position_seconds"],
    )
    op.create_index(
        "ix_sermon_notes_user_created", "sermon_notes", ["user_id", "created_at"]
    )
