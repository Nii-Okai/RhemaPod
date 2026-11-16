"""Scheduled sermon publish — `publish_at`, mirroring the Announcement pattern
exactly: visibility computed at query time from `status` + `publish_at`, no
background worker.

Covers:
  * `publish_at` is NOT settable at create or via general update — the only
    door is the publish review action's body (manager/admin only). A create
    or PATCH carrying it is silently ignored.
  * A published sermon with a future `publish_at` does not appear in the
    public catalog list, detail (404), search, series-episodes, or the
    streaming endpoint — but a manager/admin's staff read always sees it,
    regardless of `publish_at`, and so does the owning editor's own stream.
  * Once `publish_at` passes, it appears everywhere, exactly like a normal
    publish.
  * `publish_at=None` behaves exactly as before (regression).
"""
from datetime import datetime, timedelta, timezone

import pytest

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

# asyncio_mode = "auto" — async tests need no marker.

PW = "correct-horse-battery"


async def make_user(client, engine, email, role):
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
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


def iso(dt):
    return dt.isoformat()


VIDEO = {"filename": "sermon.mp4", "content_type": "video/mp4", "media_type": "video"}


async def _upload_and_process(client, headers, sid, payload=None):
    """Full upload flow: ticket -> (stub storage auto-'uploads') -> confirm.
    Mirrors test_media.py's helper of the same shape."""
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=payload or VIDEO, headers=headers
    )).json()
    return await client.post(
        f"/api/v1/uploads/{ticket['job_id']}/confirm", headers=headers
    )


async def _publish(client, ed, mgr, sid):
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    r = await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)
    assert r.status_code == 200, r.text
    return r.json()


async def _scheduled_sermon(client, ed, mgr, publish_at_iso, title="Scheduled"):
    """Create a sermon (no `publish_at` — that's no longer accepted at
    create), then take it through submit -> approve -> publish, scheduling it
    via the publish action's `publish_at` body param — the only door left."""
    sid = (await client.post(
        "/api/v1/sermons", json={"title": title}, headers=ed,
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/publish",
        json={"publish_at": publish_at_iso},
        headers=mgr,
    )
    assert r.status_code == 200, r.text
    return sid


# ═══════════════════════════════════════════════════════════════════════════════
# publish_at is settable while editable, and visible on staff DTOs
# ═══════════════════════════════════════════════════════════════════════════════
async def test_publish_at_ignored_on_create(client, engine):
    """`SermonCreate` no longer has a `publish_at` field (sermon-schedule-
    publish-authz fix, closed on create too — see
    `test_publish_at_ignored_by_general_update` for the PATCH side) — a POST
    carrying it is an unrecognized field on that schema and is silently
    dropped (this model's existing extra-field behavior; no `extra="forbid"`
    anywhere in this codebase), not a 422. The sermon is created with
    `publish_at` unset; it becomes settable only via the publish review
    action."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    future = iso(datetime.now(timezone.utc) + timedelta(days=1))
    body = (await client.post(
        "/api/v1/sermons", json={"title": "S", "publish_at": future}, headers=ed
    )).json()
    assert body["publish_at"] is None

    staff = (await client.get(f"/api/v1/sermons/{body['id']}", headers=ed)).json()
    assert staff["publish_at"] is None


async def test_publish_at_ignored_by_general_update(client, engine):
    """`SermonUpdate` no longer has a `publish_at` field (sermon-schedule-
    publish-authz fix) — a PATCH carrying it is an unrecognized field on that
    schema and is silently dropped (this model's existing extra-field
    behavior; no `extra="forbid"` anywhere in this codebase), not a 422. The
    rest of the PATCH still applies, and the sermon's `publish_at` is
    unchanged. It is now settable only via the publish review action."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]
    future = iso(datetime.now(timezone.utc) + timedelta(days=2))
    r = await client.patch(
        f"/api/v1/sermons/{sid}",
        json={"title": "S2", "publish_at": future},
        headers=ed,
    )
    assert r.status_code == 200, r.text

    detail = (await client.get(f"/api/v1/sermons/{sid}", headers=ed)).json()
    assert detail["title"] == "S2"
    assert detail["publish_at"] is None


async def test_publish_at_appears_in_staff_admin_list(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    future = iso(datetime.now(timezone.utc) + timedelta(days=1))
    await _scheduled_sermon(client, ed, mgr, future)
    items = (await client.get("/api/v1/sermons", headers=ed)).json()["items"]
    assert any(i["publish_at"] is not None for i in items)


# ═══════════════════════════════════════════════════════════════════════════════
# Future publish_at hides a PUBLISHED sermon from every public read
# ═══════════════════════════════════════════════════════════════════════════════
async def test_future_publish_at_hidden_from_public_catalog_list(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    future = iso(datetime.now(timezone.utc) + timedelta(days=1))
    await _scheduled_sermon(client, ed, mgr, future)

    listing = (await client.get("/api/v1/catalog/sermons")).json()
    assert listing == []


async def test_future_publish_at_detail_404s(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    future = iso(datetime.now(timezone.utc) + timedelta(days=1))
    sid = await _scheduled_sermon(client, ed, mgr, future)

    r = await client.get(f"/api/v1/catalog/sermons/{sid}")
    assert r.status_code == 404


async def test_future_publish_at_hidden_from_search(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    future = iso(datetime.now(timezone.utc) + timedelta(days=1))
    await _scheduled_sermon(client, ed, mgr, future, title="Findable Later")

    r = await client.get("/api/v1/search", params={"q": "Findable"})
    assert r.status_code == 200
    assert r.json()["results"] == []


async def publish_series(client, mgr, series_id):
    r = await client.patch(
        f"/api/v1/series/{series_id}", json={"status": "published"}, headers=mgr
    )
    assert r.status_code == 200, r.text


async def test_future_publish_at_hidden_from_series_episodes(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = (await client.post(
        "/api/v1/series", json={"title": "A Series"}, headers=ed
    )).json()
    await publish_series(client, mgr, series["id"])
    sid = (await client.post(
        "/api/v1/sermons",
        json={"title": "Ep1", "series_id": series["id"]},
        headers=ed,
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    future = iso(datetime.now(timezone.utc) + timedelta(days=1))
    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/publish",
        json={"publish_at": future},
        headers=mgr,
    )
    assert r.status_code == 200, r.text

    episodes = (await client.get(f"/api/v1/series/{series['id']}/episodes")).json()
    assert episodes == []


async def test_future_publish_at_blocks_streaming(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    future = iso(datetime.now(timezone.utc) + timedelta(days=1))
    sid = await _scheduled_sermon(client, ed, mgr, future)

    r = await client.get(f"/api/v1/sermons/{sid}/stream")
    assert r.status_code == 404


async def test_staff_streams_scheduled_sermon(client, engine):
    """The positive counterpart to test_future_publish_at_blocks_streaming: a
    manager (unrestricted) and the owning editor (their own sermon, so
    staff_scope_hides doesn't apply) both bypass the publish_at gate on
    /stream, same as they already do on detail/list. media_service.get_stream's
    `is_staff` check is unconditional on `publish_at` — this pins that so a
    future refactor of that conditional can't silently regress it."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Scheduled"}, headers=ed
    )).json()["id"]
    upload = await _upload_and_process(client, ed, sid)
    assert upload.status_code == 200, upload.text
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    future = iso(datetime.now(timezone.utc) + timedelta(days=1))
    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/publish",
        json={"publish_at": future},
        headers=mgr,
    )
    assert r.status_code == 200, r.text

    for headers in (mgr, ed):
        r = await client.get(f"/api/v1/sermons/{sid}/stream", headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["variants"]


# ═══════════════════════════════════════════════════════════════════════════════
# Staff always sees it, regardless of publish_at
# ═══════════════════════════════════════════════════════════════════════════════
async def test_staff_sees_scheduled_sermon_regardless_of_publish_at(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    future = iso(datetime.now(timezone.utc) + timedelta(days=1))
    sid = await _scheduled_sermon(client, ed, mgr, future)

    detail = (await client.get(f"/api/v1/sermons/{sid}", headers=mgr)).json()
    assert detail["status"] == "published"
    assert detail["publish_at"] is not None

    items = (await client.get("/api/v1/sermons", headers=mgr)).json()["items"]
    assert any(i["id"] == sid for i in items)


# ═══════════════════════════════════════════════════════════════════════════════
# Once publish_at passes, it behaves like a normal publish
# ═══════════════════════════════════════════════════════════════════════════════
async def test_past_publish_at_is_visible_everywhere(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    past = iso(datetime.now(timezone.utc) - timedelta(hours=1))
    sid = await _scheduled_sermon(client, ed, mgr, past, title="Already due")

    listing = (await client.get("/api/v1/catalog/sermons")).json()
    assert any(i["id"] == sid for i in listing)

    detail = await client.get(f"/api/v1/catalog/sermons/{sid}")
    assert detail.status_code == 200

    r = await client.get("/api/v1/search", params={"q": "Already due"})
    assert any(i["id"] == sid for i in r.json()["results"])


# ═══════════════════════════════════════════════════════════════════════════════
# publish_at=None regression — behaves exactly as before
# ═══════════════════════════════════════════════════════════════════════════════
async def test_publish_at_none_publishes_normally(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Normal publish"}, headers=ed
    )).json()["id"]
    await _publish(client, ed, mgr, sid)

    listing = (await client.get("/api/v1/catalog/sermons")).json()
    assert any(i["id"] == sid for i in listing)
    assert next(i for i in listing if i["id"] == sid)["publish_at"] is None


# ═══════════════════════════════════════════════════════════════════════════════
# `publish_at` on the publish action itself (sermon-schedule-publish-authz):
# only a manager/admin, only via `POST .../publish`'s optional body.
# ═══════════════════════════════════════════════════════════════════════════════
async def test_publish_action_sets_future_publish_at(client, engine):
    """The manager, not the editor, is the one scheduling: a sermon with no
    publish_at at creation is scheduled via the publish call's body, and the
    existing visibility gate (_is_visible / sermon_publish_time_passed) picks
    it up — same as a create-time publish_at, just set through the correct
    door this time."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Manager-scheduled"}, headers=ed
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)

    future = iso(datetime.now(timezone.utc) + timedelta(days=1))
    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/publish",
        json={"publish_at": future},
        headers=mgr,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "published"

    listing = (await client.get("/api/v1/catalog/sermons")).json()
    assert listing == []

    staff_detail = (await client.get(f"/api/v1/sermons/{sid}", headers=mgr)).json()
    assert staff_detail["publish_at"] is not None


async def test_publish_action_empty_body_publishes_immediately(client, engine):
    """An explicit `{}` body (distinct from no body at all) is still an
    explicit "publish now" — same as the bodyless call, and it clears any
    stale `publish_at` on the row."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)

    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/publish", json={}, headers=mgr
    )
    assert r.status_code == 200, r.text

    listing = (await client.get("/api/v1/catalog/sermons")).json()
    assert any(i["id"] == sid for i in listing)


async def test_publish_action_explicit_null_overrides_stale_publish_at(client, engine):
    """A `publish_at` scheduled by an earlier publish call (now unpublished
    again) is a stale value by the time a manager republishes. An explicit
    `{"publish_at": null}` on that publish call is the manager overriding it
    to "no gate", and takes precedence over whatever was there — this is the
    authz fix: the reviewer's decision wins."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    future = iso(datetime.now(timezone.utc) + timedelta(days=1))
    sid = await _scheduled_sermon(client, ed, mgr, future)
    await client.post(f"/api/v1/approvals/sermons/{sid}/unpublish", headers=mgr)

    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/publish",
        json={"publish_at": None},
        headers=mgr,
    )
    assert r.status_code == 200, r.text

    listing = (await client.get("/api/v1/catalog/sermons")).json()
    assert any(i["id"] == sid for i in listing)


async def test_publish_action_bodyless_leaves_existing_publish_at_untouched(
    client, engine
):
    """Backward compat: the review-queue frontend's current `publishCall`
    sends no body at all. That must keep working exactly as it does today —
    distinct from an explicit `{}`/`null`, a truly bodyless POST is a no-op on
    `publish_at` and any value already on the row (e.g. from an earlier
    publish call's `publish_at`) survives.

    Mirrors `test_publish_action_explicit_null_overrides_stale_publish_at`'s
    round trip (schedule → unpublish → republish) but the republish here
    omits the `json=` kwarg entirely — no `Content-Length`, no body on the
    wire — to actually exercise the `_Unset`-preserves-existing-value leg of
    the three-way contract, rather than just re-asserting the state that the
    first, explicit-body publish call already produced."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    future = iso(datetime.now(timezone.utc) + timedelta(days=1))
    sid = await _scheduled_sermon(client, ed, mgr, future, title="Bodyless")
    await client.post(f"/api/v1/approvals/sermons/{sid}/unpublish", headers=mgr)

    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr
    )
    assert r.status_code == 200, r.text

    listing = (await client.get("/api/v1/catalog/sermons")).json()
    assert listing == []

    staff_detail = (await client.get(f"/api/v1/sermons/{sid}", headers=mgr)).json()
    assert staff_detail["publish_at"] is not None
    got = datetime.fromisoformat(staff_detail["publish_at"].replace("Z", "+00:00"))
    want = datetime.fromisoformat(future)
    if got.tzinfo is None:
        got = got.replace(tzinfo=timezone.utc)
    assert got == want


# ═══════════════════════════════════════════════════════════════════════════════
# Share-links "not available" contract: GET /catalog/sermons/{id} (the call the
# mobile detail screen makes) is a plain 404 — not 200, not 403 — for a signed-in
# viewer on any non-published sermon, and for an id that does not exist.
# ═══════════════════════════════════════════════════════════════════════════════
async def _set_status(engine, sid, status):
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await s.execute(
            text("UPDATE sermons SET status = :st WHERE id = :i"),
            {"st": status, "i": sid},
        )
        await s.commit()


@pytest.mark.parametrize(
    "status",
    ["DRAFT", "PENDING_REVIEW", "UNDER_REVIEW", "APPROVED", "REJECTED", "UNPUBLISHED"],
)
async def test_non_published_sermon_detail_404s_for_signed_in_viewer(client, engine, status):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    viewer = await make_user(client, engine, "viewer@example.com", "viewer")
    sid = (await client.post("/api/v1/sermons", json={"title": "Hidden"}, headers=ed)).json()["id"]
    await _set_status(engine, sid, status)

    r = await client.get(f"/api/v1/catalog/sermons/{sid}", headers=viewer)
    assert r.status_code == 404, r.text


async def test_unpublished_after_publish_sermon_detail_404s_for_viewer(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    viewer = await make_user(client, engine, "viewer@example.com", "viewer")
    sid = (await client.post("/api/v1/sermons", json={"title": "Pulled"}, headers=ed)).json()["id"]
    await _publish(client, ed, mgr, sid)
    assert (await client.get(f"/api/v1/catalog/sermons/{sid}", headers=viewer)).status_code == 200

    # Real unpublish action (a raw UPDATE would be masked by the test session's
    # identity map, which already holds the published row).
    r = await client.post(f"/api/v1/approvals/sermons/{sid}/unpublish", headers=mgr)
    assert r.status_code == 200, r.text
    r = await client.get(f"/api/v1/catalog/sermons/{sid}", headers=viewer)
    assert r.status_code == 404, r.text


async def test_nonexistent_sermon_detail_404s_for_signed_in_viewer(client, engine):
    viewer = await make_user(client, engine, "viewer@example.com", "viewer")
    r = await client.get(
        "/api/v1/catalog/sermons/00000000-0000-4000-8000-000000000000", headers=viewer
    )
    assert r.status_code == 404, r.text
