"""add sermon_play_daily and listener_day usage rollup tables

Revision ID: dbdcee764ca3
Revises: c9b3e7a1f2d4
Create Date: 2026-10-17 15:59:27.709093

Phase 1 of the admin-settings plan (`plans/plan-admin-settings.md` §A.4.1):
per-day usage rollups so `/admin/analytics/report` can answer period
questions without scanning `playback_sessions` row-by-row. Purely additive.
Forward-only by design: `PlaybackSession` keeps one cumulative row per
(user, sermon) with no history to rebuild a per-day series from, so no
backfill is attempted (§A.2 — "data available from" is the earliest `day`
that actually exists). Writing deltas into these tables from
`record_progress` is a separate step (S4), gated at `[HUMAN_GATE AS1]`
before it's authorised; this migration only creates the tables.

1. `sermon_play_daily` — one row per (day, sermon): `plays`, `completions`,
   `watched_seconds`. `sermon_id` is `ON DELETE CASCADE`, matching
   `PlaybackSession.sermon_id` (`models.py` L718-723): a hard-deleted sermon
   takes its past counts with it. Composite primary key `(day, sermon_id)`,
   the natural upsert key — not a surrogate `id` plus a unique constraint,
   because the whole point of this table is "increment the row for this
   (day, sermon)", never a lookup by a synthetic id.

2. `listener_day` — one row per (day, user) that user was active on, so
   reports can count distinct listeners per period from
   `COUNT(DISTINCT user_id)` over this table instead of summing per-bucket
   counts. `user_id` is `ON DELETE CASCADE`, matching
   `PlaybackSession.user_id` (`models.py` L712-717). Composite primary key
   `(day, user_id)`, plus a separate index on `user_id` alone so a cascading
   user delete doesn't have to scan the whole table to find its rows (the
   PK's leading column is `day`, which wouldn't help that lookup).

Nothing here is run against the live database by this change — `alembic
upgrade head` stays its own deploy step, same pattern as `c9b3e7a1f2d4`.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "dbdcee764ca3"
down_revision: Union[str, Sequence[str], None] = "c9b3e7a1f2d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sermon_play_daily",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("sermon_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("plays", sa.Integer(), server_default="0", nullable=False),
        sa.Column("completions", sa.Integer(), server_default="0", nullable=False),
        sa.Column("watched_seconds", sa.BigInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["sermon_id"], ["sermons.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("day", "sermon_id"),
    )

    op.create_table(
        "listener_day",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("day", "user_id"),
    )
    op.create_index(
        op.f("ix_listener_day_user_id"), "listener_day", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_listener_day_user_id"), table_name="listener_day")
    op.drop_table("listener_day")
    op.drop_table("sermon_play_daily")
