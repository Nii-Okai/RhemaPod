"""drop church_settings.comment_guidelines

Revision ID: a7c3e9f1b2d4
Revises: d9e0f1a2b3c4
Create Date: 2026-10-30 12:00:00.000000

The comment guidelines move out of the database into the static file
`app/content/comment_guidelines.txt` (plan-ad5-amendment-1, ADR 0017
Addendum 1), so the column is dropped. **This is destructive**, so:

* `upgrade()` first reads the stored text under `SELECT ... FOR UPDATE` and
  aborts if it differs from the canonical text this migration freezes below.
  The row lock is held to the end of the transaction, so a concurrent staff
  edit cannot slip in between the comparison and the drop. A staff edit
  would otherwise be destroyed silently; the operator reconciles first
  (reset the row to the canonical text, or move the edit into the file) and
  re-runs.
* `downgrade()` restores the column exactly as `e5a68425e539` created it
  (`TEXT NOT NULL`, no default), holding the canonical text. The upgrade
  guard guarantees nothing else was lost.

`_CANONICAL` is the text `e5a68425e539` seeded, copied verbatim: migrations
must not import app code, which changes while migrations must not.

Deploy order: the code that no longer maps `comment_guidelines` must be
serving before this runs; code that still selects the column errors once it
is dropped. Roll back with `alembic downgrade d9e0f1a2b3c4` before
redeploying older code. See DEPLOYMENT.md.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7c3e9f1b2d4"
down_revision: Union[str, Sequence[str], None] = "d9e0f1a2b3c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The text seeded by e5a68425e539, verbatim. Do not reflow or edit.
_CANONICAL = """RhemaPod Comment Guidelines

Welcome to RhemaPod, the media platform of Watered Garden Church, Ghana. To keep our community Christ-centered, respectful, and edifying, all users must agree to the following rules before commenting on sermons:

• Edify and Encourage: Use your words to build up others, share testimonies, and discuss the Word of God respectfully.
• Zero Tolerance for Abuse: Insults, mockery, profanity, or attacks against church leadership or fellow believers will not be tolerated.
• No Spam or Promotion: Do not post advertisements, external links, commercial promos, or repetitive spam.
• Protect Privacy: Do not share phone numbers, addresses, or private financial details in public comments.

Moderation & Enforcement:
Watered Garden Church reserves the right to delete violating comments. Continuous or severe violations will result in temporary or permanent suspension from the platform.

By clicking Agree & Accept, you promise to keep your interactions respectful, safe, and honoring to the Lord."""


def upgrade() -> None:
    stored = op.get_bind().execute(
        sa.text("SELECT comment_guidelines FROM church_settings WHERE id = 1 FOR UPDATE")
    ).scalar_one_or_none()
    if stored is not None and stored != _CANONICAL:
        raise RuntimeError(
            "church_settings.comment_guidelines differs from the canonical "
            "text; refusing to drop it and lose the edit. Reset the row to "
            "the canonical text (or move the edit into "
            "app/content/comment_guidelines.txt) and re-run."
        )
    op.drop_column("church_settings", "comment_guidelines")


def downgrade() -> None:
    op.add_column(
        "church_settings",
        sa.Column("comment_guidelines", sa.Text(), nullable=True),
    )
    op.execute(
        sa.text("UPDATE church_settings SET comment_guidelines = :canonical").bindparams(
            canonical=_CANONICAL
        )
    )
    op.alter_column("church_settings", "comment_guidelines", nullable=False)
