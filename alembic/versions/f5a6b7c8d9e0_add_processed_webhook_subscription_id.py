"""add subscription_id to processed_webhooks

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
Create Date: 2026-09-10 00:00:00.000000

Additive: one nullable ``UUID`` column, no foreign key, no index. It records
which ``Subscription`` a provider event resolved to (NULL when it resolved to
none), turning the append-only dedup ledger into queryable "became paid /
lapsed" history for Phase 3. Nothing reads it in Phase 2.

GATE 5 chose a bare nullable UUID over an FK: nothing in the codebase deletes a
``Subscription`` (cancellation is a status transition; departed staff are
``is_active=false``), so the ``ON DELETE SET NULL`` branch an FK would add is
dead code, and the FK's remaining value — write-time referential integrity plus
an index — is not worth it for a column no hot path touches.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f5a6b7c8d9e0"
down_revision: Union[str, Sequence[str], None] = "e4f5a6b7c8d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "processed_webhooks",
        sa.Column("subscription_id", postgresql.UUID(as_uuid=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("processed_webhooks", "subscription_id")
