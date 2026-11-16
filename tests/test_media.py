import uuid

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


async def test_stream_url_falls_back_to_presigned_when_cdn_set_without_signing(
    client, engine, monkeypatch
):
    """Regression test for the CDN bypass: cdn_base_url set but no CDN
    signing exists must never produce a bare, unsigned CDN URL — a
    deterministic, publicly-guessable key (media_key()) plus an unsigned URL
    lets anyone edit the quality segment and bypass the paid-tier gate.

    Uses AUDIO specifically: video goes through Cloudflare Stream ingest on
    confirm (W1.1-W1.4) and, once stream_uid is set, get_stream serves a
    Stream URL instead of ever reaching this S3/CDN code path at all (W1.5)
    — audio is what stays on the presigned-S3 path this test is actually
    checking."""
    from app.services import media_service

    monkeypatch.setattr(media_service.settings, "cdn_base_url", "https://cdn.example.com")

    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Free", "tier": "free"}, headers=ed
    )).json()["id"]
    await upload_and_process(client, ed, sid, payload=AUDIO)
    await publish(client, ed, mgr, sid)

    viewer = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/stream", headers=viewer)
    assert r.status_code == 200
    url = r.json()["variants"][0]["url"]
    assert "cdn.example.com" not in url
    assert "local-storage.invalid" in url  # still the presigned stub URL


async def test_full_ladder_returned_unfiltered_when_transcoding(client, engine, monkeypatch):
    """W1.5 (plan L10): the old free-tier 480p cap is gone — Stream owns the
    rendition ladder now, so every rendition goes to every viewer regardless
    of subscription. This also exercises the presigned-S3 fallback for
    video: a real HLS ladder produces 3 MediaRef rows for one job, which
    _start_stream_ingest deliberately skips (no single well-defined Stream
    target for an ambiguous ladder — W1.1-W1.4), so none of them ever get a
    stream_uid."""
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
    assert {v["quality"] for v in variants} == {"1080p", "720p", "480p"}
    # No stream_uid on any of them (ambiguous-ladder skip) -> presigned S3,
    # not a Stream URL.
    assert all("local-storage.invalid" in v["url"] for v in variants)


async def test_stream_falls_back_to_presigned_when_video_not_yet_ingested(
    client, engine, monkeypatch
):
    """A video whose Stream ingest never produced a uid — the pre-backfill
    (W1.9) case for every sermon uploaded before this pipeline existed, or
    any ingest kickoff that failed — must still stream via the pre-Stream
    presigned-S3 path, unchanged. This is what makes the incremental
    rollout safe: nothing needs a stream_uid to stay playable."""
    from app.core import stream as stream_module

    async def boom(self, *, source_url, meta=None):
        raise stream_module.StreamError("simulated Cloudflare outage")

    monkeypatch.setattr(stream_module.LocalStream, "start_ingest", boom)

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
    assert len(variants) == 1
    assert "local-storage.invalid" in variants[0]["url"]


async def test_stream_falls_back_to_presigned_on_malformed_signing_key(
    client, engine, monkeypatch
):
    """A stream_uid IS set (ingest succeeded) but the signing key is
    PRESENT and MALFORMED -- e.g. newlines not folded correctly when
    hand-pasted (DEPLOYMENT.md §12 step 5), the likely real-world mistake
    since a human pastes this key once, by hand. jwt.encode raises straight
    from PyJWT/cryptography (InvalidKeyError, or a bare TypeError for an
    encrypted key) rather than this codebase's own StreamError, so this must
    be normalized in CloudflareStreamProvider.signed_playback_url -- without
    that, this case 500s instead of degrading to presigned S3 the way the
    unconfigured-key case already does. Exercises the full HTTP path, not
    just the provider unit, so the actual client-visible response is
    asserted, not just that signing doesn't raise."""
    from app.core import stream as stream_module

    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Free", "tier": "free"}, headers=ed
    )).json()["id"]
    await upload_and_process(client, ed, sid)
    await publish(client, ed, mgr, sid)

    # Ingest above ran against the LocalStream stub and set a real
    # stream_uid. Now swap in a CloudflareStreamProvider with a malformed
    # signing key -- only for playback resolution, ingest has already
    # happened -- to simulate the misconfigured-key case at request time.
    bad_provider = stream_module.CloudflareStreamProvider.__new__(
        stream_module.CloudflareStreamProvider
    )
    monkeypatch.setattr(stream_module.settings, "cf_stream_signing_key_id", "key123")
    monkeypatch.setattr(
        stream_module.settings, "cf_stream_signing_key_pem", "not-a-valid-pem"
    )
    monkeypatch.setattr(stream_module.settings, "cf_stream_customer_subdomain", "abcxyz")
    monkeypatch.setattr(stream_module, "get_provider", lambda: bad_provider)

    viewer = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/stream", headers=viewer)
    assert r.status_code == 200
    variants = r.json()["variants"]
    assert len(variants) == 1
    assert "local-storage.invalid" in variants[0]["url"]
    assert "cloudflarestream.com" not in variants[0]["url"]


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
# Audio download (W1.6) — GET /sermons/{id}/download/audio
# ═══════════════════════════════════════════════════════════════════════════════
async def test_audio_download_free_sermon(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Free", "tier": "free"}, headers=ed
    )).json()["id"]
    await upload_and_process(client, ed, sid, payload=AUDIO)
    await publish(client, ed, mgr, sid)

    viewer = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/download/audio", headers=viewer)
    assert r.status_code == 200
    body = r.json()
    assert body["sermon_id"] == sid
    assert "local-storage.invalid" in body["url"]  # presigned S3 stub, unchanged
    from app.core.config import get_settings

    assert body["expires_in"] == get_settings().stream_url_expire_seconds


async def test_audio_download_paid_sermon_blocked_for_viewer(client, engine):
    """Authz parity with get_stream: same 403 upgrade_required gate."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Paid", "tier": "paid"}, headers=ed
    )).json()["id"]
    await upload_and_process(client, ed, sid, payload=AUDIO)
    await publish(client, ed, mgr, sid)

    viewer = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/download/audio", headers=viewer)
    assert r.status_code == 403
    assert r.json()["detail"]["upgrade_required"] is True


async def test_audio_download_unpublished_hidden_from_viewer(client, engine):
    """Authz parity with get_stream: same 404 non-disclosure for unpublished."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid, payload=AUDIO)

    viewer = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/download/audio", headers=viewer)
    assert r.status_code == 404


async def test_audio_download_editor_cannot_preview_another_editors_draft(client, engine):
    """Authz parity with get_stream: same BOLA ownership guard."""
    a = await make_user(client, engine, "a@example.com", "editor")
    b = await make_user(client, engine, "b@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post("/api/v1/sermons", json={"title": "A"}, headers=a)).json()["id"]
    await upload_and_process(client, a, sid, payload=AUDIO)

    assert (
        await client.get(f"/api/v1/sermons/{sid}/download/audio", headers=b)
    ).status_code == 404
    assert (
        await client.get(f"/api/v1/sermons/{sid}/download/audio", headers=a)
    ).status_code == 200
    assert (
        await client.get(f"/api/v1/sermons/{sid}/download/audio", headers=mgr)
    ).status_code == 200


async def test_audio_download_returns_409_when_no_audio_rendition(client, engine):
    """Video-only sermon: 409, never a 404 (sermon itself is visible/
    authorized) and never a video URL (L6 — no video path, ever)."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)  # VIDEO only
    await publish(client, ed, mgr, sid)

    viewer = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/download/audio", headers=viewer)
    assert r.status_code == 409


async def test_audio_download_uses_stream_url_when_ingested(client, engine):
    """Not a type-gated special case — _resolve_variant_url is generic on
    stream_uid. Audio never gets a stream_uid through the app's own ingest
    path today (only VIDEO jobs call _start_stream_ingest), but the shared
    helper must still route through Stream for any MediaRef that has one,
    proving the W1.5/W1.6 fallback rule is one rule, not two copies of it."""
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import MediaRef, MediaType

    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Free", "tier": "free"}, headers=ed
    )).json()["id"]
    await upload_and_process(client, ed, sid, payload=AUDIO)
    await publish(client, ed, mgr, sid)

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        ref = (await s.execute(
            select(MediaRef).where(
                MediaRef.sermon_id == uuid.UUID(sid), MediaRef.type == MediaType.AUDIO
            )
        )).scalars().first()
        ref.stream_uid = "stubaudiotestuid0000000000000001"
        await s.commit()

    viewer = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/download/audio", headers=viewer)
    assert r.status_code == 200
    assert "cloudflarestream.test" in r.json()["url"]


async def test_video_download_free_sermon(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Free", "tier": "free"}, headers=ed
    )).json()["id"]
    await upload_and_process(client, ed, sid)  # VIDEO only
    await publish(client, ed, mgr, sid)

    viewer = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/download/video", headers=viewer)
    assert r.status_code == 200
    body = r.json()
    assert body["sermon_id"] == sid
    # Unlike audio, a VIDEO upload auto-ingests into Stream as part of the normal
    # upload/confirm flow (`_start_stream_ingest`), so `_resolve_variant_url` routes
    # through the Stream stub, not the plain S3 presigned URL — proven generically by
    # `test_audio_download_uses_stream_url_when_ingested` for the other direction.
    assert "cloudflarestream.test" in body["url"]
    from app.core.config import get_settings

    assert body["expires_in"] == get_settings().stream_url_expire_seconds


async def test_video_download_paid_sermon_blocked_for_viewer(client, engine):
    """Authz parity with get_stream/get_audio_download: same 403 upgrade_required gate."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Paid", "tier": "paid"}, headers=ed
    )).json()["id"]
    await upload_and_process(client, ed, sid)
    await publish(client, ed, mgr, sid)

    viewer = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/download/video", headers=viewer)
    assert r.status_code == 403
    assert r.json()["detail"]["upgrade_required"] is True


async def test_video_download_unpublished_hidden_from_viewer(client, engine):
    """Authz parity with get_stream: same 404 non-disclosure for unpublished."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)

    viewer = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/download/video", headers=viewer)
    assert r.status_code == 404


async def test_video_download_editor_cannot_preview_another_editors_draft(client, engine):
    """Authz parity with get_stream: same BOLA ownership guard."""
    a = await make_user(client, engine, "a@example.com", "editor")
    b = await make_user(client, engine, "b@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post("/api/v1/sermons", json={"title": "A"}, headers=a)).json()["id"]
    await upload_and_process(client, a, sid)

    assert (
        await client.get(f"/api/v1/sermons/{sid}/download/video", headers=b)
    ).status_code == 404
    assert (
        await client.get(f"/api/v1/sermons/{sid}/download/video", headers=a)
    ).status_code == 200
    assert (
        await client.get(f"/api/v1/sermons/{sid}/download/video", headers=mgr)
    ).status_code == 200


async def test_video_download_returns_409_when_no_video_rendition(client, engine):
    """Audio-only sermon: 409, never a 404 (sermon itself is visible/authorized)
    and never an audio URL from the video endpoint."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid, payload=AUDIO)
    await publish(client, ed, mgr, sid)

    viewer = await make_viewer(client)
    r = await client.get(f"/api/v1/sermons/{sid}/download/video", headers=viewer)
    assert r.status_code == 409


# ═══════════════════════════════════════════════════════════════════════════════
# Media management: list and delete renditions
# ═══════════════════════════════════════════════════════════════════════════════
AUDIO = {"filename": "sermon.mp3", "content_type": "audio/mpeg", "media_type": "audio"}


async def _seed_media_ref(engine, sid, media_type: str):
    """Insert a MediaRef row directly, bypassing process_upload — used only to
    construct a multi-row state for exercising delete_media_ref /
    delete_media_by_type in isolation. Since the single-media-slot fix
    (process_upload now replaces every existing MediaRef for a sermon, not
    just same-type ones), two types can no longer coexist via the real
    upload path, so tests that need two rows present seed the second one
    here instead of via a second upload_and_process call."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import MediaRef, MediaType

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        ref = MediaRef(
            sermon_id=uuid.UUID(sid),
            type=MediaType(media_type),
            s3_key=f"media/{sid}/{media_type}/seed.bin",
        )
        s.add(ref)
        await s.commit()
        return str(ref.id)


async def test_list_media_after_upload(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)

    r = await client.get(f"/api/v1/sermons/{sid}/media", headers=ed)
    assert r.status_code == 200
    refs = r.json()
    assert len(refs) == 1
    assert refs[0]["type"] == "video"


async def test_cross_type_upload_replaces_existing_media(client, engine):
    """Single-media-slot guarantee: a sermon has exactly one media attachment
    (video OR audio) at a time. Uploading AUDIO over an existing VIDEO must
    fully replace it, not leave both as separate playable variants.
    process_upload used to only delete MediaRefs matching the new job's own
    type, leaving the old VIDEO row stale."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)
    await upload_and_process(client, ed, sid, payload=AUDIO)

    refs = (await client.get(f"/api/v1/sermons/{sid}/media", headers=ed)).json()
    assert [r["type"] for r in refs] == ["audio"]


async def test_cross_type_upload_replaces_existing_media_reverse(client, engine):
    """Same guarantee in the other direction: a new VIDEO upload fully
    replaces an existing AUDIO MediaRef."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid, payload=AUDIO)
    await upload_and_process(client, ed, sid)

    refs = (await client.get(f"/api/v1/sermons/{sid}/media", headers=ed)).json()
    assert [r["type"] for r in refs] == ["video"]


async def test_same_type_reupload_still_replaces(client, engine):
    """Regression guard: same-type replacement (the pre-existing behavior,
    unaffected by broadening the delete query to every type) still works
    exactly as it did before the cross-type fix."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)
    first = (await client.get(f"/api/v1/sermons/{sid}/media", headers=ed)).json()
    assert len(first) == 1

    await upload_and_process(client, ed, sid)

    refs = (await client.get(f"/api/v1/sermons/{sid}/media", headers=ed)).json()
    assert len(refs) == 1
    assert refs[0]["type"] == "video"
    assert refs[0]["s3_key"] != first[0]["s3_key"]


async def test_delete_single_media_ref(client, engine):
    """Deleting one specific MediaRef by id leaves any other row alone. The
    second row is seeded directly (bypassing process_upload, which the
    single-media-slot fix no longer lets two types reach via the upload
    path) purely to exercise delete-by-id in isolation."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)
    audio_id = await _seed_media_ref(engine, sid, "audio")

    r = await client.delete(
        f"/api/v1/sermons/{sid}/media/{audio_id}", headers=ed
    )
    assert r.status_code == 204

    remaining = (await client.get(f"/api/v1/sermons/{sid}/media", headers=ed)).json()
    assert len(remaining) == 1 and remaining[0]["type"] == "video"


async def test_delete_media_by_type(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)
    await _seed_media_ref(engine, sid, "audio")

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
    return s.object_store_raw_bucket if key.startswith("raw/") else s.object_store_media_bucket


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


async def test_stream_survives_unparseable_status(client, engine):
    """Same defense-in-depth guarantee as the catalog detail read path (see
    test_crud.test_catalog_detail_survives_unparseable_status), for the
    stream endpoint's own Sermon load in `_authorize_stream_access`: a row
    with a status value that isn't a valid `SermonStatus` member name must
    404, not 500."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        # Bare raw SQL, deliberately bypassing the ORM's Enum type (which
        # would otherwise coerce this back to "DRAFT" on the way in) —
        # exactly the kind of write that produces this data shape in
        # practice. Only one sermon exists in this test, so no WHERE needed.
        await s.execute(text("UPDATE sermons SET status = 'draft'"))
        await s.commit()

    r = await client.get(f"/api/v1/sermons/{sid}/stream", headers=ed)
    assert r.status_code == 404


async def test_unrelated_media_type_corruption_is_not_misreported_as_not_found(
    client, engine
):
    """The targeted raw-`status` check in `_authorize_stream_access` must
    check only `status` and must not be a blanket `except LookupError`
    around the ORM query: `MediaRef.type` is eager-loaded by that same
    query and is the identical kind of ORM `Enum` (no `values_callable`).
    A corrupted `media_refs.type` is a real, different bug and must not be
    silently relabeled as 'sermon not found' — it should surface, same as
    any other unhandled server error would."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "S"}, headers=ed)).json()["id"]
    await upload_and_process(client, ed, sid)

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        # Bare raw SQL, same technique as above, this time on the sibling
        # Enum column eager-loaded in the same query as `status`.
        await s.execute(text("UPDATE media_refs SET type = 'bogus'"))
        await s.commit()

    with pytest.raises(LookupError):
        await client.get(f"/api/v1/sermons/{sid}/stream", headers=ed)
