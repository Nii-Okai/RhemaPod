"""add bucket column to media_refs

Revision ID: f1a2b3c4d5e6
Revises: 3914bcadaf07
Create Date: 2026-08-04 18:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "3914bcadaf07"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "media_refs", sa.Column("bucket", sa.String(length=255), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("media_refs", "bucket")
