"""add is_prophets_catalog to sermons

Revision ID: a1b2c3d4e5f6
Revises: c7d8e9f0a1b2
Create Date: 2026-09-30 00:00:00.000000

Additive: one ``NOT NULL boolean`` column on the existing, populated ``sermons``
table. A ``server_default`` of ``false`` is required here (unlike most other
boolean columns in this codebase, which were added alongside their table and
so never needed one) so every pre-existing row gets a value at migration time
instead of the ``ADD COLUMN`` failing against ``NOT NULL`` with no default.

Backs Home's new "Prophet's Catalog" shelf — a purely editorial curation flag
set per sermon via a switch on the admin editor page, not derived from any
other field.
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "c7d8e9f0a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sermons",
        sa.Column(
            "is_prophets_catalog",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("sermons", "is_prophets_catalog")
