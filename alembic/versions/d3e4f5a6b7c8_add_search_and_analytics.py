"""add playback_sessions and the full-text search index

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-08-12 09:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "d3e4f5a6b7c8"
down_revision: Union[str, Sequence[str], None] = "c2d3e4f5a6b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "playback_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sermon_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("position_seconds", sa.Integer(), server_default="0", nullable=False),
        sa.Column("watched_seconds", sa.Integer(), server_default="0", nullable=False),
        sa.Column("completed", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("play_count", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "first_played_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column(
            "last_played_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sermon_id"], ["sermons.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "sermon_id", name="uq_playback_user_sermon"),
    )
    op.create_index(
        op.f("ix_playback_sessions_user_id"), "playback_sessions", ["user_id"]
    )
    op.create_index(
        op.f("ix_playback_sessions_sermon_id"), "playback_sessions", ["sermon_id"]
    )
    # Continue-watching orders by this.
    op.create_index(
        "ix_playback_recent", "playback_sessions", ["user_id", "last_played_at"]
    )

    # GIN index over the weighted title+description vector. Without it, every
    # search is a sequential scan; with it, Postgres uses the index directly.
    op.execute(
        """
        CREATE INDEX ix_sermons_fts ON sermons USING GIN (
            (
                setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                setweight(to_tsvector('english', coalesce(description, '')), 'B')
            )
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_sermons_fts")
    op.drop_index("ix_playback_recent", table_name="playback_sessions")
    op.drop_index(op.f("ix_playback_sessions_sermon_id"), table_name="playback_sessions")
    op.drop_index(op.f("ix_playback_sessions_user_id"), table_name="playback_sessions")
    op.drop_table("playback_sessions")
