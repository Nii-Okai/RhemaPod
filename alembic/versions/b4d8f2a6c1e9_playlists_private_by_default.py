"""playlists private by default; backfill existing playlists to private

Revision ID: b4d8f2a6c1e9
Revises: a7c3e9f1b2d4
Create Date: 2026-11-01 09:00:00.000000

Share-links Phase 2 (plan-share-links P.1, `[HUMAN_GATE SL4]`). Playlists are
about to become readable by non-owners when `is_public` is true, so the flag
must start meaning what it says:

* `upgrade()` sets every existing `playlists.is_public` to false (until now the
  column was read by nothing, so every row carries only the old default true,
  or a toggle that had no effect) and flips the column's server default to
  false. No column, table or index is added or dropped; the only data change
  is that one UPDATE.
* `downgrade()` restores the server default to true. **It cannot restore the
  per-row values**: the pre-upgrade true/false split is not recorded anywhere,
  so rows stay false after a downgrade. That loss was accepted at SL4 because
  the flag had no effect before this revision.

Deploy note: `alembic upgrade head` is its own deploy step; code that expects
the new default (model/DTO default false) ships with it.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b4d8f2a6c1e9"
down_revision: Union[str, Sequence[str], None] = "a7c3e9f1b2d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE playlists SET is_public = false")
    op.alter_column("playlists", "is_public", server_default=sa.text("false"))


def downgrade() -> None:
    # Per-row values are NOT restored (see module docstring).
    op.alter_column("playlists", "is_public", server_default=sa.text("true"))
