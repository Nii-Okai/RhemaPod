"""add church_settings table

Revision ID: e5a68425e539
Revises: 8c596c67f0ae
Create Date: 2026-10-17 23:00:00.000000

Phase 3 of the admin-settings plan (`plans/plan-admin-settings.md`
§A.4.3/S11): the church profile and the app content it drives. Purely
additive.

* Singleton: `id SMALLINT PRIMARY KEY CHECK (id = 1)`, so a second row is
  impossible and the table never needs a "which row?" lookup.
* `version` is the optimistic-concurrency token `PATCH /admin/settings`
  (S12) compares and bumps.
* `updated_by_id` has **no FK**, like `audit_log.actor_id`: an account
  erasure must not touch or be blocked by this row.
* Legal documents are URLs only (D2/D2a), both NULL until Isaac sets them.

Seed row: church name, app name and contact email as in §A.4.3, and
`comment_guidelines` byte-for-byte equal to `COMMENTS_TERMS_TEXT` in
`mobile/lib/content/commentsCompliance.ts` (first line is the title the
mobile `TermsSheet` splits off). `tests/test_migrations_admin_settings.py`
re-extracts that string from the TS file and compares, so drift fails.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5a68425e539"
down_revision: Union[str, Sequence[str], None] = "8c596c67f0ae"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Copied verbatim from mobile/lib/content/commentsCompliance.ts
# (COMMENTS_TERMS_TEXT). Do not reflow: the seed must match byte-for-byte.
_COMMENT_GUIDELINES = """RhemaPod Comment Guidelines

Welcome to RhemaPod, the media platform of Watered Garden Church, Ghana. To keep our community Christ-centered, respectful, and edifying, all users must agree to the following rules before commenting on sermons:

• Edify and Encourage: Use your words to build up others, share testimonies, and discuss the Word of God respectfully.
• Zero Tolerance for Abuse: Insults, mockery, profanity, or attacks against church leadership or fellow believers will not be tolerated.
• No Spam or Promotion: Do not post advertisements, external links, commercial promos, or repetitive spam.
• Protect Privacy: Do not share phone numbers, addresses, or private financial details in public comments.

Moderation & Enforcement:
Watered Garden Church reserves the right to delete violating comments. Continuous or severe violations will result in temporary or permanent suspension from the platform.

By clicking Agree & Accept, you promise to keep your interactions respectful, safe, and honoring to the Lord."""


def upgrade() -> None:
    table = op.create_table(
        "church_settings",
        sa.Column("id", sa.SmallInteger(), nullable=False),
        sa.Column("church_name", sa.String(length=200), nullable=True),
        sa.Column("app_display_name", sa.String(length=100), nullable=True),
        sa.Column("tagline", sa.String(length=200), nullable=True),
        sa.Column("about", sa.Text(), nullable=True),
        sa.Column("contact_email", sa.String(length=320), nullable=False),
        sa.Column("contact_phone", sa.String(length=40), nullable=True),
        sa.Column("website_url", sa.String(length=2048), nullable=True),
        sa.Column("address", sa.String(length=500), nullable=True),
        sa.Column("comment_guidelines", sa.Text(), nullable=False),
        sa.Column("terms_of_use_url", sa.String(length=2048), nullable=True),
        sa.Column("privacy_policy_url", sa.String(length=2048), nullable=True),
        sa.Column("copyright_notice", sa.String(length=300), nullable=True),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("id = 1", name="ck_church_settings_singleton"),
    )
    op.bulk_insert(
        table,
        [
            {
                "id": 1,
                "church_name": "Watered Garden Church",
                "app_display_name": "RhemaPod",
                "contact_email": "contact@rhemapod.com",
                "comment_guidelines": _COMMENT_GUIDELINES,
            }
        ],
    )


def downgrade() -> None:
    op.drop_table("church_settings")
