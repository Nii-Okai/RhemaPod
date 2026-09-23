"""add stream_uid and upload job bookkeeping

Revision ID: c7d8e9f0a1b2
Revises: 3a78d016e403
Create Date: 2026-09-22 12:00:00.000000

Additive: `media_refs.stream_uid` (nullable, unique) tracks the Cloudflare
Stream video asset a rendition was ingested into (plan §A.2, W1.1/W1.2/W1.3).
Placed on MediaRef rather than Sermon because video and audio are separate
Stream ingests in this pipeline (separate UploadJobs, separate raw masters) —
a MediaRef row already models "one playable rendition", which is exactly what
one Stream asset is. See status.md "W1.1-W1.4 stream pipeline core" for the
full placement rationale.

`upload_jobs` gains `attempts`/`started_at`/`finished_at` so
sweep_stream_jobs.py can make a safe retry decision for a Stream ingest whose
webhook never arrived, without conflating that with the pre-existing
`upload_jobs.status` column (which tracks the unrelated legacy
transcode/passthrough pipeline and is untouched by this migration).
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7d8e9f0a1b2"
down_revision: Union[str, Sequence[str], None] = "3a78d016e403"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "media_refs", sa.Column("stream_uid", sa.String(length=32), nullable=True)
    )
    op.create_index(
        op.f("ix_media_refs_stream_uid"), "media_refs", ["stream_uid"], unique=True
    )
    op.add_column(
        "upload_jobs",
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "upload_jobs",
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "upload_jobs",
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("upload_jobs", "finished_at")
    op.drop_column("upload_jobs", "started_at")
    op.drop_column("upload_jobs", "attempts")
    op.drop_index(op.f("ix_media_refs_stream_uid"), table_name="media_refs")
    op.drop_column("media_refs", "stream_uid")
