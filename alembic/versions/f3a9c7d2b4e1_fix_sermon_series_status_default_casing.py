"""fix sermon/series status server_default casing

Revision ID: f3a9c7d2b4e1
Revises: 37a5ca59a2cc
Create Date: 2026-10-15 00:00:00.000000

``sermons.status`` and ``series.status`` are backed by SQLAlchemy's
``Enum(SermonStatus, native_enum=False)`` with no ``values_callable``, which
means the ORM reads/writes the Python enum's *member name* (``"DRAFT"``,
``"PUBLISHED"``, ...), not its lowercase ``.value`` (``"draft"``,
``"published"``, ...). Every write path in the app already sets ``status``
explicitly via the enum member (e.g. ``status=SermonStatus.DRAFT``), so this
has never produced bad data in practice — but migration ``a2fe8c426689``
(the original ``add_content_table``) gave both columns a SQL-level
``server_default="draft"`` (lowercase), which does not match any valid
member name. That default is normally unreachable (an ORM insert that omits
``status`` uses the Python-side ``default=SermonStatus.DRAFT`` instead of
falling through to the server default), but anything that bypasses the ORM
— a raw ``INSERT``/``UPDATE`` or a future bulk-insert via Core — would
silently write a value the ``Enum`` type's own ``LookupError`` can't parse
back out, surfacing as an unhandled 500 on read instead of a clean 404.

Sibling tables added in the same migration (``upload_jobs``,
``subscriptions``, ``announcements``, ``sermon_comments``) all got this
right (their ``server_default`` already matches the enum member name); this
is an isolated casing slip in ``sermons``/``series`` only.

This migration:
  1. Corrects the ``server_default`` on both columns to the properly-cased
     ``"DRAFT"``, matching what the ORM enum actually expects.
  2. Backfills defensively: uppercases any existing row whose ``status``
     isn't already uppercase. For every ``SermonStatus`` member,
     ``value.upper() == name`` (e.g. ``"pending_review".upper() ==
     "PENDING_REVIEW"``), so this transform is unambiguous and can't
     misroute a row to the wrong status. It's also a no-op for any row
     that's already correctly cased (``WHERE status <> upper(status)``
     excludes them) — read-only verification in the dev DB prior to this
     migration found zero rows in either table currently holding a
     non-uppercase value, so this is a defensive backfill, not a known-data
     repair.

Downgrade restores the old (buggy) ``server_default`` for symmetry but does
not re-lowercase any data — that would reintroduce the exact hazard this
migration exists to close.
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f3a9c7d2b4e1"
down_revision: Union[str, Sequence[str], None] = "37a5ca59a2cc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_STATUS = sa.String(length=20)


def upgrade() -> None:
    op.alter_column(
        "sermons", "status",
        existing_type=_STATUS,
        server_default="DRAFT",
        existing_nullable=False,
    )
    op.alter_column(
        "series", "status",
        existing_type=_STATUS,
        server_default="DRAFT",
        existing_nullable=False,
    )

    # Defensive, idempotent backfill — see module docstring. Untouched rows
    # (already uppercase) are excluded by the WHERE clause.
    op.execute(
        "UPDATE sermons SET status = upper(status) WHERE status <> upper(status)"
    )
    op.execute(
        "UPDATE series SET status = upper(status) WHERE status <> upper(status)"
    )


def downgrade() -> None:
    op.alter_column(
        "series", "status",
        existing_type=_STATUS,
        server_default="draft",
        existing_nullable=False,
    )
    op.alter_column(
        "sermons", "status",
        existing_type=_STATUS,
        server_default="draft",
        existing_nullable=False,
    )
