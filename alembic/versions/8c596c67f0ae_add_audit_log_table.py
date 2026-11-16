"""add audit_log table

Revision ID: 8c596c67f0ae
Revises: a517c3beba93
Create Date: 2026-10-17 18:50:12.801982

Phase 2 of the admin-settings plan (`plans/plan-admin-settings.md`
§A.4.2/S6): the system audit log that `app/services/audit_service.py`'s
`record()`/`record_detached()` write to and the future `UNION ALL` read
feed (S10, D9) reads from. Purely additive. No call site writes to this
table yet — that's S7 (staff mutations), S8 (auth), S12 (settings) and S13
(report export), each gated behind its own `[HUMAN_GATE]`.

Columns match §A.4.2 exactly:

* `id` — UUID primary key, so this table unions cleanly with the three
  existing UUID-keyed domain logs (`ApprovalLog`, `AnnouncementApprovalLog`,
  `CommentModerationLog`).
* `action`/`outcome` — stored as `VARCHAR` with a `CHECK` constraint, never
  a native Postgres enum (D8; the receipt for why is migration
  `f3a9c7d2b4e1`, a casing bug a native enum would have made far more
  painful to fix).
* `actor_id` — **no FK**, deliberately. `actor_email`/`actor_role` are a
  snapshot taken at write time, so a hard account erasure never has to
  touch (or be blocked by) this table, unlike `ApprovalLog`/
  `AnnouncementApprovalLog` (actor FK `RESTRICT`) or `CommentModerationLog`
  (actor FK `SET NULL`).
* `target_type`/`target_id`/`target_label` — a generic, FK-free reference:
  the referent's type varies per action (a user, a settings row, nothing
  at all for `auth.login`), so no single FK target would fit all of them.
* `ip`/`user_agent` — personal data (§A.2); `app/scripts/purge_audit_log.py`
  (S6) is the retention mechanism, not this migration.
* `details` — `JSONB NOT NULL DEFAULT '{}'`.

`ip` is Postgres `INET` and `details` is Postgres `JSONB` — the first two
Postgres-only column types in this codebase. Both are declared on the model
via `with_variant(..., "postgresql")` (`app/models/models.py`), so the
SQLite test suite (`tests/conftest.py` L48, `create_all` over the whole of
`Base.metadata`) still boots: SQLite gets a plain `VARCHAR(45)` for `ip`
and a plain `JSON` for `details`. This migration, run only against
PostgreSQL, uses the real `INET`/`JSONB` types directly — `alembic upgrade
head` is its own deploy step, never run by this migration against anything
but a throwaway test database from this codebase's own test harness.

Indexes, exactly as specified: `(created_at DESC, id)` for the feed's
`ORDER BY created_at DESC, id` pagination, `(actor_id, created_at)` for
"everything this actor did", and `(action, created_at)` for "everything of
this kind".
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8c596c67f0ae"
down_revision: Union[str, Sequence[str], None] = "a517c3beba93"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ACTIONS = (
    "auth.login", "auth.login_failed", "auth.logout",
    "auth.password_changed", "auth.password_reset",
    "user.staff_invited", "user.invite_resent", "user.role_changed",
    "user.deactivated", "user.reactivated",
    "settings.updated", "report.exported",
)


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("outcome", sa.String(length=10), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("actor_email", sa.String(length=320), nullable=True),
        sa.Column("actor_role", sa.String(length=20), nullable=True),
        sa.Column("target_type", sa.String(length=30), nullable=True),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("target_label", sa.String(length=200), nullable=True),
        sa.Column("ip", postgresql.INET(), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("correlation_id", sa.String(length=64), nullable=True),
        sa.Column(
            "details", postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"), nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "action IN (" + ", ".join(f"'{a}'" for a in _ACTIONS) + ")",
            name="ck_audit_log_action",
        ),
        sa.CheckConstraint(
            "outcome IN ('success', 'failure')", name="ck_audit_log_outcome",
        ),
    )
    op.create_index(
        "ix_audit_log_created_at_id", "audit_log",
        [sa.text("created_at DESC"), "id"],
    )
    op.create_index(
        "ix_audit_log_actor_id_created_at", "audit_log", ["actor_id", "created_at"],
    )
    op.create_index(
        "ix_audit_log_action_created_at", "audit_log", ["action", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_audit_log_action_created_at", table_name="audit_log")
    op.drop_index("ix_audit_log_actor_id_created_at", table_name="audit_log")
    op.drop_index("ix_audit_log_created_at_id", table_name="audit_log")
    op.drop_table("audit_log")
