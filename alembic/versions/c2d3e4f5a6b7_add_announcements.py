"""add announcements

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-08-11 12:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c2d3e4f5a6b7"
down_revision: Union[str, Sequence[str], None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UPDATED_AT_FUNCTION = """
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
"""

ANNOUNCEMENTS_UPDATED_AT_TRIGGER = """
CREATE TRIGGER trg_announcements_updated_at
    BEFORE UPDATE ON announcements
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
"""

ANNOUNCEMENTS_LOG_UPDATED_AT_TRIGGER = """
CREATE TRIGGER trg_announcements_log_updated_at
    BEFORE UPDATE ON announcement_approval_log
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
"""


def upgrade() -> None:
    op.create_table(
        "announcements",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("image_key", sa.String(length=512), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="DRAFT", nullable=False),
        sa.Column("pinned", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("publish_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=True,
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_announcements_status"), "announcements", ["status"])
    op.create_index(op.f("ix_announcements_publish_at"), "announcements", ["publish_at"])
    # The public list filters on all three every request.
    op.create_index(
        "ix_announcements_visible",
        "announcements",
        ["status", "publish_at", "expires_at"],
    )

    op.execute(UPDATED_AT_FUNCTION)
    op.execute(ANNOUNCEMENTS_UPDATED_AT_TRIGGER)


    op.create_table(
        "announcement_approval_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("announcement_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("from_status", sa.String(length=20), nullable=True),
        sa.Column("to_status", sa.String(length=20), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column(
                    "updated_at", sa.DateTime(timezone=True),
                    server_default=sa.func.now(), nullable=True,
                ),
        sa.ForeignKeyConstraint(
            ["announcement_id"], ["announcements.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_announcement_approval_log_announcement_id"),
        "announcement_approval_log", ["announcement_id"],
    )

    op.execute(UPDATED_AT_FUNCTION)
    op.execute(ANNOUNCEMENTS_LOG_UPDATED_AT_TRIGGER)


def downgrade() -> None:
    op.execute('DROP TRIGGER IF EXISTS trg_announcements_log_updated_at ON announcement_approval_log;')
    op.drop_index("ix_announcement_approval_log_announcement_id", table_name="announcement_approval_log")
    op.drop_table("announcement_approval_log")
    op.execute('DROP TRIGGER IF EXISTS trg_announcements_updated_at ON announcements;')
    op.drop_index("ix_announcements_visible", table_name="announcements")
    op.drop_index(op.f("ix_announcements_publish_at"), table_name="announcements")
    op.drop_index(op.f("ix_announcements_status"), table_name="announcements")
    op.drop_table("announcements")
    op.execute('DROP FUNCTION IF EXISTS update_updated_at();')
