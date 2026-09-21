"""add publish_at to sermons

Revision ID: b3c4d5e6f7a8
Revises: a6b7c8d9e0f1
Create Date: 2026-09-21 12:00:00.000000

Additive: one nullable, timezone-aware timestamp column on `sermons`, mirroring
`announcements.publish_at` exactly (same type, same nullability, same lone
index). Sermon visibility is computed at read time from `status` +
`publish_at`, the same derived-visibility pattern `announcement_service.
is_visible` already uses — no background worker, no `expires_at` equivalent
(not asked for). NULL means "no schedule — visible as soon as published",
matching the announcement column's documented default.
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "b3c4d5e6f7a8"
down_revision: Union[str, Sequence[str], None] = "a6b7c8d9e0f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sermons",
        sa.Column("publish_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        op.f("ix_sermons_publish_at"), "sermons", ["publish_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_sermons_publish_at"), table_name="sermons")
    op.drop_column("sermons", "publish_at")
