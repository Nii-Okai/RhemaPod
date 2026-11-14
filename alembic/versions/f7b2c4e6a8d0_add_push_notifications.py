"""add push notifications

Revision ID: f7b2c4e6a8d0
Revises: 907867b397a3
Create Date: 2026-11-14 12:00:00.000000

Push notifications for new sermons: a `push_devices` table (one row per app
install's Expo push token) and `sermons.push_notified_at`. Every sermon that is
already published is stamped as notified, so turning this on never pushes the
back catalogue to everyone. Downgrade drops both.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "f7b2c4e6a8d0"
down_revision: str | Sequence[str] | None = "907867b397a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "push_devices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token", sa.String(length=255), nullable=False),
        sa.Column("platform", sa.String(length=10), nullable=False),
        sa.Column("new_sermons", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("token", name="uq_push_devices_token"),
    )
    op.create_index("ix_push_devices_user_id", "push_devices", ["user_id"])

    op.add_column(
        "sermons",
        sa.Column("push_notified_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Everything already out counts as announced (see module docstring).
    op.execute(
        "UPDATE sermons SET push_notified_at = now() "
        "WHERE status = 'published' OR status = 'PUBLISHED'"
    )


def downgrade() -> None:
    op.drop_column("sermons", "push_notified_at")
    op.drop_index("ix_push_devices_user_id", table_name="push_devices")
    op.drop_table("push_devices")
