"""add sermon_notes

Revision ID: 3a78d016e403
Revises: b3c4d5e6f7a8
Create Date: 2026-09-22 09:30:00.000000

Additive: one new table, `sermon_notes`, for a member's private timestamped
notes on a sermon (plan §A.5). Two foreign keys (`user_id`, `sermon_id`, both
`CASCADE` — a note has no life independent of the account or the sermon it's
about), no unique constraint pairing them (unlike `playback_sessions`, a
listener can take many notes on one sermon). Two composite indexes back the
two list reads: `(user_id, sermon_id, position_seconds)` for
`GET /sermons/{id}/notes`, `(user_id, created_at)` for `GET /me/notes`.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "3a78d016e403"
down_revision: Union[str, Sequence[str], None] = "b3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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


def downgrade() -> None:
    op.drop_index("ix_sermon_notes_user_created", table_name="sermon_notes")
    op.drop_index(
        "ix_sermon_notes_user_sermon_position", table_name="sermon_notes"
    )
    op.drop_index(op.f("ix_sermon_notes_sermon_id"), table_name="sermon_notes")
    op.drop_index(op.f("ix_sermon_notes_user_id"), table_name="sermon_notes")
    op.drop_table("sermon_notes")
