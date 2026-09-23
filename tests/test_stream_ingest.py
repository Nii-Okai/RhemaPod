"""Cloudflare Stream ingest pipeline (plan §A.2, W1.2/W1.3/W1.4): confirm ->
ingest kickoff -> webhook/sweep resolution -> Glacier archival.

All against the stub Stream provider (app.core.stream.LocalStream) and the
stub storage backend (app.core.storage.LocalStorage) — see conftest.py. The
real Cloudflare/S3 behaviour is verified separately, live, per status.md
"W1.1-W1.4 stream pipeline core".
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core import storage as storage_module
from app.core import stream as stream_module
from app.core.config import get_settings
from app.core.stream import StreamError, StreamStatus
from app.models.models import MediaRef, MediaType, UploadJob
from app.services import media_service
from tests.test_media import make_user, upload_and_process

pytestmark = pytest.mark.asyncio

AUDIO = {"filename": "sermon.mp3", "content_type": "audio/mpeg", "media_type": "audio"}


async def _row(engine, model, **where):
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        stmt = select(model)
        for k, v in where.items():
            stmt = stmt.where(getattr(model, k) == v)
        return (await s.execute(stmt)).scalars().first()


async def _get_db(engine) -> AsyncSession:
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    return Session()


# ── confirm -> ingest kickoff ──────────────────────────────────────────────────
async def test_confirm_starts_stream_ingest_for_video(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)

    ref = await _row(engine, MediaRef, sermon_id=uuid.UUID(sid), type=MediaType.VIDEO)
    assert ref is not None
    assert ref.stream_uid is not None and ref.stream_uid.startswith("stub")

    job = await _row(engine, UploadJob, sermon_id=uuid.UUID(sid))
    assert job.attempts == 1
    assert job.started_at is not None
    assert job.finished_at is None  # not resolved until ready/error


class _RecordingLogger:
    """Stand-in for a structlog BoundLogger that just records what it was
    told. `structlog.testing.capture_logs` doesn't intercept media_service's
    module-level `log` — frozen by `cache_logger_on_first_use=True` — so
    tests that assert on a specific log event inject this instead, same
    pattern as tests/test_auth_hardening.py::_RecordingLogger."""

    def __init__(self) -> None:
        self.records: list[dict] = []

    def _record(self, level: str, event: str, **kw) -> None:
        self.records.append({"level": level, "event": event, **kw})

    def debug(self, event, **kw):
        self._record("debug", event, **kw)

    def info(self, event, **kw):
        self._record("info", event, **kw)

    def warning(self, event, **kw):
        self._record("warning", event, **kw)

    def error(self, event, **kw):
        self._record("error", event, **kw)


async def test_confirm_skips_ingest_for_ambiguous_hls_ladder(client, engine, monkeypatch):
    """A real HLS ladder (transcode_enabled=True) produces one MediaRef per
    quality — several VIDEO rows for one upload job, none of which is "the"
    Stream target. _start_stream_ingest must skip rather than guess, must
    never call the Stream provider, and — per the gilfoyle fix closing the
    unbounded-retry footgun — must still bump `job.attempts`/`started_at` so
    the sweep eventually stops re-selecting it."""
    from app.services import media_service

    monkeypatch.setattr(media_service.settings, "transcode_enabled", True)

    calls = []
    orig_start_ingest = stream_module.LocalStream.start_ingest

    async def tracking_start_ingest(self, *, source_url, meta=None):
        calls.append(meta)
        return await orig_start_ingest(self, source_url=source_url, meta=meta)

    monkeypatch.setattr(stream_module.LocalStream, "start_ingest", tracking_start_ingest)

    recorder = _RecordingLogger()
    monkeypatch.setattr(media_service, "log", recorder)

    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)

    # Fetch all rows, not just the first — len(VIDEO_QUALITIES) == 3.
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        all_refs = (await s.execute(
            select(MediaRef).where(
                MediaRef.sermon_id == uuid.UUID(sid), MediaRef.type == MediaType.VIDEO
            )
        )).scalars().all()
    assert len(all_refs) == 3
    assert all(r.stream_uid is None for r in all_refs)

    # No Stream API call was attempted — the ambiguity was caught before
    # ever reaching the provider.
    assert calls == []

    skip_events = [r for r in recorder.records if r["event"] == "stream_ingest_skipped_multiple_media_refs"]
    assert len(skip_events) == 1
    assert skip_events[0]["level"] == "warning"
    assert skip_events[0]["count"] == 3

    job = await _row(engine, UploadJob, sermon_id=uuid.UUID(sid))
    assert job.attempts == 1
    assert job.started_at is not None
    assert job.finished_at is None


async def test_sweep_stops_retrying_ambiguous_ladder_past_max_attempts(client, engine, monkeypatch):
    """The skip branch's attempts bump (see previous test) must actually
    bound the sweep: once a job hits STREAM_INGEST_MAX_ATTEMPTS it drops out
    of the retry-candidate query and is never re-skipped again."""
    from app.services import media_service

    monkeypatch.setattr(media_service.settings, "transcode_enabled", True)

    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)

    job = await _row(engine, UploadJob, sermon_id=uuid.UUID(sid))
    assert job.attempts == 1  # from the initial confirm-time skip

    db = await _get_db(engine)
    try:
        # Drive it up to the cap: each sweep pass re-hits the same skip
        # branch (still ambiguous — no stream_uid ever appears) as long as
        # `started_at` is stale and `attempts` is still under the cap.
        for _ in range(media_service.STREAM_INGEST_MAX_ATTEMPTS - 1):
            job = (await db.execute(select(UploadJob))).scalars().first()
            job.started_at = datetime.now(timezone.utc) - timedelta(hours=2)
            await db.commit()
            await media_service.sweep_stream_jobs(db)

        job = (await db.execute(select(UploadJob))).scalars().first()
        assert job.attempts == media_service.STREAM_INGEST_MAX_ATTEMPTS

        # One more stale pass: the retry-candidate query's
        # `attempts < STREAM_INGEST_MAX_ATTEMPTS` filter now excludes it —
        # nothing left to touch.
        job.started_at = datetime.now(timezone.utc) - timedelta(hours=2)
        await db.commit()
        count = await media_service.sweep_stream_jobs(db)
        assert count == 0

        job = (await db.execute(select(UploadJob))).scalars().first()
        assert job.attempts == media_service.STREAM_INGEST_MAX_ATTEMPTS
    finally:
        await db.close()


async def test_confirm_does_not_start_ingest_for_audio(client, engine):
    """Audio is served straight from S3 (W1.6) — never handed to Stream."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid, payload=AUDIO)

    ref = await _row(engine, MediaRef, sermon_id=uuid.UUID(sid), type=MediaType.AUDIO)
    assert ref is not None
    assert ref.stream_uid is None


# ── webhook: ready / error / duplicate / unknown ──────────────────────────────
async def test_webhook_ready_resolves_job_and_archives(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)

    ref = await _row(engine, MediaRef, sermon_id=uuid.UUID(sid), type=MediaType.VIDEO)
    job = await _row(engine, UploadJob, sermon_id=uuid.UUID(sid))
    uid = ref.stream_uid
    raw_key = job.raw_key

    r = await client.post(
        "/api/v1/media/stream/webhook",
        json={"uid": uid, "status": {"state": "ready"}, "readyToStream": True},
    )
    assert r.status_code == 200
    assert r.json()["outcome"] == "ready"

    job = await _row(engine, UploadJob, id=job.id)
    assert job.finished_at is not None

    # Empirical read-back, not inferred from the copy call succeeding — the
    # same bar the plan sets for the real S3 verification (§A.2, W1.4).
    settings = get_settings()
    store = storage_module.get_storage()
    dest = storage_module.archive_key(uuid.UUID(sid), raw_key)
    assert store.object_exists(settings.s3_raw_bucket, dest)
    assert store.object_storage_class(settings.s3_raw_bucket, dest) == settings.s3_archive_storage_class


async def test_webhook_error_still_archives_and_resolves(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)

    ref = await _row(engine, MediaRef, sermon_id=uuid.UUID(sid), type=MediaType.VIDEO)
    job = await _row(engine, UploadJob, sermon_id=uuid.UUID(sid))
    uid = ref.stream_uid

    r = await client.post(
        "/api/v1/media/stream/webhook",
        json={"uid": uid, "status": {"state": "error", "errorReasonText": "bad file"}},
    )
    assert r.status_code == 200
    assert r.json()["outcome"] == "error"

    settings = get_settings()
    store = storage_module.get_storage()
    dest = storage_module.archive_key(uuid.UUID(sid), job.raw_key)
    assert store.object_storage_class(settings.s3_raw_bucket, dest) == settings.s3_archive_storage_class

    job = await _row(engine, UploadJob, id=job.id)
    assert job.finished_at is not None


async def test_webhook_duplicate_delivery_is_ignored(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)

    ref = await _row(engine, MediaRef, sermon_id=uuid.UUID(sid), type=MediaType.VIDEO)
    body = {"uid": ref.stream_uid, "status": {"state": "ready"}, "readyToStream": True}

    first = await client.post("/api/v1/media/stream/webhook", json=body)
    assert first.json()["outcome"] == "ready"
    second = await client.post("/api/v1/media/stream/webhook", json=body)
    assert second.json()["outcome"] == "duplicate_ignored"


async def test_webhook_unknown_uid_does_not_500(client):
    r = await client.post(
        "/api/v1/media/stream/webhook",
        json={"uid": "not-a-real-uid", "status": {"state": "ready"}, "readyToStream": True},
    )
    assert r.status_code == 200
    assert r.json()["outcome"] == "unknown_uid"


async def test_webhook_missing_uid_or_state_400(client):
    r = await client.post("/api/v1/media/stream/webhook", json={"status": {}})
    assert r.status_code == 400


# ── sweep: missed webhook, and kickoff retry ──────────────────────────────────
async def test_sweep_resolves_missed_webhook(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)

    ref = await _row(engine, MediaRef, sermon_id=uuid.UUID(sid), type=MediaType.VIDEO)
    # No webhook ever arrives, but Cloudflare's own status is "ready" —
    # seed the stub so a poll would discover that.
    provider = stream_module.get_provider()
    provider.set_status(
        ref.stream_uid,
        StreamStatus(uid=ref.stream_uid, state="ready", ready_to_stream=True),
    )

    db = await _get_db(engine)
    try:
        # Backdate started_at past the staleness window so the sweep treats
        # it as "check it now" rather than "still working".
        job = (await db.execute(select(UploadJob))).scalars().first()
        job.started_at = datetime.now(timezone.utc) - timedelta(hours=2)
        await db.commit()

        count = await media_service.sweep_stream_jobs(db)
        assert count == 1
    finally:
        await db.close()

    job = await _row(engine, UploadJob, sermon_id=uuid.UUID(sid))
    assert job.finished_at is not None


async def test_sweep_retries_kickoff_that_never_got_a_uid(client, engine, monkeypatch):
    async def boom(self, *, source_url, meta=None):
        raise StreamError("simulated Cloudflare outage")

    monkeypatch.setattr(stream_module.LocalStream, "start_ingest", boom)

    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)

    ref = await _row(engine, MediaRef, sermon_id=uuid.UUID(sid), type=MediaType.VIDEO)
    assert ref.stream_uid is None  # kickoff failed, as simulated

    job = await _row(engine, UploadJob, sermon_id=uuid.UUID(sid))
    assert job.attempts == 1

    db = await _get_db(engine)
    try:
        job = (await db.execute(select(UploadJob))).scalars().first()
        job.started_at = datetime.now(timezone.utc) - timedelta(hours=2)
        await db.commit()

        monkeypatch.undo()  # restore the working stub start_ingest for the retry

        count = await media_service.sweep_stream_jobs(db)
        assert count == 1
    finally:
        await db.close()

    ref = await _row(engine, MediaRef, sermon_id=uuid.UUID(sid), type=MediaType.VIDEO)
    assert ref.stream_uid is not None

    job = await _row(engine, UploadJob, sermon_id=uuid.UUID(sid))
    assert job.attempts == 2
