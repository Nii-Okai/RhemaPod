"""add sermon_likes and series_likes

Revision ID: 1366448aa162
Revises: 7adae5c5173d
Create Date: 2026-10-09 00:00:00.000000

Additive: two new tables, same shape as `user_blocks` (surrogate uuid id, a
unique pair constraint, CASCADE on the owning user's deletion). Each also
CASCADEs on the liked sermon/series being deleted — a like has no meaning
once its target is gone, same as a comment report CASCADEs on its comment.
`ix_*_likes_*_id` backs the like-count COUNT(*) query
(`likes_service.sermon_like_state`/`series_like_state`); the unique
constraint's own index already covers the `liked_by_me` per-viewer lookup
(it's a (user_id, *_id) composite, leading on user_id).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1366448aa162"
down_revision: Union[str, Sequence[str], None] = "7adae5c5173d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sermon_likes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sermon_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sermon_id"], ["sermons.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "sermon_id", name="uq_sermon_likes_pair"),
    )
    op.create_index("ix_sermon_likes_sermon_id", "sermon_likes", ["sermon_id"])

    op.create_table(
        "series_likes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("series_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["series_id"], ["series.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "series_id", name="uq_series_likes_pair"),
    )
    op.create_index("ix_series_likes_series_id", "series_likes", ["series_id"])


def downgrade() -> None:
    op.drop_index("ix_series_likes_series_id", table_name="series_likes")
    op.drop_table("series_likes")
    op.drop_index("ix_sermon_likes_sermon_id", table_name="sermon_likes")
    op.drop_table("sermon_likes")
