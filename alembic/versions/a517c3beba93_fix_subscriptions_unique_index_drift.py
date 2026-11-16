"""fix subscriptions unique-index drift (pre-existing, unrelated to admin-settings)

Revision ID: a517c3beba93
Revises: dbdcee764ca3
Create Date: 2026-10-17 00:00:00.000000

`alembic check` reports drift on `subscriptions.user_id` and
`subscriptions.provider_subscription_id`: the model
(`Subscription.user_id` / `Subscription.provider_subscription_id`,
`app/models/models.py`) has declared both `unique=True` and `index=True`
since the very first commit that introduced `Subscription` — which SQLAlchemy
renders as a single unique index — but the migration that actually created
the table (`a7b8c9d0e1f2_add_subscriptions.py`) instead wrote each column as
a separate non-unique `op.create_index(...)` *plus* a separate unnamed
`sa.UniqueConstraint(...)` (reflected by Postgres as
`subscriptions_user_id_key` / `subscriptions_provider_subscription_id_key`).
Both constructs enforce the same uniqueness, so this was never a functional
bug — just two DB objects where the ORM has only ever asked for one. Verified
via `git log -p` that the model's `unique=True, index=True` pair predates
every Stripe-removal commit on this branch, so it is not fallout from that
work.

Purely additive/structural: drops the redundant unique constraint and the
redundant non-unique index per column, then recreates each as the single
unique index the model has always declared — same index names
(`ix_subscriptions_user_id`, `ix_subscriptions_provider_subscription_id`), so
nothing that queries by name changes. `downgrade()` restores the original
two-object shape exactly, so a rollback round-trips byte-for-byte.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "a517c3beba93"
down_revision: Union[str, Sequence[str], None] = "dbdcee764ca3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("subscriptions_user_id_key", "subscriptions", type_="unique")
    op.drop_constraint(
        "subscriptions_provider_subscription_id_key", "subscriptions", type_="unique"
    )
    op.drop_index("ix_subscriptions_user_id", table_name="subscriptions")
    op.drop_index(
        "ix_subscriptions_provider_subscription_id", table_name="subscriptions"
    )
    op.create_index(
        "ix_subscriptions_user_id", "subscriptions", ["user_id"], unique=True
    )
    op.create_index(
        "ix_subscriptions_provider_subscription_id",
        "subscriptions",
        ["provider_subscription_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_subscriptions_provider_subscription_id", table_name="subscriptions")
    op.drop_index("ix_subscriptions_user_id", table_name="subscriptions")
    op.create_index(
        "ix_subscriptions_provider_subscription_id",
        "subscriptions",
        ["provider_subscription_id"],
    )
    op.create_index("ix_subscriptions_user_id", "subscriptions", ["user_id"])
    op.create_unique_constraint(
        "subscriptions_provider_subscription_id_key",
        "subscriptions",
        ["provider_subscription_id"],
    )
    op.create_unique_constraint(
        "subscriptions_user_id_key", "subscriptions", ["user_id"]
    )
