"""add sermon comments

Revision ID: e5f6a7b8c9d0
Revises: d1e2f3a4b5c6
Create Date: 2026-10-02 18:00:00.000000

Purely additive (plan-sermon-comments §A.3, HUMAN_GATE C2): four new tables and
`users.comments_terms_accepted_at`. No likes table (Recent-only).

FK choices: comments cascade with their sermon and author (erasure erases);
`hidden_by_id` and `comment_moderation_log.actor_id` SET NULL;
`comment_moderation_log.comment_id/sermon_id/author_id` carry NO FK so the audit
trail survives hard delete. `user_blocks` has a surrogate `id` (P2) with
UNIQUE(blocker_id, blocked_id).

Downgrade is the exact inverse; any rows in the new tables are discarded.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, Sequence[str], None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _uuid(name: str, **kw) -> sa.Column:
    return sa.Column(name, postgresql.UUID(as_uuid=True), **kw)


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True),
        server_default=sa.func.now(), nullable=False,
    )


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("comments_terms_accepted_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "sermon_comments",
        _uuid("id", nullable=False),
        _uuid("sermon_id", nullable=False),
        _uuid("user_id", nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="VISIBLE", nullable=False),
        sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True),
        _uuid("hidden_by_id", nullable=True),
        sa.Column("hidden_reason", sa.Text(), nullable=True),
        sa.Column("hidden_auto", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("report_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        _created_at(),
        sa.CheckConstraint(
            "char_length(body) BETWEEN 1 AND 1000", name="ck_sermon_comments_body_len"
        ),
        sa.CheckConstraint(
            "status IN ('VISIBLE', 'HIDDEN')", name="ck_sermon_comments_status"
        ),
        sa.ForeignKeyConstraint(["sermon_id"], ["sermons.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["hidden_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_sermon_comments_sermon_status_created", "sermon_comments",
        ["sermon_id", "status", sa.text("created_at DESC"), "id"],
    )
    op.create_index(
        "ix_sermon_comments_user_created", "sermon_comments", ["user_id", "created_at"]
    )
    op.create_index(
        "ix_sermon_comments_reported", "sermon_comments", ["report_count"],
        postgresql_where=sa.text("report_count > 0"),
    )
    op.create_index(
        "ix_sermon_comments_status_created", "sermon_comments", ["status", "created_at"]
    )

    op.create_table(
        "sermon_comment_reports",
        _uuid("id", nullable=False),
        _uuid("comment_id", nullable=False),
        _uuid("reporter_id", nullable=False),
        sa.Column("reason", sa.String(length=20), nullable=False),
        sa.Column("detail", sa.String(length=500), nullable=True),
        _created_at(),
        sa.CheckConstraint(
            "reason IN ('spam', 'harassment', 'hate', 'sexual', 'self_harm', 'other')",
            name="ck_sermon_comment_reports_reason",
        ),
        sa.ForeignKeyConstraint(["comment_id"], ["sermon_comments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reporter_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("comment_id", "reporter_id", name="uq_comment_report_reporter"),
    )

    op.create_table(
        "comment_moderation_log",
        _uuid("id", nullable=False),
        _uuid("comment_id", nullable=False),
        _uuid("actor_id", nullable=True),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        _uuid("sermon_id", nullable=False),
        _uuid("author_id", nullable=False),
        sa.Column("body_snapshot", sa.Text(), nullable=True),
        sa.Column("cleared_report_count", sa.Integer(), nullable=True),
        _created_at(),
        sa.CheckConstraint(
            "action IN ('hide', 'restore', 'hard_delete', 'self_delete', 'auto_hide', 'dismiss_reports')",
            name="ck_comment_moderation_log_action",
        ),
        sa.CheckConstraint(
            "action NOT IN ('hide', 'hard_delete', 'dismiss_reports') OR reason IS NOT NULL",
            name="ck_comment_moderation_log_reason_required",
        ),
        sa.CheckConstraint(
            "(action = 'dismiss_reports' AND cleared_report_count IS NOT NULL"
            " AND cleared_report_count > 0)"
            " OR (action <> 'dismiss_reports' AND cleared_report_count IS NULL)",
            name="ck_comment_moderation_log_cleared_count",
        ),
        sa.CheckConstraint(
            "body_snapshot IS NULL OR action = 'hard_delete'",
            name="ck_comment_moderation_log_snapshot_hard_delete",
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "user_blocks",
        _uuid("id", nullable=False),
        _uuid("blocker_id", nullable=False),
        _uuid("blocked_id", nullable=False),
        _created_at(),
        sa.CheckConstraint("blocker_id <> blocked_id", name="ck_user_blocks_no_self"),
        sa.ForeignKeyConstraint(["blocker_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["blocked_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("blocker_id", "blocked_id", name="uq_user_blocks_pair"),
    )


def downgrade() -> None:
    op.drop_table("user_blocks")
    op.drop_table("comment_moderation_log")
    op.drop_table("sermon_comment_reports")
    op.drop_index("ix_sermon_comments_status_created", table_name="sermon_comments")
    op.drop_index("ix_sermon_comments_reported", table_name="sermon_comments")
    op.drop_index("ix_sermon_comments_user_created", table_name="sermon_comments")
    op.drop_index("ix_sermon_comments_sermon_status_created", table_name="sermon_comments")
    op.drop_table("sermon_comments")
    op.drop_column("users", "comments_terms_accepted_at")
