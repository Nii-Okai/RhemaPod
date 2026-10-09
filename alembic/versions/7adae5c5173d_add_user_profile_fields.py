"""add first_name, last_name, gender, avatar_key to users

Revision ID: 7adae5c5173d
Revises: 0543034f79af
Create Date: 2026-10-09 00:00:00.000000

Additive: four new nullable columns on the existing, populated ``users``
table — no backfill needed, no default required. ``full_name`` is untouched
and stays the single field every other consumer (comments, announcement
approval logs, staff invite emails) reads; these are the Me-page profile-edit
UI's own fields (Isaac's ask, session 2026-10-09), recomputing ``full_name``
server-side on save rather than replacing it.

``gender`` is a plain ``VARCHAR(10)``, not a native Postgres enum type — same
choice ``role``/``media_type`` already made (``native_enum=False`` at the
ORM layer); the model's ``Gender`` enum is the only place the two allowed
values are enforced, consistent with how this codebase has always added an
enum-shaped column.
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7adae5c5173d"
down_revision: Union[str, Sequence[str], None] = "0543034f79af"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("first_name", sa.String(length=100), nullable=True))
    op.add_column("users", sa.Column("last_name", sa.String(length=100), nullable=True))
    op.add_column("users", sa.Column("gender", sa.String(length=10), nullable=True))
    op.add_column("users", sa.Column("avatar_key", sa.String(length=512), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_key")
    op.drop_column("users", "gender")
    op.drop_column("users", "last_name")
    op.drop_column("users", "first_name")
