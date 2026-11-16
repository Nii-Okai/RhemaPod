"""add media_captions

Revision ID: d9c4e7a1f3b2
Revises: b4d8f2a6c1e9
Create Date: 2026-11-09 21:00:00.000000

Additive: one row per (video rendition, caption language) tracking the
captions pipeline (Stream AI English transcription, English->French
translation, staff uploads). The caption files live on Cloudflare Stream;
nothing here stores caption text. Dropping the table loses only pipeline
state — the tracks already on Stream keep playing.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d9c4e7a1f3b2"
down_revision: str | Sequence[str] | None = "b4d8f2a6c1e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "media_captions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("media_ref_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("language", sa.String(length=8), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "PENDING", "GENERATING", "READY", "ERROR",
                name="caption_status", native_enum=False, length=20,
            ),
            nullable=False,
        ),
        sa.Column(
            "source",
            sa.Enum(
                "GENERATED", "TRANSLATED", "UPLOADED",
                name="caption_source", native_enum=False, length=20,
            ),
            nullable=False,
        ),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.text("now()"), nullable=True,
        ),
        sa.ForeignKeyConstraint(["media_ref_id"], ["media_refs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("media_ref_id", "language", name="uq_media_caption_language"),
    )
    op.create_index(
        op.f("ix_media_captions_media_ref_id"), "media_captions", ["media_ref_id"]
    )
    op.create_index(op.f("ix_media_captions_status"), "media_captions", ["status"])


def downgrade() -> None:
    op.drop_index(op.f("ix_media_captions_status"), table_name="media_captions")
    op.drop_index(op.f("ix_media_captions_media_ref_id"), table_name="media_captions")
    op.drop_table("media_captions")
