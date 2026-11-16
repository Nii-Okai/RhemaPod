"""add devotionals

Revision ID: e7a1c3d5f9b2
Revises: d9c4e7a1f3b2
Create Date: 2026-11-09 23:00:00.000000

Daily devotional ("Daily Rhema", plans/plan-daily-devotional.md, gate DV1).
Additive: two new tables plus eight `church_settings` columns, every one with
a server default so the singleton row stays valid without a backfill.
Downgrade drops them; nothing else references them.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e7a1c3d5f9b2"
down_revision: str | Sequence[str] | None = "d9c4e7a1f3b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_SETTINGS_COLUMNS = (
    sa.Column(
        "devotional_reading_fallback", sa.String(length=10),
        server_default=sa.text("'text'"), nullable=False,
    ),
    sa.Column(
        "devotional_allow_override", sa.Boolean(),
        server_default=sa.text("true"), nullable=False,
    ),
    sa.Column("devotional_tts_voice", sa.String(length=60), nullable=True),
    sa.Column(
        "devotional_tts_rate_pct", sa.SmallInteger(),
        server_default=sa.text("90"), nullable=False,
    ),
    sa.Column(
        "devotional_publish_hour", sa.SmallInteger(),
        server_default=sa.text("5"), nullable=False,
    ),
    sa.Column(
        "devotional_gap_alert_days", sa.SmallInteger(),
        server_default=sa.text("14"), nullable=False,
    ),
    sa.Column(
        "devotional_still_seconds", sa.SmallInteger(),
        server_default=sa.text("60"), nullable=False,
    ),
    sa.Column(
        "devotional_default_translation", sa.String(length=20),
        server_default=sa.text("'kjv'"), nullable=False,
    ),
)

_SETTINGS_CHECKS = (
    ("ck_church_settings_devotional_fallback",
     "devotional_reading_fallback IN ('text', 'tts')"),
    ("ck_church_settings_devotional_publish_hour",
     "devotional_publish_hour BETWEEN 0 AND 23"),
    ("ck_church_settings_devotional_tts_rate",
     "devotional_tts_rate_pct BETWEEN 50 AND 150"),
)


def upgrade() -> None:
    op.create_table(
        "devotionals",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("date", sa.Date(), nullable=True),
        sa.Column(
            "is_evergreen", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "ARCHIVED",
                name="devotional_status", native_enum=False, length=20,
            ),
            nullable=False,
        ),
        sa.Column("author_speaker_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("still_breath_in", sa.String(length=80), nullable=True),
        sa.Column("still_breath_out", sa.String(length=80), nullable=True),
        sa.Column("still_seconds", sa.SmallInteger(), nullable=True),
        sa.Column("passage_ref", sa.String(length=100), nullable=False),
        sa.Column("passage_translation", sa.String(length=20), nullable=False),
        sa.Column("passage_text", sa.Text(), nullable=False),
        sa.Column("suggested_word", sa.String(length=40), nullable=True),
        sa.Column("reading_media_key", sa.String(length=512), nullable=True),
        sa.Column("reading_duration_s", sa.Integer(), nullable=True),
        sa.Column(
            "reading_fallback",
            sa.Enum(
                "TEXT", "TTS",
                name="devotional_reading_fallback", native_enum=False, length=10,
            ),
            nullable=True,
        ),
        sa.Column("reflection_md", sa.Text(), nullable=False),
        sa.Column("moment_sermon_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("moment_start_s", sa.Integer(), nullable=True),
        sa.Column("moment_end_s", sa.Integer(), nullable=True),
        sa.Column("pray_question", sa.String(length=300), nullable=False),
        sa.Column("pray_text", sa.Text(), nullable=False),
        sa.Column("carry_verse_ref", sa.String(length=100), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=True,
        ),
        sa.CheckConstraint(
            "(date IS NULL) = is_evergreen", name="ck_devotionals_evergreen_has_no_date"
        ),
        sa.CheckConstraint(
            "(moment_start_s IS NULL) = (moment_end_s IS NULL)",
            name="ck_devotionals_moment_both_or_neither",
        ),
        sa.CheckConstraint(
            "moment_start_s IS NULL OR (moment_start_s >= 0 AND moment_end_s > moment_start_s"
            " AND moment_end_s - moment_start_s <= 600)",
            name="ck_devotionals_moment_bounds",
        ),
        sa.CheckConstraint(
            "still_seconds IS NULL OR still_seconds BETWEEN 10 AND 600",
            name="ck_devotionals_still_seconds",
        ),
        sa.ForeignKeyConstraint(
            ["author_speaker_id"], ["speakers.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["moment_sermon_id"], ["sermons.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("date", name="uq_devotionals_date"),
    )
    op.create_index(op.f("ix_devotionals_status"), "devotionals", ["status"])
    op.create_index("ix_devotionals_date_status", "devotionals", ["date", "status"])

    op.create_table(
        "devotional_approval_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("devotional_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("from_status", sa.String(length=20), nullable=True),
        sa.Column("to_status", sa.String(length=20), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["devotional_id"], ["devotionals.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_devotional_approval_log_devotional_id"),
        "devotional_approval_log", ["devotional_id"],
    )

    for column in _SETTINGS_COLUMNS:
        op.add_column("church_settings", column.copy())
    for name, condition in _SETTINGS_CHECKS:
        op.create_check_constraint(name, "church_settings", condition)


def downgrade() -> None:
    for name, _ in reversed(_SETTINGS_CHECKS):
        op.drop_constraint(name, "church_settings", type_="check")
    for column in reversed(_SETTINGS_COLUMNS):
        op.drop_column("church_settings", column.name)

    op.drop_index(
        op.f("ix_devotional_approval_log_devotional_id"),
        table_name="devotional_approval_log",
    )
    op.drop_table("devotional_approval_log")
    op.drop_index("ix_devotionals_date_status", table_name="devotionals")
    op.drop_index(op.f("ix_devotionals_status"), table_name="devotionals")
    op.drop_table("devotionals")
