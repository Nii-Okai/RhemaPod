"""merge r2-storage and sermon-comments migration heads

Revision ID: 0543034f79af
Revises: b2c3d4e5f6a7, e5f6a7b8c9d0
Create Date: 2026-10-08 01:29:09.046536

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0543034f79af'
down_revision: Union[str, Sequence[str], None] = ('b2c3d4e5f6a7', 'e5f6a7b8c9d0')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
