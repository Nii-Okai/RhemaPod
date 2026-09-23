"""One-shot backfill: push already-published sermons' video masters into
Cloudflare Stream (plan §A.2, W1.9).

Why this exists: Stream ingestion (`media_service._start_stream_ingest`) only
fires from `confirm_upload`, i.e. only for uploads confirmed *after*
W1.1-W1.4 landed. Every sermon published before that has a READY UploadJob
and a raw S3 master, but its video MediaRef has no `stream_uid` — Stream has
never seen it. "Without this the app has nothing to play" (plan's own words):
the mobile app's player only knows how to request Stream-signed URLs (W1.5).

This script does not reimplement ingest. It drives the same path
`confirm_upload` already uses — `media_service._start_stream_ingest` — at
catalogue scale, exactly as the plan directs ("you're driving the existing
ingest path at scale, not building new ingest logic").

Idempotent
----------
A sermon is only ever picked up once. On re-run:
  - a video MediaRef that already has a `stream_uid`            -> skipped
  - a video UploadJob that's already been attempted at least
    once (`attempts > 0`) and hasn't resolved yet               -> skipped
    (in-flight; retrying it would kick off a *second*, separately
    billed Cloudflare ingest for the same master — this is exactly
    the failure mode idempotency exists to prevent)
  - a video UploadJob that already resolved without a
    `stream_uid` (Stream itself errored, already archived)      -> skipped
    (a genuine terminal failure from before this run; reconciling it
    is sweep_stream_jobs.py's job, not backfill's — re-running this
    script does not retry it)
Only a sermon whose video job has never been attempted at all
(`attempts == 0`, `finished_at is None`) is eligible.

Dry-run by default
-------------------
Cloudflare Stream bills on usage (storage + delivery). Without --execute,
this script only reads the DB and reports what it *would* do — it never
calls the Stream provider and never writes to the database. Review the
dry-run's counts before ever passing --execute (plan W1.9's own caution).

    uv run python -m app.scripts.backfill_stream              # dry run
    uv run python -m app.scripts.backfill_stream --execute    # real, billed run
"""
from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import PrimarySession
from app.models.models import (
    MediaRef,
    MediaType,
    Sermon,
    SermonStatus,
    UploadJob,
    UploadStatus,
)
from app.services import media_service


@dataclass
class BackfillItem:
    sermon_id: str
    title: str
    reason: str | None = None


@dataclass
class BackfillReport:
    dry_run: bool
    to_ingest: list[BackfillItem] = field(default_factory=list)  # dry-run only
    ingested: list[BackfillItem] = field(default_factory=list)   # real run only
    skipped: list[BackfillItem] = field(default_factory=list)
    failed: list[BackfillItem] = field(default_factory=list)


class _IngestErrorCapture:
    """Observes media_service.log for the duration of a real run so the
    report can name the *specific* reason a kickoff failed, instead of a
    generic message.

    media_service._start_stream_ingest already computes and logs that reason
    (`log.warning("stream_ingest_failed", ..., error=...)`), but swallows the
    exception by design — a Stream outage must not fail the normal
    upload-confirm response, and that design choice is exactly what we're
    reusing here. Rather than duplicate its error handling, this wraps the
    module's `log` object, forwards every call through unchanged (script
    output must not go dark), and records the one event we care about.
    """

    def __init__(self, real_logger: object) -> None:
        self._real = real_logger
        self.last_error: dict[str, str] = {}

    def _forward(self, level: str, event: str, **kw: object) -> None:
        getattr(self._real, level)(event, **kw)
        if event == "stream_ingest_failed":
            job_id = str(kw.get("job_id"))
            self.last_error[job_id] = str(kw.get("error", "unknown provider error"))

    def debug(self, event: str, **kw: object) -> None:
        self._forward("debug", event, **kw)

    def info(self, event: str, **kw: object) -> None:
        self._forward("info", event, **kw)

    def warning(self, event: str, **kw: object) -> None:
        self._forward("warning", event, **kw)

    def error(self, event: str, **kw: object) -> None:
        self._forward("error", event, **kw)


async def _classify(
    db: AsyncSession,
) -> tuple[list[tuple[Sermon, UploadJob]], list[BackfillItem]]:
    """Walk every published sermon and split it into ingest-eligible
    (sermon, job) pairs and skip-with-reason items. Read-only: issues no
    writes and calls no external provider — this alone is what makes
    dry-run mode safe.
    """
    eligible: list[tuple[Sermon, UploadJob]] = []
    skipped: list[BackfillItem] = []

    sermons = (await db.execute(
        select(Sermon)
        .where(Sermon.status == SermonStatus.PUBLISHED)
        .order_by(Sermon.created_at)
    )).scalars().all()

    for sermon in sermons:
        refs = (await db.execute(
            select(MediaRef).where(
                MediaRef.sermon_id == sermon.id, MediaRef.type == MediaType.VIDEO
            )
        )).scalars().all()

        if not refs:
            skipped.append(BackfillItem(str(sermon.id), sermon.title, "no video media"))
            continue
        if any(r.stream_uid is not None for r in refs):
            skipped.append(
                BackfillItem(str(sermon.id), sermon.title, "already ingested (stream_uid set)")
            )
            continue
        if len(refs) > 1:
            # Real HLS ladder (transcode_enabled=True) — several MediaRef rows
            # for one video, none of which is "the" Stream target. Same case
            # _start_stream_ingest itself declines to guess at
            # (stream_ingest_skipped_multiple_media_refs); reported here up
            # front so dry-run can name it without calling that function.
            skipped.append(
                BackfillItem(
                    str(sermon.id), sermon.title,
                    f"ambiguous: {len(refs)} video media_refs, none ingested",
                )
            )
            continue

        job = (await db.execute(
            select(UploadJob)
            .where(UploadJob.sermon_id == sermon.id, UploadJob.media_type == MediaType.VIDEO)
            .order_by(UploadJob.created_at.desc())
        )).scalars().first()

        if job is None:
            skipped.append(
                BackfillItem(
                    str(sermon.id), sermon.title,
                    "no upload job found to source the raw master from",
                )
            )
            continue
        if job.status != UploadStatus.READY:
            skipped.append(
                BackfillItem(
                    str(sermon.id), sermon.title,
                    f"upload job not ready (status={job.status.value})",
                )
            )
            continue
        if job.finished_at is not None:
            # Resolved already (ready-and-archived would have set stream_uid,
            # which we'd have caught above) — so this is a prior Stream error
            # that was archived. A genuine terminal failure from before this
            # run; sweep_stream_jobs.py owns reconciling it, not backfill.
            skipped.append(
                BackfillItem(
                    str(sermon.id), sermon.title,
                    "a previous Stream ingest attempt already resolved without "
                    "a stream_uid — needs operator attention, not re-run by backfill",
                )
            )
            continue
        if job.attempts > 0:
            skipped.append(
                BackfillItem(
                    str(sermon.id), sermon.title,
                    f"ingest already in-flight (attempts={job.attempts}, "
                    f"started_at={job.started_at})",
                )
            )
            continue

        eligible.append((sermon, job))

    return eligible, skipped


async def run_backfill(db: AsyncSession, *, dry_run: bool) -> BackfillReport:
    eligible, skipped = await _classify(db)
    report = BackfillReport(dry_run=dry_run, skipped=skipped)

    if dry_run:
        report.to_ingest = [BackfillItem(str(s.id), s.title) for s, _ in eligible]
        return report

    capture = _IngestErrorCapture(media_service.log)
    original_log = media_service.log
    media_service.log = capture  # type: ignore[assignment]
    try:
        for sermon, job in eligible:
            try:
                await media_service._start_stream_ingest(db, job)
            except Exception as exc:  # noqa: BLE001 - defensive: _start_stream_ingest
                # itself only raises on a genuine bug (it swallows StreamError
                # by design). One sermon's unexpected failure must not abort
                # the rest of the catalogue.
                report.failed.append(
                    BackfillItem(str(sermon.id), sermon.title, f"unexpected error: {exc}")
                )
                continue

            ref = (await db.execute(
                select(MediaRef).where(
                    MediaRef.sermon_id == sermon.id, MediaRef.type == MediaType.VIDEO
                )
            )).scalars().first()
            if ref is not None and ref.stream_uid is not None:
                report.ingested.append(BackfillItem(str(sermon.id), sermon.title))
            else:
                reason = capture.last_error.get(
                    str(job.id), "Stream ingest kickoff did not produce a stream_uid"
                )
                report.failed.append(BackfillItem(str(sermon.id), sermon.title, reason))
    finally:
        media_service.log = original_log  # type: ignore[assignment]

    return report


def _print_report(report: BackfillReport) -> None:
    mode = "DRY RUN" if report.dry_run else "EXECUTE"
    print(f"[*] Stream backfill ({mode})")
    if report.dry_run:
        print(f"[*] Would ingest: {len(report.to_ingest)}")
        for item in report.to_ingest:
            print(f"    - {item.sermon_id}  {item.title}")
    else:
        print(f"[+] Ingested:     {len(report.ingested)}")
        for item in report.ingested:
            print(f"    - {item.sermon_id}  {item.title}")
    print(f"[=] Skipped:      {len(report.skipped)}")
    for item in report.skipped:
        print(f"    - {item.sermon_id}  {item.title}  ({item.reason})")
    print(f"[!] Failed:       {len(report.failed)}")
    for item in report.failed:
        print(f"    - {item.sermon_id}  {item.title}  ({item.reason})")


async def _run(dry_run: bool) -> BackfillReport:
    async with PrimarySession() as db:
        return await run_backfill(db, dry_run=dry_run)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill already-published sermons' video masters into Cloudflare "
            "Stream (plan §A.2, W1.9). Dry-run by default: reports counts, "
            "makes no Cloudflare calls and no DB writes. Pass --execute for a "
            "real, billed run."
        )
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually call Cloudflare Stream and write to the DB. Without "
             "this flag nothing is called or written — only reported.",
    )
    args = parser.parse_args()
    report = asyncio.run(_run(dry_run=not args.execute))
    _print_report(report)


if __name__ == "__main__":
    main()
