"""Video captions: Stream-generated English, translated French, staff uploads.

Runs against the stub Stream provider (LocalStream) and the stub translator
(LocalTranslator, which prefixes "[fr] "), like the rest of the media suite.
"""
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core import stream as stream_module
from app.core import vtt
from app.models.models import (
    CaptionSource,
    CaptionStatus,
    MediaCaption,
    MediaRef,
    MediaType,
)
from app.services import captions_service
from tests.test_media import make_user, make_viewer, upload_and_process

pytestmark = pytest.mark.asyncio

AUDIO = {"filename": "sermon.mp3", "content_type": "audio/mpeg", "media_type": "audio"}

GOOD_VTT = (
    "WEBVTT\n\n"
    "00:00:00.000 --> 00:00:03.000\n"
    "Grace and peace to you all.\n\n"
    "00:00:03.000 --> 00:00:06.000\n"
    "Turn with me to Romans eight.\n"
)


def _session(engine) -> AsyncSession:
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)()


async def _captions(engine, sid) -> dict[str, MediaCaption]:
    async with _session(engine) as s:
        ref = (await s.execute(
            select(MediaRef).where(
                MediaRef.sermon_id == uuid.UUID(sid), MediaRef.type == MediaType.VIDEO
            )
        )).scalar_one()
        rows = (await s.execute(
            select(MediaCaption).where(MediaCaption.media_ref_id == ref.id)
        )).scalars().all()
        return {r.language: r for r in rows}


async def _uid(engine, sid) -> str:
    async with _session(engine) as s:
        return (await s.execute(
            select(MediaRef.stream_uid).where(MediaRef.sermon_id == uuid.UUID(sid))
        )).scalar_one()


async def _advance(engine) -> int | None:
    async with _session(engine) as s:
        return await captions_service.advance_captions(s)


async def _ready_video(client, engine, email="e@example.com"):
    """Editor + sermon with a video whose Stream ingest has gone ready."""
    ed = await make_user(client, engine, email, "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)
    uid = await _uid(engine, sid)
    r = await client.post(
        "/api/v1/media/stream/webhook",
        json={"uid": uid, "status": {"state": "ready"}, "readyToStream": True},
    )
    assert r.json()["outcome"] == "ready"
    return ed, sid, uid


# ── automatic pipeline ────────────────────────────────────────────────────────
async def test_ready_video_starts_english_generation_and_queues_french(client, engine):
    _, sid, uid = await _ready_video(client, engine)

    rows = await _captions(engine, sid)
    assert rows["en"].status == CaptionStatus.GENERATING
    assert rows["en"].source == CaptionSource.GENERATED
    assert rows["fr"].status == CaptionStatus.PENDING
    assert rows["fr"].source == CaptionSource.TRANSLATED

    tracks = await stream_module.get_provider().list_captions(uid=uid)
    assert [(t.language, t.status) for t in tracks] == [("en", "inprogress")]


async def test_french_waits_for_english_then_is_translated(client, engine):
    _, sid, uid = await _ready_video(client, engine)

    await _advance(engine)  # English still in progress: nothing to translate
    rows = await _captions(engine, sid)
    assert rows["en"].status == CaptionStatus.GENERATING
    assert rows["fr"].status == CaptionStatus.PENDING

    stream_module.get_provider().set_caption_status(uid, "en", "ready")
    assert await _advance(engine) == 1

    rows = await _captions(engine, sid)
    assert rows["en"].status == CaptionStatus.READY
    assert rows["fr"].status == CaptionStatus.READY
    french = await stream_module.get_provider().get_captions_vtt(uid=uid, language="fr")
    cues = vtt.parse(french)
    assert cues and all(c.text.startswith("[fr]") for c in cues)
    # Timings carried over from the English track.
    english = vtt.parse(await stream_module.get_provider().get_captions_vtt(uid=uid, language="en"))
    assert cues[0].start == english[0].start


async def test_audio_sermon_gets_no_captions(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid, payload=AUDIO)

    r = await client.get(f"/api/v1/sermons/{sid}/captions", headers=ed)
    assert r.status_code == 200
    assert r.json() == {"available": False, "default_language": "en", "captions": []}


async def test_generation_error_retries_then_fails_both_tracks(client, engine):
    _, sid, uid = await _ready_video(client, engine)
    provider = stream_module.get_provider()

    for _ in range(captions_service.MAX_ATTEMPTS):
        provider.set_caption_status(uid, "en", "error")
        await _advance(engine)  # error -> back to pending (attempt counted)
        await _advance(engine)  # pending -> generate again (or stays ERROR)

    rows = await _captions(engine, sid)
    assert rows["en"].status == CaptionStatus.ERROR
    assert rows["fr"].status == CaptionStatus.ERROR


async def test_auto_generate_off_creates_nothing(client, engine, monkeypatch):
    monkeypatch.setattr(captions_service.settings, "captions_auto_generate", False)
    _, sid, uid = await _ready_video(client, engine)
    assert await _captions(engine, sid) == {}
    assert await stream_module.get_provider().list_captions(uid=uid) == []


# ── staff endpoints ───────────────────────────────────────────────────────────
async def test_list_captions_endpoint(client, engine):
    ed, sid, _ = await _ready_video(client, engine)
    r = await client.get(f"/api/v1/sermons/{sid}/captions", headers=ed)
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True
    assert body["default_language"] == "en"
    assert [(c["language"], c["status"], c["source"]) for c in body["captions"]] == [
        ("en", "generating", "generated"),
        ("fr", "pending", "translated"),
    ]


async def test_viewer_and_other_editor_cannot_manage_captions(client, engine):
    _, sid, _ = await _ready_video(client, engine)
    viewer = await make_viewer(client)
    assert (await client.get(f"/api/v1/sermons/{sid}/captions", headers=viewer)).status_code == 403
    other = await make_user(client, engine, "other@example.com", "editor")
    r = await client.put(
        f"/api/v1/sermons/{sid}/captions/en", json={"vtt": GOOD_VTT}, headers=other
    )
    assert r.status_code in (403, 404)


async def test_upload_english_requeues_machine_french(client, engine):
    ed, sid, uid = await _ready_video(client, engine)
    stream_module.get_provider().set_caption_status(uid, "en", "ready")
    await _advance(engine)

    r = await client.put(
        f"/api/v1/sermons/{sid}/captions/en", json={"vtt": GOOD_VTT}, headers=ed
    )
    assert r.status_code == 200, r.text
    assert r.json()["source"] == "uploaded"
    assert r.json()["status"] == "ready"

    rows = await _captions(engine, sid)
    assert rows["fr"].status == CaptionStatus.PENDING

    await _advance(engine)
    french = await stream_module.get_provider().get_captions_vtt(uid=uid, language="fr")
    assert "[fr] Grace and peace" in french

    # The uploaded English is never replaced by automation.
    await _advance(engine)
    english = await stream_module.get_provider().get_captions_vtt(uid=uid, language="en")
    assert "Grace and peace" in english
    rows = await _captions(engine, sid)
    assert rows["en"].source == CaptionSource.UPLOADED


async def test_uploaded_french_survives_english_upload(client, engine):
    ed, sid, uid = await _ready_video(client, engine)
    french_vtt = GOOD_VTT.replace("Grace and peace to you all.", "Grâce et paix à vous.")
    r = await client.put(
        f"/api/v1/sermons/{sid}/captions/fr", json={"vtt": french_vtt}, headers=ed
    )
    assert r.status_code == 200
    await client.put(f"/api/v1/sermons/{sid}/captions/en", json={"vtt": GOOD_VTT}, headers=ed)
    await _advance(engine)

    rows = await _captions(engine, sid)
    assert rows["fr"].source == CaptionSource.UPLOADED
    got = await stream_module.get_provider().get_captions_vtt(uid=uid, language="fr")
    assert "Grâce et paix" in got


async def test_upload_rejects_bad_files_and_languages(client, engine):
    ed, sid, _ = await _ready_video(client, engine)
    bad = await client.put(
        f"/api/v1/sermons/{sid}/captions/en", json={"vtt": "1\n00:00:01,000 --> x\nhi"}, headers=ed
    )
    assert bad.status_code == 422
    empty = await client.put(
        f"/api/v1/sermons/{sid}/captions/en", json={"vtt": "WEBVTT\n\n"}, headers=ed
    )
    assert empty.status_code == 422
    lang = await client.put(
        f"/api/v1/sermons/{sid}/captions/de", json={"vtt": GOOD_VTT}, headers=ed
    )
    assert lang.status_code == 422


async def test_upload_needs_a_processed_video(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    r = await client.put(
        f"/api/v1/sermons/{sid}/captions/en", json={"vtt": GOOD_VTT}, headers=ed
    )
    assert r.status_code == 409


async def test_download_vtt(client, engine):
    ed, sid, _ = await _ready_video(client, engine)
    r = await client.get(f"/api/v1/sermons/{sid}/captions/en/vtt", headers=ed)
    assert r.status_code == 200
    assert r.json()["vtt"].startswith("WEBVTT")
    missing = await client.get(f"/api/v1/sermons/{sid}/captions/fr/vtt", headers=ed)
    assert missing.status_code == 404


async def test_regenerate_english_after_upload(client, engine):
    ed, sid, uid = await _ready_video(client, engine)
    await client.put(f"/api/v1/sermons/{sid}/captions/en", json={"vtt": GOOD_VTT}, headers=ed)

    r = await client.post(f"/api/v1/sermons/{sid}/captions/en/regenerate", headers=ed)
    assert r.status_code == 200
    assert r.json() == {**r.json(), "status": "generating", "source": "generated"}
    tracks = await stream_module.get_provider().list_captions(uid=uid)
    assert ("en", "inprogress") in [(t.language, t.status) for t in tracks]


async def test_regenerate_french_retranslates(client, engine):
    ed, sid, uid = await _ready_video(client, engine)
    stream_module.get_provider().set_caption_status(uid, "en", "ready")
    await client.put(f"/api/v1/sermons/{sid}/captions/fr", json={"vtt": GOOD_VTT}, headers=ed)

    r = await client.post(f"/api/v1/sermons/{sid}/captions/fr/regenerate", headers=ed)
    assert r.status_code == 200
    assert r.json()["source"] == "translated"
    assert r.json()["status"] == "pending"
    await _advance(engine)
    rows = await _captions(engine, sid)
    assert rows["fr"].status == CaptionStatus.READY
    got = await stream_module.get_provider().get_captions_vtt(uid=uid, language="fr")
    assert "[fr]" in got


async def test_backfill_queues_old_videos(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)
    uid = await _uid(engine, sid)
    stream_module.get_provider().set_status(
        uid, stream_module.StreamStatus(uid=uid, state="ready", ready_to_stream=True)
    )

    async with _session(engine) as s:
        assert await captions_service.backfill_captions(s, execute=False) == 1
    assert await _captions(engine, sid) == {}
    async with _session(engine) as s:
        assert await captions_service.backfill_captions(s, execute=True) == 1
    rows = await _captions(engine, sid)
    assert set(rows) == {"en", "fr"}
    await _advance(engine)
    rows = await _captions(engine, sid)
    assert rows["en"].status == CaptionStatus.GENERATING
