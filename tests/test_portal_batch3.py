"""GATE 3 Batch 3 — backend contract for the admin portal's review queue (W10)
plus accumulated debt from the W8/W9 reviews.

Covers:
  1. GET /approvals/sermons/review-queue -> Page[ReviewQueueItem]
     (status / submitted_at ordering / renditions_ready / pagination /
     review_claimed_by)
  2. ApprovalLogItem.actor_name (populated + null-safe fallback)
  3. SermonAdminDetail.tier carries the RAW column value (incl. NULL); the
     public SermonDetail keeps the resolved effective tier
  4. DELETE /uploads/{job_id} (owner 204 + object gone; non-owner 404;
     processing -> 409; ready -> 409; unknown -> 404)
  5. Per-sermon open-upload-job cap -> 429; retry rate-limit -> 429
  6. Thumbnail confirm size re-check -> 413 + object deleted
  7. Staging environment preflight promotes the cleartext-S3 checks
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

# asyncio_mode = "auto": async tests here run without an explicit marker, and
# the sync environment-preflight tests at the bottom stay sync.

PW = "correct-horse-battery"
VIDEO = {"filename": "sermon.mp4", "content_type": "video/mp4", "media_type": "video"}
IMG = {"filename": "cover.jpg", "content_type": "image/jpeg"}


async def make_user(client, engine, email, role, full_name=None):
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await s.execute(
            text("UPDATE users SET role = :r WHERE email = :e"),
            {"r": role.upper(), "e": email},
        )
        if full_name is not None:
            await s.execute(
                text("UPDATE users SET full_name = :n WHERE email = :e"),
                {"n": full_name, "e": email},
            )
        await s.commit()
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": email, "password": PW}
    )).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def _new_sermon(client, headers, title="S", **body):
    return (await client.post(
        "/api/v1/sermons", json={"title": title, **body}, headers=headers
    )).json()["id"]


async def _backdate_submission(engine, sermon_id, days):
    """Push a sermon's pending_review ApprovalLog row into the past so the
    queue's oldest-first ordering is deterministic (CURRENT_TIMESTAMP only has
    1s resolution)."""
    from app.models.models import ApprovalLog

    when = datetime.now(timezone.utc) - timedelta(days=days)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        rows = (await s.execute(
            select(ApprovalLog).where(
                ApprovalLog.sermon_id == uuid.UUID(str(sermon_id)),
                ApprovalLog.to_status == "pending_review",
            )
        )).scalars().all()
        for row in rows:
            row.created_at = when
        await s.commit()


async def _force_job_status(engine, job_id, status):
    from app.models.models import UploadJob

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        job = await s.get(UploadJob, uuid.UUID(str(job_id)))
        job.status = status
        await s.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Review-queue payload
# ═══════════════════════════════════════════════════════════════════════════════
async def test_review_queue_is_a_page_envelope_with_workflow_fields(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = await _new_sermon(client, ed, "Queued", description="A sermon on grace")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)

    body = (await client.get(
        "/api/v1/approvals/sermons/review-queue", headers=mgr
    )).json()

    assert set(body) == {"items", "total", "limit", "offset"}
    assert body["total"] == 1
    item = body["items"][0]
    assert item["id"] == sid
    assert item["status"] == "pending_review"
    assert item["submitted_at"] is not None
    assert item["renditions_ready"] == 0
    assert item["review_claimed_by"] is None
    assert item["is_standalone"] is True
    assert item["description"] == "A sermon on grace"
    assert item["tier"] == "free"


async def test_review_queue_orders_oldest_submission_first(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")

    old = await _new_sermon(client, ed, "Waited longest")
    await client.post(f"/api/v1/sermons/{old}/submit", headers=ed)
    await _backdate_submission(engine, old, days=5)

    fresh = await _new_sermon(client, ed, "Just submitted")
    await client.post(f"/api/v1/sermons/{fresh}/submit", headers=ed)

    items = (await client.get(
        "/api/v1/approvals/sermons/review-queue", headers=mgr
    )).json()["items"]

    assert [i["id"] for i in items] == [old, fresh]
    assert items[0]["submitted_at"] < items[1]["submitted_at"]


async def test_review_queue_reports_rendition_count(client, engine):
    from tests.test_media import upload_and_process

    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")

    with_media = await _new_sermon(client, ed, "Has media")
    await upload_and_process(client, ed, with_media)
    await client.post(f"/api/v1/sermons/{with_media}/submit", headers=ed)

    without = await _new_sermon(client, ed, "No media")
    await client.post(f"/api/v1/sermons/{without}/submit", headers=ed)

    items = (await client.get(
        "/api/v1/approvals/sermons/review-queue", headers=mgr
    )).json()["items"]
    by_id = {i["id"]: i for i in items}

    assert by_id[with_media]["renditions_ready"] >= 1
    assert by_id[without]["renditions_ready"] == 0


async def test_review_queue_shows_who_claimed_an_under_review_item(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = await _new_sermon(client, ed, "Picked up")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr)

    item = (await client.get(
        "/api/v1/approvals/sermons/review-queue", headers=mgr
    )).json()["items"][0]

    assert item["status"] == "under_review"
    # mgr@example.com has no full_name -> email local-part.
    assert item["review_claimed_by"] == "mgr"


async def test_review_queue_paginates(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    for n in range(3):
        sid = await _new_sermon(client, ed, f"S{n}")
        await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)

    page1 = (await client.get(
        "/api/v1/approvals/sermons/review-queue?limit=2&offset=0", headers=mgr
    )).json()
    assert page1["total"] == 3
    assert len(page1["items"]) == 2
    assert page1["limit"] == 2 and page1["offset"] == 0

    page2 = (await client.get(
        "/api/v1/approvals/sermons/review-queue?limit=2&offset=2", headers=mgr
    )).json()
    assert page2["total"] == 3
    assert len(page2["items"]) == 1


async def test_review_queue_still_manager_plus(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    r = await client.get("/api/v1/approvals/sermons/review-queue", headers=ed)
    assert r.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# 2. actor_name on the approval log
# ═══════════════════════════════════════════════════════════════════════════════
async def test_approval_log_carries_actor_full_name(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(
        client, engine, "ada@example.com", "manager", full_name="Ada Nwosu"
    )
    sid = await _new_sermon(client, ed, "Rejected work")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(
        f"/api/v1/approvals/sermons/{sid}/reject",
        json={"note": "Fix the title"}, headers=mgr,
    )

    log = (await client.get(
        f"/api/v1/approvals/sermons/{sid}/approval-log", headers=ed
    )).json()
    rejection = next(e for e in log if e["to_status"] == "rejected")
    assert rejection["actor_name"] == "Ada Nwosu"
    assert rejection["actor_id"]  # still present


async def test_approval_log_actor_name_falls_back_to_email_local_part(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")  # no full_name
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = await _new_sermon(client, ed, "S")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)

    log = (await client.get(
        f"/api/v1/approvals/sermons/{sid}/approval-log", headers=mgr
    )).json()
    submit_row = next(e for e in log if e["to_status"] == "pending_review")
    assert submit_row["actor_name"] == "ed"


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Stored tier on SermonAdminDetail
# ═══════════════════════════════════════════════════════════════════════════════
async def test_admin_detail_tier_is_null_when_sermon_inherits(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = await _new_sermon(client, ed, "Inheriting")  # no tier, no series

    body = (await client.get(f"/api/v1/sermons/{sid}", headers=ed)).json()
    assert body["tier"] is None


async def test_admin_detail_tier_carries_explicit_value(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = await _new_sermon(client, ed, "Explicit free", tier="free")

    body = (await client.get(f"/api/v1/sermons/{sid}", headers=ed)).json()
    assert body["tier"] == "free"


async def test_public_detail_keeps_resolved_effective_tier(client, engine):
    """The public SermonDetail must NOT gain the raw-nullable semantics: an
    episode that inherits `paid` from its series reads `paid` there, while the
    staff detail reads NULL."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = (await client.post(
        "/api/v1/series", json={"title": "Paid Series", "tier": "paid"}, headers=ed
    )).json()
    sid = await _new_sermon(client, ed, "Episode", series_id=series["id"])
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)

    staff = (await client.get(f"/api/v1/sermons/{sid}", headers=ed)).json()
    public = (await client.get(f"/api/v1/catalog/sermons/{sid}")).json()

    assert staff["tier"] is None            # raw column
    assert public["tier"] == "paid"         # resolved effective tier


# ═══════════════════════════════════════════════════════════════════════════════
# 4. DELETE /uploads/{job_id}
# ═══════════════════════════════════════════════════════════════════════════════
async def _ticket(client, headers, sid):
    return (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=headers
    )).json()


async def test_owner_deletes_open_job_and_raw_object(client, engine):
    from app.core.config import get_settings
    from app.core import storage as storage_module

    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = await _new_sermon(client, ed, "S")
    ticket = await _ticket(client, ed, sid)

    store = storage_module.get_storage()
    raw_bucket = get_settings().s3_raw_bucket
    assert store.object_exists(raw_bucket, ticket["raw_key"])

    r = await client.delete(f"/api/v1/uploads/{ticket['job_id']}", headers=ed)
    assert r.status_code == 204
    assert not store.object_exists(raw_bucket, ticket["raw_key"])

    jobs = (await client.get(f"/api/v1/sermons/{sid}/uploads", headers=ed)).json()
    assert jobs == []


async def test_non_owner_editor_gets_404(client, engine):
    a = await make_user(client, engine, "a@example.com", "editor")
    b = await make_user(client, engine, "b@example.com", "editor")
    sid = await _new_sermon(client, a, "A's")
    ticket = await _ticket(client, a, sid)

    r = await client.delete(f"/api/v1/uploads/{ticket['job_id']}", headers=b)
    assert r.status_code == 404
    # And it did not delete A's job.
    jobs = (await client.get(f"/api/v1/sermons/{sid}/uploads", headers=a)).json()
    assert len(jobs) == 1


async def test_manager_can_delete_any_editors_job(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = await _new_sermon(client, ed, "S")
    ticket = await _ticket(client, ed, sid)

    r = await client.delete(f"/api/v1/uploads/{ticket['job_id']}", headers=mgr)
    assert r.status_code == 204


async def test_delete_processing_job_is_409(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = await _new_sermon(client, ed, "S")
    ticket = await _ticket(client, ed, sid)

    from app.models.models import UploadStatus
    await _force_job_status(engine, ticket["job_id"], UploadStatus.PROCESSING)

    r = await client.delete(f"/api/v1/uploads/{ticket['job_id']}", headers=ed)
    assert r.status_code == 409
    assert "transcod" in r.json()["detail"].lower()


async def test_delete_ready_job_is_409(client, engine):
    from tests.test_media import upload_and_process

    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = await _new_sermon(client, ed, "S")
    ticket, confirm = await upload_and_process(client, ed, sid)
    assert confirm.json()["status"] == "ready"

    r = await client.delete(f"/api/v1/uploads/{ticket['job_id']}", headers=ed)
    assert r.status_code == 409


async def test_delete_unknown_job_is_404(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    r = await client.delete(
        "/api/v1/uploads/00000000-0000-0000-0000-000000000000", headers=ed
    )
    assert r.status_code == 404


async def test_delete_failed_job_is_allowed(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = await _new_sermon(client, ed, "S")
    ticket = await _ticket(client, ed, sid)

    from app.models.models import UploadStatus
    await _force_job_status(engine, ticket["job_id"], UploadStatus.FAILED)

    r = await client.delete(f"/api/v1/uploads/{ticket['job_id']}", headers=ed)
    assert r.status_code == 204


# ═══════════════════════════════════════════════════════════════════════════════
# 5. Open-job cap + retry rate-limit
# ═══════════════════════════════════════════════════════════════════════════════
async def test_open_upload_job_cap_returns_429(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = await _new_sermon(client, ed, "S")

    # Default cap is 5 open (awaiting_upload) jobs per sermon.
    for _ in range(5):
        r = await client.post(
            f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed
        )
        assert r.status_code == 201

    r = await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed
    )
    assert r.status_code == 429
    assert "in progress" in r.json()["detail"].lower()


async def test_cancelling_a_job_frees_a_slot(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = await _new_sermon(client, ed, "S")
    tickets = []
    for _ in range(5):
        tickets.append(await _ticket(client, ed, sid))

    assert (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed
    )).status_code == 429

    await client.delete(f"/api/v1/uploads/{tickets[0]['job_id']}", headers=ed)

    assert (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed
    )).status_code == 201


async def test_retry_rate_limit_returns_429(client, engine, monkeypatch):
    from app.services import media_service

    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = await _new_sermon(client, ed, "S")

    # Lift the hard cap so the Redis retry limiter is what bites.
    monkeypatch.setattr(media_service.settings, "max_open_upload_jobs_per_sermon", 100)
    monkeypatch.setattr(media_service.settings, "upload_ticket_rate_limit", 2)

    assert (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed
    )).status_code == 201
    assert (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed
    )).status_code == 201
    r = await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed
    )
    assert r.status_code == 429
    assert "wait a moment" in r.json()["detail"].lower()


# ═══════════════════════════════════════════════════════════════════════════════
# 6. Thumbnail confirm size re-check
# ═══════════════════════════════════════════════════════════════════════════════
async def test_oversized_thumbnail_is_rejected_and_deleted(client, engine, monkeypatch):
    from app.core.config import get_settings
    from app.core import storage as storage_module

    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = await _new_sermon(client, ed, "S")
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/thumbnail-url", json=IMG, headers=ed
    )).json()

    store = storage_module.get_storage()
    monkeypatch.setattr(store, "object_size", lambda b, k: 11 * 1024 * 1024)

    r = await client.post(
        f"/api/v1/sermons/{sid}/thumbnail/confirm",
        params={"thumbnail_key": ticket["thumbnail_key"]}, headers=ed,
    )
    assert r.status_code == 413
    assert "10 MB limit" in r.json()["detail"]
    assert not store.object_exists(
        get_settings().s3_media_bucket, ticket["thumbnail_key"]
    )


async def test_within_limit_thumbnail_still_confirms(client, engine, monkeypatch):
    from app.core import storage as storage_module

    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = await _new_sermon(client, ed, "S")
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/thumbnail-url", json=IMG, headers=ed
    )).json()

    store = storage_module.get_storage()
    monkeypatch.setattr(store, "object_size", lambda b, k: 2 * 1024 * 1024)

    r = await client.post(
        f"/api/v1/sermons/{sid}/thumbnail/confirm",
        params={"thumbnail_key": ticket["thumbnail_key"]}, headers=ed,
    )
    assert r.status_code == 200
    assert r.json()["thumbnail_url"]


# ═══════════════════════════════════════════════════════════════════════════════
# 7. Staging environment preflight
# ═══════════════════════════════════════════════════════════════════════════════
_BASE_ENV = {
    "secret_key": "a-sufficiently-long-secret-key-for-tests",
    "database_url": "postgresql+psycopg://u:p@db/app",
    "redis_url": "redis://r:6379/0",
}


def _settings(**overrides):
    from app.core.config import Settings

    return Settings(**{**_BASE_ENV, **overrides})


def test_staging_rejects_cleartext_s3_endpoint_url():
    with pytest.raises(ValueError, match="S3_ENDPOINT_URL"):
        _settings(environment="staging", s3_endpoint_url="http://minio:9000")


def test_staging_allows_https_s3_endpoint_url():
    s = _settings(
        environment="staging", s3_endpoint_url="https://s3.eu-north-1.example.com"
    )
    assert s.s3_endpoint_url == "https://s3.eu-north-1.example.com"


def test_staging_rejects_compose_shim_s3_public_endpoint():
    with pytest.raises(ValueError, match="S3_PUBLIC_ENDPOINT"):
        _settings(environment="staging", s3_public_endpoint="http://minio:9000")


def test_staging_boots_without_object_storage_endpoints():
    s = _settings(environment="staging")
    assert s.environment == "staging"
    assert s.is_internet_reachable is True


def test_development_still_allows_cleartext_s3_endpoint_url():
    s = _settings(environment="development", s3_endpoint_url="http://minio:9000")
    assert s.s3_endpoint_url == "http://minio:9000"
    assert s.is_internet_reachable is False
