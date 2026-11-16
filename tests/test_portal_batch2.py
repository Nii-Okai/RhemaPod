"""GATE 3 Batch 2 — backend contract for the admin portal's sermon editor.

Covers:
  * workflow-aware GET /sermons/{id} (staff, any status, editor-scoped)
  * approval-log readable by the owning editor
  * the withdraw transition + its route
  * UploadJobPublic carrying original_filename / content_type / size_bytes
"""
import pytest

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"
VIDEO = {"filename": "sermon.mp4", "content_type": "video/mp4", "media_type": "video"}


async def make_user(client, engine, email, role):
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await s.execute(
            text("UPDATE users SET role = :r WHERE email = :e"),
            {"r": role.upper(), "e": email},
        )
        await s.commit()
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": email, "password": PW}
    )).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


# ── 1. workflow-aware staff GET /sermons/{id} ────────────────────────────────
async def test_editor_can_read_own_draft(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "My draft"}, headers=ed
    )).json()["id"]

    r = await client.get(f"/api/v1/sermons/{sid}", headers=ed)
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == sid
    assert body["status"] == "draft"
    # The editor "saved N min ago" stamp needs a server baseline.
    assert "updated_at" in body


async def test_editor_gets_404_not_403_for_another_editors_sermon(client, engine):
    a = await make_user(client, engine, "a@example.com", "editor")
    b = await make_user(client, engine, "b@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "A's work"}, headers=a
    )).json()["id"]

    r = await client.get(f"/api/v1/sermons/{sid}", headers=b)
    # 404, not 403 — an editor must not be able to tell the sermon exists.
    assert r.status_code == 404


async def test_manager_can_read_any_editors_draft(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Editor draft"}, headers=ed
    )).json()["id"]

    r = await client.get(f"/api/v1/sermons/{sid}", headers=mgr)
    assert r.status_code == 200
    assert r.json()["status"] == "draft"


async def test_staff_get_missing_sermon_is_404(client, engine):
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    r = await client.get(
        "/api/v1/sermons/00000000-0000-0000-0000-000000000000", headers=mgr
    )
    assert r.status_code == 404


async def test_staff_get_requires_editor_plus(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]
    await client.post(
        "/api/v1/auth/register", json={"email": "v@example.com", "password": PW}
    )
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": "v@example.com", "password": PW}
    )).json()
    viewer = {"Authorization": f"Bearer {tokens['access_token']}"}

    r = await client.get(f"/api/v1/sermons/{sid}", headers=viewer)
    assert r.status_code == 403


# ── 2. approval log readable by the owning editor ────────────────────────────
async def test_owning_editor_reads_own_approval_log(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Under review"}, headers=ed
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(
        f"/api/v1/approvals/sermons/{sid}/reject",
        json={"note": "Fix the title"}, headers=mgr,
    )

    r = await client.get(
        f"/api/v1/approvals/sermons/{sid}/approval-log", headers=ed
    )
    assert r.status_code == 200
    log = r.json()
    # The editor can now read why it was rejected.
    assert any(row["to_status"] == "rejected" and row["note"] == "Fix the title"
               for row in log)


async def test_editor_cannot_read_another_editors_approval_log(client, engine):
    a = await make_user(client, engine, "a@example.com", "editor")
    b = await make_user(client, engine, "b@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "A's"}, headers=a
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=a)

    r = await client.get(
        f"/api/v1/approvals/sermons/{sid}/approval-log", headers=b
    )
    # 404, not 403 — same non-disclosure rule as the staff GET.
    assert r.status_code == 404


async def test_manager_still_reads_any_approval_log(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)

    r = await client.get(
        f"/api/v1/approvals/sermons/{sid}/approval-log", headers=mgr
    )
    assert r.status_code == 200
    assert r.json()[0]["to_status"] == "pending_review"


# ── 3. withdraw transition + route ──────────────────────────────────────────
async def test_owner_withdraws_from_pending_review(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)

    r = await client.post(f"/api/v1/sermons/{sid}/withdraw", headers=ed)
    assert r.status_code == 200
    assert r.json()["status"] == "draft"

    # It wrote an ApprovalLog row like every other transition.
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    log = (await client.get(
        f"/api/v1/approvals/sermons/{sid}/approval-log", headers=mgr
    )).json()
    assert log[-1]["from_status"] == "pending_review"
    assert log[-1]["to_status"] == "draft"


async def test_editor_refused_withdraw_from_under_review(client, engine):
    """Isaac's call: once a manager has picked it up (UNDER_REVIEW), only a
    manager/admin can send it back — an editor gets a typed 409, not a
    withdraw. Stops an editor looping withdraw→edit→resubmit past a reviewer's
    note."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr)

    r = await client.post(f"/api/v1/sermons/{sid}/withdraw", headers=ed)
    assert r.status_code == 409
    assert "manager" in r.json()["detail"].lower()
    # It did not move.
    assert (await client.get(
        f"/api/v1/sermons/{sid}", headers=mgr
    )).json()["status"] == "under_review"


async def test_manager_withdraws_from_under_review(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr)

    r = await client.post(f"/api/v1/sermons/{sid}/withdraw", headers=mgr)
    assert r.status_code == 200
    assert r.json()["status"] == "draft"


async def test_editor_cannot_withdraw_another_editors_sermon(client, engine):
    a = await make_user(client, engine, "a@example.com", "editor")
    b = await make_user(client, engine, "b@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "A's"}, headers=a
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=a)

    r = await client.post(f"/api/v1/sermons/{sid}/withdraw", headers=b)
    # 404 — do not confirm the sermon exists to a non-owner editor.
    assert r.status_code == 404
    # And it did not move.
    assert (await client.get(
        f"/api/v1/sermons/{sid}", headers=a
    )).json()["status"] == "pending_review"


async def test_editor_submit_of_another_editors_sermon_is_404_not_403(client, engine):
    """The editor-not-owner case is now normalised to 404 for EVERY
    editor-reachable transition, `submit` included (was 403) — a probing
    editor can't tell "exists, forbidden" from "missing"."""
    a = await make_user(client, engine, "a@example.com", "editor")
    b = await make_user(client, engine, "b@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "A's"}, headers=a
    )).json()["id"]

    r = await client.post(f"/api/v1/sermons/{sid}/submit", headers=b)
    assert r.status_code == 404
    assert r.json()["detail"] == "Sermon not found"


async def test_withdraw_from_draft_is_rejected_with_typed_error(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]

    r = await client.post(f"/api/v1/sermons/{sid}/withdraw", headers=ed)
    assert r.status_code == 409
    assert "withdraw" in r.json()["detail"].lower()


async def test_manager_can_withdraw_any_sermon(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)

    r = await client.post(f"/api/v1/sermons/{sid}/withdraw", headers=mgr)
    assert r.status_code == 200
    assert r.json()["status"] == "draft"


# ── 4. UploadJobPublic carries filename + content type + size ────────────────
async def test_upload_job_public_exposes_filename_and_size(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]

    payload = {**VIDEO, "filename": "the-good-sermon.mp4", "size_bytes": 1234567}
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=payload, headers=ed
    )).json()

    jobs = (await client.get(
        f"/api/v1/sermons/{sid}/uploads", headers=ed
    )).json()
    assert len(jobs) == 1
    job = jobs[0]
    assert job["id"] == ticket["job_id"]
    assert job["original_filename"] == "the-good-sermon.mp4"
    assert job["content_type"] == "video/mp4"
    assert job["size_bytes"] == 1234567


async def test_upload_job_public_size_is_null_when_client_omits_it(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]

    await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed
    )
    job = (await client.get(
        f"/api/v1/sermons/{sid}/uploads", headers=ed
    )).json()[0]
    assert job["size_bytes"] is None
    assert job["original_filename"] == "sermon.mp4"


async def test_confirm_response_also_carries_the_new_fields(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]
    payload = {**VIDEO, "filename": "x.mp4", "size_bytes": 999}
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=payload, headers=ed
    )).json()

    confirm = await client.post(
        f"/api/v1/uploads/{ticket['job_id']}/confirm", headers=ed
    )
    assert confirm.status_code == 200
    body = confirm.json()
    assert body["original_filename"] == "x.mp4"
    assert body["size_bytes"] == 999


async def test_size_bytes_above_int4_ceiling_round_trips(client, engine):
    """A declared size past the INT4 ceiling (2**31-1) must persist intact —
    this is the sole reason UploadJob.size_bytes is BigInteger, not Integer.
    2**32 (~4.29 GB) is over INT4 but under the 5 GB upload cap."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]

    big = 2 ** 32
    payload = {**VIDEO, "filename": "huge.mp4", "size_bytes": big}
    r = await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=payload, headers=ed
    )
    assert r.status_code == 201
    job = (await client.get(
        f"/api/v1/sermons/{sid}/uploads", headers=ed
    )).json()[0]
    assert job["size_bytes"] == big


# ── 5. confirm-time size cap is enforced against the real object ─────────────
async def test_confirm_rejects_upload_that_exceeds_cap_and_deletes_object(
    client, engine, monkeypatch
):
    """The declared `size_bytes` is advisory — a client can declare 1 and PUT
    5 GB. At confirm, the real object length is read from storage; over the cap
    it is deleted and the confirm 413s, leaving the job un-ready."""
    from app.core import storage as storage_module

    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]

    payload = {**VIDEO, "filename": "tiny-lie.mp4", "size_bytes": 1}
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=payload, headers=ed
    )).json()

    store = storage_module.get_storage()
    six_gb = 6 * 1024 ** 3
    monkeypatch.setattr(store, "object_size", lambda b, k: six_gb)

    confirm = await client.post(
        f"/api/v1/uploads/{ticket['job_id']}/confirm", headers=ed
    )
    assert confirm.status_code == 413

    # The oversized object was deleted...
    raw_key = ticket["raw_key"]
    from app.core.config import get_settings
    assert not store.object_exists(get_settings().object_store_raw_bucket, raw_key)

    # ...and the job never reached a ready/uploaded state.
    job = (await client.get(
        f"/api/v1/sermons/{sid}/uploads", headers=ed
    )).json()[0]
    assert job["status"] not in ("ready", "uploaded")


async def test_confirm_persists_the_observed_size_over_the_declared_one(
    client, engine, monkeypatch
):
    """A within-cap upload records the storage-observed length, overriding
    whatever the client declared at presign time."""
    from app.core import storage as storage_module

    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]

    payload = {**VIDEO, "filename": "real.mp4", "size_bytes": 10}
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=payload, headers=ed
    )).json()

    store = storage_module.get_storage()
    observed = 4242
    monkeypatch.setattr(store, "object_size", lambda b, k: observed)

    confirm = await client.post(
        f"/api/v1/uploads/{ticket['job_id']}/confirm", headers=ed
    )
    assert confirm.status_code == 200
    assert confirm.json()["size_bytes"] == observed
