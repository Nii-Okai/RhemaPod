"""flatten categories — drop parent_id

Revision ID: b1c2d3e4f5a6
Revises: a7b8c9d0e1f2
Create Date: 2026-08-11 09:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, Sequence[str], None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Categories are now flat.

    Any existing child category becomes a top-level category — its content
    keeps its category_id, so nothing is orphaned or reassigned.
    """
    op.drop_index("ix_categories_parent_id", table_name="categories")
    op.drop_column("categories", "parent_id")


def downgrade() -> None:
    op.add_column(
        "categories",
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "categories_parent_id_fkey", "categories", "categories",
        ["parent_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_categories_parent_id", "categories", ["parent_id"])
