import pytest

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"


async def make_user(client, engine, email, role):
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await s.execute(
            text("UPDATE users SET role = :role WHERE email = :email"),
            {"role": role.upper(), "email": email},
        )
        await s.commit()
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": email, "password": PW}
    )).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def make_viewer(client, email="viewer@example.com"):
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": email, "password": PW}
    )).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


VIDEO = {"filename": "sermon.mp4", "content_type": "video/mp4", "media_type": "video"}


async def upload_and_process(client, headers, sid, payload=None):
    """Full upload flow: ticket -> (stub storage auto-'uploads') -> confirm."""
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=payload or VIDEO, headers=headers
    )).json()
    confirm = await client.post(
        f"/api/v1/uploads/{ticket['job_id']}/confirm", headers=headers
    )
    return ticket, confirm


async def publish(client, editor, manager, sid):
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=editor)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=manager)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=manager)


# ── upload ticket ─────────────────────────────────────────────────────────────
async def test_upload_ticket_issued(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]

    r = await client.post(f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed)
    assert r.status_code == 201
    body = r.json()
    assert body["upload_url"].startswith("https://")
    assert body["method"] == "PUT"
    assert body["headers"]["Content-Type"] == "video/mp4"
    assert body["raw_key"].startswith(f"raw/{sid}/")


async def test_viewer_cannot_request_upload(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    viewer = await make_viewer(client)
    r = await client.post(f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=viewer)
    assert r.status_code == 403


async def test_editor_cannot_upload_to_others_sermon(client, engine):
    a = await make_user(client, engine, "a@example.com", "editor")
    b = await make_user(client, engine, "b@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "A"}, headers=a)).json()["id"]
    r = await client.post(f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=b)
    assert r.status_code == 403


async def test_rejects_bad_content_type(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    r = await client.post(
        f"/api/v1/sermons/{sid}/upload-url",
        json={"filename": "x.exe", "content_type": "application/x-msdownload",
              "media_type": "video"},
        headers=ed,
    )
    assert r.status_code == 400


async def test_rejects_oversized_file(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    r = await client.post(
        f"/api/v1/sermons/{sid}/upload-url",
        json={**VIDEO, "size_bytes": 99 * 1024 ** 3},
        headers=ed,
    )
    assert r.status_code == 413


async def test_cannot_upload_to_published_sermon(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)
    await publish(client, ed, mgr, sid)

    r = await client.post(f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed)
    assert r.status_code == 409


# ── confirm + processing ──────────────────────────────────────────────────────
async def test_confirm_processes_and_creates_media_refs(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    _, confirm = await upload_and_process(client, ed, sid)
    assert confirm.status_code == 200
    assert confirm.json()["status"] == "ready"

    # Media refs now exist on the sermon detail.
    detail = (await client.get(f"/api/v1/sermons/{sid}", headers=ed))
    # staff detail route may differ; check via uploads list instead
    jobs = (await client.get(f"/api/v1/sermons/{sid}/uploads", headers=ed)).json()
    assert len(jobs) == 1 and jobs[0]["status"] == "ready"


async def test_confirm_fails_when_object_missing(client, engine, monkeypatch):
    """Never mark an upload complete on the client's word alone."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed
    )).json()

    from app.core import storage as storage_module
    store = storage_module.get_storage()
    monkeypatch.setattr(store, "object_exists", lambda b, k: False)

    r = await client.post(f"/api/v1/uploads/{ticket['job_id']}/confirm", headers=ed)
    assert r.status_code == 409


async def test_double_confirm_rejected(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    ticket, first = await upload_and_process(client, ed, sid)
    assert first.status_code == 200
    again = await client.post(f"/api/v1/uploads/{ticket['job_id']}/confirm", headers=ed)
    assert again.status_code == 409


async def test_transcode_failure_marks_job_failed(client, engine, monkeypatch):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed
    )).json()

    from app.services import media_service

    async def boom(job):
        raise RuntimeError("ffmpeg exploded")

    monkeypatch.setattr(media_service, "_transcode", boom)
    r = await client.post(f"/api/v1/uploads/{ticket['job_id']}/confirm", headers=ed)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "failed"
    assert "ffmpeg exploded" in body["error_message"]


# ── streaming ─────────────────────────────────────────────────────────────────
async def test_stream_free_sermon(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Free", "tier": "free"}, headers=ed
    )).json()["id"]
    await upload_and_process(client, ed, sid)
    await publish(client, ed, mgr, sid)

    viewer = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/stream", headers=viewer)
    assert r.status_code == 200
    body = r.json()
    assert body["variants"]
    # Passthrough mode serves the original as a single unlabelled rendition.
    assert len(body["variants"]) == 1
    assert body["variants"][0]["quality"] is None


async def test_free_tier_quality_cap_when_transcoding(client, engine, monkeypatch):
    """With a real HLS ladder, non-subscribers are capped at 480p."""
    from app.services import media_service

    monkeypatch.setattr(media_service.settings, "transcode_enabled", True)

    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Free", "tier": "free"}, headers=ed
    )).json()["id"]
    await upload_and_process(client, ed, sid)
    await publish(client, ed, mgr, sid)

    viewer = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/stream", headers=viewer)
    assert r.status_code == 200
    variants = r.json()["variants"]
    assert variants and all(v["quality"] == "480p" for v in variants)


async def test_stream_paid_sermon_blocked_for_viewer(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Paid", "tier": "paid"}, headers=ed
    )).json()["id"]
    await upload_and_process(client, ed, sid)
    await publish(client, ed, mgr, sid)

    viewer = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/stream", headers=viewer)
    assert r.status_code == 403
    assert r.json()["detail"]["upgrade_required"] is True


async def test_paid_sermon_still_visible_in_catalog(client, engine):
    """Visible but gated: the catalog lists it, only playback is refused."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Paid", "tier": "paid"}, headers=ed
    )).json()["id"]
    await upload_and_process(client, ed, sid)
    await publish(client, ed, mgr, sid)

    listing = (await client.get("/api/v1/catalog/sermons")).json()
    item = next(i for i in listing if i["id"] == sid)
    assert item["locked"] is True


async def test_stream_unpublished_hidden_from_viewer(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)

    viewer = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/stream", headers=viewer)
    assert r.status_code == 404


async def test_staff_can_preview_unpublished_stream(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)
    r = await client.get(f"/api/v1/sermons/{sid}/stream", headers=ed)
    assert r.status_code == 200


async def test_editor_cannot_preview_another_editors_unpublished_stream(client, engine):
    """BOLA guard: an editor may stream only their OWN unpublished sermon (or a
    published one). Another editor's draft is 404 — the same non-disclosure the
    staff GET applies. Manager/admin are unrestricted."""
    a = await make_user(client, engine, "a@example.com", "editor")
    b = await make_user(client, engine, "b@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post("/api/v1/sermons", json={"title": "A"}, headers=a)).json()["id"]
    await upload_and_process(client, a, sid)

    assert (await client.get(f"/api/v1/sermons/{sid}/stream", headers=b)).status_code == 404
    # Owner and manager still get playback URLs.
    assert (await client.get(f"/api/v1/sermons/{sid}/stream", headers=a)).status_code == 200
    assert (await client.get(f"/api/v1/sermons/{sid}/stream", headers=mgr)).status_code == 200


async def test_stream_without_media_returns_409(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post("/api/v1/sermons", json={"title": "No media"}, headers=ed)).json()["id"]
    await publish(client, ed, mgr, sid)
    viewer = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/stream", headers=viewer)
    assert r.status_code == 409


# ═══════════════════════════════════════════════════════════════════════════════
# Media management: list and delete renditions
# ═══════════════════════════════════════════════════════════════════════════════
AUDIO = {"filename": "sermon.mp3", "content_type": "audio/mpeg", "media_type": "audio"}


async def test_list_media_after_upload(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)

    r = await client.get(f"/api/v1/sermons/{sid}/media", headers=ed)
    assert r.status_code == 200
    refs = r.json()
    assert len(refs) == 1
    assert refs[0]["type"] == "video"


async def test_video_and_audio_coexist(client, engine):
    """Uploading audio must not wipe the video rendition."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)
    await upload_and_process(client, ed, sid, payload=AUDIO)

    refs = (await client.get(f"/api/v1/sermons/{sid}/media", headers=ed)).json()
    assert {r["type"] for r in refs} == {"video", "audio"}


async def test_delete_single_media_ref(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)
    await upload_and_process(client, ed, sid, payload=AUDIO)

    refs = (await client.get(f"/api/v1/sermons/{sid}/media", headers=ed)).json()
    audio = next(r for r in refs if r["type"] == "audio")

    r = await client.delete(
        f"/api/v1/sermons/{sid}/media/{audio['id']}", headers=ed
    )
    assert r.status_code == 204

    remaining = (await client.get(f"/api/v1/sermons/{sid}/media", headers=ed)).json()
    assert len(remaining) == 1 and remaining[0]["type"] == "video"


async def test_delete_media_by_type(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)
    await upload_and_process(client, ed, sid, payload=AUDIO)

    r = await client.delete(
        f"/api/v1/sermons/{sid}/media", params={"media_type": "audio"}, headers=ed
    )
    assert r.status_code == 204
    refs = (await client.get(f"/api/v1/sermons/{sid}/media", headers=ed)).json()
    assert {x["type"] for x in refs} == {"video"}


async def test_delete_media_removes_stored_object(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)

    from app.core import storage as storage_module
    store = storage_module.get_storage()

    refs = (await client.get(f"/api/v1/sermons/{sid}/media", headers=ed)).json()
    key = refs[0]["s3_key"]
    bucket = _bucket_for(key)
    assert store.object_exists(bucket, key)

    await client.delete(f"/api/v1/sermons/{sid}/media/{refs[0]['id']}", headers=ed)
    assert not store.object_exists(bucket, key)


def _bucket_for(key: str) -> str:
    from app.core.config import get_settings

    s = get_settings()
    return s.s3_raw_bucket if key.startswith("raw/") else s.s3_media_bucket


async def test_delete_can_keep_stored_object(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)

    from app.core import storage as storage_module
    store = storage_module.get_storage()
    refs = (await client.get(f"/api/v1/sermons/{sid}/media", headers=ed)).json()
    key = refs[0]["s3_key"]
    bucket = _bucket_for(key)

    await client.delete(
        f"/api/v1/sermons/{sid}/media/{refs[0]['id']}",
        params={"purge_object": "false"}, headers=ed,
    )
    assert store.object_exists(bucket, key)


async def test_cannot_delete_media_while_published(client, engine):
    """Removing a rendition mid-playback would break active viewers."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)
    refs = (await client.get(f"/api/v1/sermons/{sid}/media", headers=ed)).json()
    await publish(client, ed, mgr, sid)

    r = await client.delete(f"/api/v1/sermons/{sid}/media/{refs[0]['id']}", headers=ed)
    assert r.status_code == 409

    await client.post(f"/api/v1/approvals/sermons/{sid}/unpublish", headers=mgr)
    r = await client.delete(f"/api/v1/sermons/{sid}/media/{refs[0]['id']}", headers=ed)
    assert r.status_code == 204


async def test_editor_cannot_delete_others_media(client, engine):
    a = await make_user(client, engine, "a@example.com", "editor")
    b = await make_user(client, engine, "b@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "A"}, headers=a)).json()["id"]
    await upload_and_process(client, a, sid)
    refs = (await client.get(f"/api/v1/sermons/{sid}/media", headers=a)).json()

    r = await client.delete(f"/api/v1/sermons/{sid}/media/{refs[0]['id']}", headers=b)
    assert r.status_code == 403


async def test_viewer_cannot_list_media(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    viewer = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/media", headers=viewer)
    assert r.status_code == 403


async def test_delete_unknown_media_ref_404(client, engine):
    import uuid as _uuid

    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    r = await client.delete(
        f"/api/v1/sermons/{sid}/media/{_uuid.uuid4()}", headers=ed
    )
    assert r.status_code == 404


async def test_delete_by_type_when_none_404(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)
    r = await client.delete(
        f"/api/v1/sermons/{sid}/media", params={"media_type": "audio"}, headers=ed
    )
    assert r.status_code == 404
