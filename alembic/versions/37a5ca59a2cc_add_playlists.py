"""add playlists and playlist_items

Revision ID: 37a5ca59a2cc
Revises: 1366448aa162
Create Date: 2026-10-10 00:00:00.000000

Additive: two new tables backing the Library tab's playlist feature. No
unique constraint on (playlist_id, sermon_id) — a playlist is allowed to
hold the same sermon twice, same as Spotify allows a duplicate track.
`ix_playlist_items_playlist_id_position` backs both the item-order read
(`playlists_service.get_playlist_detail`) and the per-playlist aggregate
count/duration query (`playlists_service._item_aggregates`).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "37a5ca59a2cc"
down_revision: Union[str, Sequence[str], None] = "1366448aa162"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "playlists",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_public", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("cover_key", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_playlists_user_id", "playlists", ["user_id"])

    op.create_table(
        "playlist_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("playlist_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sermon_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["playlist_id"], ["playlists.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sermon_id"], ["sermons.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_playlist_items_playlist_id", "playlist_items", ["playlist_id"])
    op.create_index("ix_playlist_items_sermon_id", "playlist_items", ["sermon_id"])
    op.create_index("ix_playlist_items_playlist_id_position", "playlist_items", ["playlist_id", "position"])


def downgrade() -> None:
    op.drop_index("ix_playlist_items_playlist_id_position", table_name="playlist_items")
    op.drop_index("ix_playlist_items_sermon_id", table_name="playlist_items")
    op.drop_index("ix_playlist_items_playlist_id", table_name="playlist_items")
    op.drop_table("playlist_items")
    op.drop_index("ix_playlists_user_id", table_name="playlists")
    op.drop_table("playlists")
