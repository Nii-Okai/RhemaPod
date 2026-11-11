"""add cover_color to playlists

Revision ID: 907867b397a3
Revises: e7a1c3d5f9b2
Create Date: 2026-11-11 23:55:00.000000

Additive: one nullable ``VARCHAR(16)`` column holding the swatch name a playlist
without a cover photo picked on the app's New playlist screen (Daybreak canvas
E3). NULL keeps today's default cover, so existing rows need no backfill.
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "907867b397a3"
down_revision: Union[str, Sequence[str], None] = "e7a1c3d5f9b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("playlists", sa.Column("cover_color", sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column("playlists", "cover_color")
