"""allow data.exported / data.imported in audit_log.action

Revision ID: c8d9e0f1a2b3
Revises: b7e2c4d9a1f3
Create Date: 2026-10-22 23:00:00.000000

The admin database export/import (Settings › Data) writes two new audit
actions. `audit_log.action` is a varchar guarded by `ck_audit_log_action`
(never a native enum — see migration `f3a9c7d2b4e1`), so widening the catalog
is a drop-and-recreate of that CHECK. ``downgrade`` deletes any rows using the
new actions first, or the narrower CHECK would refuse to be created.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8d9e0f1a2b3"
down_revision: Union[str, Sequence[str], None] = "b7e2c4d9a1f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD_ACTIONS = (
    "auth.login", "auth.login_failed", "auth.logout",
    "auth.password_changed", "auth.password_reset",
    "user.staff_invited", "user.invite_resent", "user.role_changed",
    "user.deactivated", "user.reactivated",
    "settings.updated", "report.exported",
)
_NEW_ACTIONS = _OLD_ACTIONS + ("data.exported", "data.imported")


def _check(actions: tuple[str, ...]) -> str:
    return "action IN (" + ", ".join(f"'{a}'" for a in actions) + ")"


def upgrade() -> None:
    op.drop_constraint("ck_audit_log_action", "audit_log", type_="check")
    op.create_check_constraint("ck_audit_log_action", "audit_log", _check(_NEW_ACTIONS))


def downgrade() -> None:
    op.execute("DELETE FROM audit_log WHERE action IN ('data.exported', 'data.imported')")
    op.drop_constraint("ck_audit_log_action", "audit_log", type_="check")
    op.create_check_constraint("ck_audit_log_action", "audit_log", _check(_OLD_ACTIONS))
