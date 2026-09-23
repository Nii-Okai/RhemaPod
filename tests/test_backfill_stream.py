"""app/scripts/backfill_stream.py (plan §A.2, W1.9): backfilling already-
published sermons' video masters into Cloudflare Stream at catalogue scale,
driving the same `media_service._start_stream_ingest` path `confirm_upload`
already uses.

All against the stub Stream provider (app.core.stream.LocalStream) — see
conftest.py. `confirm_upload` auto-ingests video on the normal upload path
now (W1.1-W1.4), so every test here first uploads+publishes normally, then
resets the MediaRef/UploadJob rows to the pre-Stream-pipeline state the
backfill actually targets (stream_uid=None, attempts=0, started_at=None,
finished_at=None) — that's what "an already-published sermon nobody has
backfilled yet" looks like in the DB.
"""
import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core import stream as stream_module
from app.core.stream import StreamError
from app.models.models import MediaRef, MediaType, Sermon, SermonStatus, UploadJob
from app.scripts.backfill_stream import run_backfill
from tests.test_media import make_user, publish, upload_and_process

pytestmark = pytest.mark.asyncio


async def _get_db(engine) -> AsyncSession:
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    return Session()


async def _row(engine, model, **where):
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        stmt = select(model)
        for k, v in where.items():
            stmt = stmt.where(getattr(model, k) == v)
        return (await s.execute(stmt)).scalars().first()


async def _reset_to_unbackfilled(engine, sid: str) -> None:
    """Undo confirm_upload's automatic ingest so the sermon looks like it
    predates the Stream pipeline — the exact state W1.9 exists to fix."""
    db = await _get_db(engine)
    try:
        ref = (await db.execute(
            select(MediaRef).where(
                MediaRef.sermon_id == uuid.UUID(sid), MediaRef.type == MediaType.VIDEO
            )
        )).scalars().first()
        ref.stream_uid = None
        job = (await db.execute(
            select(UploadJob).where(
                UploadJob.sermon_id == uuid.UUID(sid), UploadJob.media_type == MediaType.VIDEO
            )
        )).scalars().first()
        job.attempts = 0
        job.started_at = None
        job.finished_at = None
        await db.commit()
    finally:
        await db.close()


async def _make_published_unbackfilled_sermon(client, engine, editor, manager, title) -> str:
    sid = (await client.post(
        "/api/v1/sermons", json={"title": title}, headers=editor
    )).json()["id"]
    await upload_and_process(client, editor, sid)
    await publish(client, editor, manager, sid)
    await _reset_to_unbackfilled(engine, sid)
    return sid


# ── dry run ──────────────────────────────────────────────────────────────────
async def test_dry_run_reports_candidate_without_calling_stream_or_writing(
    client, engine, monkeypatch
):
    calls: list[str] = []
    orig_start_ingest = stream_module.LocalStream.start_ingest

    async def tracking_start_ingest(self, *, source_url, meta=None):
        calls.append(source_url)
        return await orig_start_ingest(self, source_url=source_url, meta=meta)

    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await _make_published_unbackfilled_sermon(client, engine, ed, mgr, "Legacy Sermon")

    # Install the call tracker only now — upload_and_process/publish's own
    # (real, expected) ingest call must not count against dry-run's "zero
    # calls" guarantee.
    monkeypatch.setattr(stream_module.LocalStream, "start_ingest", tracking_start_ingest)

    db = await _get_db(engine)
    try:
        report = await run_backfill(db, dry_run=True)
    finally:
        await db.close()

    assert report.dry_run is True
    assert [i.sermon_id for i in report.to_ingest] == [sid]
    assert report.ingested == []
    assert report.failed == []
    assert report.skipped == []

    # Zero real Stream calls.
    assert calls == []

    # Zero DB writes: still exactly the reset-to-legacy state.
    ref = await _row(engine, MediaRef, sermon_id=uuid.UUID(sid), type=MediaType.VIDEO)
    job = await _row(engine, UploadJob, sermon_id=uuid.UUID(sid))
    assert ref.stream_uid is None
    assert job.attempts == 0
    assert job.started_at is None


# ── idempotency ──────────────────────────────────────────────────────────────
async def test_second_run_skips_already_ingested_sermon(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await _make_published_unbackfilled_sermon(client, engine, ed, mgr, "Legacy Sermon")

    db = await _get_db(engine)
    try:
        first = await run_backfill(db, dry_run=False)
    finally:
        await db.close()

    assert [i.sermon_id for i in first.ingested] == [sid]
    assert first.failed == []

    ref = await _row(engine, MediaRef, sermon_id=uuid.UUID(sid), type=MediaType.VIDEO)
    assert ref.stream_uid is not None
    job = await _row(engine, UploadJob, sermon_id=uuid.UUID(sid))
    assert job.attempts == 1

    db = await _get_db(engine)
    try:
        second = await run_backfill(db, dry_run=False)
    finally:
        await db.close()

    assert second.ingested == []
    assert second.to_ingest == []
    assert [i.sermon_id for i in second.skipped] == [sid]
    assert "already ingested" in second.skipped[0].reason

    # No second, separately-billed kickoff.
    job = await _row(engine, UploadJob, sermon_id=uuid.UUID(sid))
    assert job.attempts == 1


async def test_in_flight_job_is_skipped_not_retried(client, engine):
    """An ingest kicked off but not yet resolved (no webhook yet) must not be
    re-kicked — that would be a second, separately-billed Cloudflare ingest
    for the same master."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await _make_published_unbackfilled_sermon(client, engine, ed, mgr, "In Flight Sermon")

    db = await _get_db(engine)
    try:
        job = (await db.execute(select(UploadJob))).scalars().first()
        job.attempts = 1
        job.started_at = datetime.now(timezone.utc)
        await db.commit()
    finally:
        await db.close()

    db = await _get_db(engine)
    try:
        report = await run_backfill(db, dry_run=True)
    finally:
        await db.close()

    assert report.to_ingest == []
    assert [i.sermon_id for i in report.skipped] == [sid]
    assert "in-flight" in report.skipped[0].reason


# ── failure handling ─────────────────────────────────────────────────────────
async def test_one_failure_does_not_abort_run_and_is_named(client, engine, monkeypatch):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    good_sid = await _make_published_unbackfilled_sermon(client, engine, ed, mgr, "Good Sermon")
    bad_sid = await _make_published_unbackfilled_sermon(client, engine, ed, mgr, "Bad Sermon")

    db = await _get_db(engine)
    try:
        bad_job = (await db.execute(
            select(UploadJob).where(UploadJob.sermon_id == uuid.UUID(bad_sid))
        )).scalars().first()
        bad_job_id = str(bad_job.id)
    finally:
        await db.close()

    async def flaky_start_ingest(self, *, source_url, meta=None):
        if meta and meta.get("upload_job_id") == bad_job_id:
            raise StreamError("simulated Cloudflare outage")
        self._counter += 1
        uid = f"stub{self._counter:028d}"[:32]
        from app.core.stream import StreamIngest, StreamStatus
        status = StreamStatus(uid=uid, state="queued", ready_to_stream=False)
        self._statuses[uid] = status
        return StreamIngest(uid=uid, state=status.state)

    monkeypatch.setattr(stream_module.LocalStream, "start_ingest", flaky_start_ingest)

    db = await _get_db(engine)
    try:
        report = await run_backfill(db, dry_run=False)
    finally:
        await db.close()

    assert [i.sermon_id for i in report.ingested] == [good_sid]
    assert [i.sermon_id for i in report.failed] == [bad_sid]
    assert "simulated Cloudflare outage" in report.failed[0].reason

    good_ref = await _row(engine, MediaRef, sermon_id=uuid.UUID(good_sid), type=MediaType.VIDEO)
    assert good_ref.stream_uid is not None

    bad_ref = await _row(engine, MediaRef, sermon_id=uuid.UUID(bad_sid), type=MediaType.VIDEO)
    assert bad_ref.stream_uid is None
    bad_job = await _row(engine, UploadJob, sermon_id=uuid.UUID(bad_sid))
    assert bad_job.attempts == 1  # kickoff was attempted, just failed


# ── scope ────────────────────────────────────────────────────────────────────
async def test_unpublished_sermon_is_not_a_candidate(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Draft"}, headers=ed
    )).json()["id"]
    await upload_and_process(client, ed, sid)
    await _reset_to_unbackfilled(engine, sid)

    sermon = await _row(engine, Sermon, id=uuid.UUID(sid))
    assert sermon.status != SermonStatus.PUBLISHED

    db = await _get_db(engine)
    try:
        report = await run_backfill(db, dry_run=True)
    finally:
        await db.close()

    assert report.to_ingest == []
    assert report.skipped == []
