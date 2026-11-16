"""data reset / audit cleanup actions, and the sign-in screen image

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-10-23 10:00:00.000000

Settings › Data can now reset tables or wipe the database, and Settings ›
Audit trail can delete entries or wipe it; each writes an audit row
(`data.reset`, `data.audit_deleted`, `data.audit_wiped`), so
`ck_audit_log_action` is widened the same drop-and-recreate way as
`c8d9e0f1a2b3`. Also adds `church_settings.sign_in_image_key`, the photo on
the admin portal's sign-in screen.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d9e0f1a2b3c4"
down_revision: Union[str, Sequence[str], None] = "c8d9e0f1a2b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD_ACTIONS = (
    "auth.login", "auth.login_failed", "auth.logout",
    "auth.password_changed", "auth.password_reset",
    "user.staff_invited", "user.invite_resent", "user.role_changed",
    "user.deactivated", "user.reactivated",
    "settings.updated", "report.exported",
    "data.exported", "data.imported", "user.deleted",
)
_ADDED = ("data.reset", "data.audit_deleted", "data.audit_wiped")
_NEW_ACTIONS = _OLD_ACTIONS + _ADDED


def _check(actions: tuple[str, ...]) -> str:
    return "action IN (" + ", ".join(f"'{a}'" for a in actions) + ")"


def upgrade() -> None:
    op.drop_constraint("ck_audit_log_action", "audit_log", type_="check")
    op.create_check_constraint("ck_audit_log_action", "audit_log", _check(_NEW_ACTIONS))
    op.add_column(
        "church_settings",
        sa.Column("sign_in_image_key", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("church_settings", "sign_in_image_key")
    op.execute(
        "DELETE FROM audit_log WHERE action IN ("
        + ", ".join(f"'{a}'" for a in _ADDED) + ")"
    )
    op.drop_constraint("ck_audit_log_action", "audit_log", type_="check")
    op.create_check_constraint("ck_audit_log_action", "audit_log", _check(_OLD_ACTIONS))
