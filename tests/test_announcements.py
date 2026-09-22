from datetime import datetime, timedelta, timezone

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
            text("UPDATE users SET role = :r WHERE email = :e"),
            {"r": role.upper(), "e": email},
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


BASE = {"title": "Service times", "description": "Christmas schedule", "body": "Full details here."}


async def create_published(client, engine, mgr, **overrides):
    """Full workflow: create -> submit -> approve -> publish.

    Approval is done by a second manager — the segregation-of-duties guard
    (no self-approval) blocks `mgr` from approving their own draft, so this
    mints/reuses a stand-in approver rather than testing that rule here.
    """
    ann = (await client.post(
        "/api/v1/announcements", json={**BASE, **overrides}, headers=mgr
    )).json()
    aid = ann["id"]
    await client.post(f"/api/v1/announcements/{aid}/submit", headers=mgr)
    approver = await make_user(client, engine, "approver@example.com", "manager")
    await client.post(f"/api/v1/approvals/announcements/{aid}/approve", headers=approver)
    await client.post(f"/api/v1/approvals/announcements/{aid}/publish", headers=mgr)
    return ann


def iso(dt):
    return dt.isoformat()


# ── creation & permissions ────────────────────────────────────────────────────
async def test_create_starts_as_draft(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    r = await client.post("/api/v1/announcements", json=BASE, headers=mgr)
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "draft"
    assert body["is_visible"] is False


async def test_viewer_cannot_create(client, engine):
    v = await make_viewer(client)
    r = await client.post("/api/v1/announcements", json=BASE, headers=v)
    assert r.status_code == 403


async def test_editor_can_create(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    r = await client.post("/api/v1/announcements", json=BASE, headers=ed)
    assert r.status_code == 201
    assert r.json()["status"] == "draft"


# ── public visibility ─────────────────────────────────────────────────────────
async def test_anonymous_can_list_published(client, engine):
    """Announcements are open to everyone, no auth required."""
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await create_published(client, engine, mgr)
    r = await client.get("/api/v1/announcements")
    assert r.status_code == 200
    assert len(r.json()) == 1


async def test_viewer_can_read_detail(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    ann = await create_published(client, engine, mgr)
    v = await make_viewer(client)
    r = await client.get(f"/api/v1/announcements/{ann['id']}", headers=v)
    assert r.status_code == 200
    assert r.json()["body"] == "Full details here."


async def test_draft_hidden_from_public(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    ann = (await client.post("/api/v1/announcements", json=BASE, headers=mgr)).json()
    assert (await client.get("/api/v1/announcements")).json() == []
    # A draft ID must 404, not 403 — otherwise it confirms the item exists.
    assert (await client.get(f"/api/v1/announcements/{ann['id']}")).status_code == 404


async def test_unpublish_removes_from_public(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    ann = await create_published(client, engine, mgr)
    assert len((await client.get("/api/v1/announcements")).json()) == 1
    await client.post(f"/api/v1/approvals/announcements/{ann['id']}/unpublish", headers=mgr)
    assert (await client.get("/api/v1/announcements")).json() == []


async def test_archive_removes_from_public(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    ann = await create_published(client, engine, mgr)
    r = await client.post(f"/api/v1/approvals/announcements/{ann['id']}/archive", headers=mgr)
    assert r.json()["status"] == "archived"
    assert (await client.get("/api/v1/announcements")).json() == []


# ── scheduling ────────────────────────────────────────────────────────────────
async def test_future_publish_at_not_yet_visible(client, engine):
    """Scheduled announcements appear on their own, with no worker running."""
    mgr = await make_user(client, engine, "m@example.com", "manager")
    future = datetime.now(timezone.utc) + timedelta(days=1)
    await create_published(client, engine, mgr, publish_at=iso(future))
    assert (await client.get("/api/v1/announcements")).json() == []


async def test_past_publish_at_is_visible(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    await create_published(client, engine, mgr, publish_at=iso(past))
    assert len((await client.get("/api/v1/announcements")).json()) == 1


async def test_expired_announcement_hidden(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    past_start = datetime.now(timezone.utc) - timedelta(days=2)
    past_end = datetime.now(timezone.utc) - timedelta(days=1)
    await create_published(
        client, engine, mgr, publish_at=iso(past_start), expires_at=iso(past_end)
    )
    assert (await client.get("/api/v1/announcements")).json() == []


async def test_expiry_must_follow_publish(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    now = datetime.now(timezone.utc)
    r = await client.post(
        "/api/v1/announcements",
        json={**BASE, "publish_at": iso(now), "expires_at": iso(now - timedelta(days=1))},
        headers=mgr,
    )
    assert r.status_code == 422


# ── ordering ──────────────────────────────────────────────────────────────────
async def test_pinned_sorts_first(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await create_published(client, engine, mgr, title="Normal")
    await create_published(client, engine, mgr, title="Important", pinned=True)
    items = (await client.get("/api/v1/announcements")).json()
    assert items[0]["title"] == "Important"


# ── CRUD ──────────────────────────────────────────────────────────────────────
async def test_update_announcement(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    ann = (await client.post("/api/v1/announcements", json=BASE, headers=mgr)).json()
    r = await client.patch(
        f"/api/v1/announcements/{ann['id']}",
        json={"title": "Updated", "pinned": True}, headers=mgr,
    )
    assert r.status_code == 200
    assert r.json()["title"] == "Updated" and r.json()["pinned"] is True


async def test_cannot_delete_published(client, engine):
    """Published announcements must be unpublished first."""
    mgr = await make_user(client, engine, "m@example.com", "manager")
    ann = await create_published(client, engine, mgr)
    aid = ann["id"]
    assert (await client.delete(
        f"/api/v1/announcements/{aid}", headers=mgr
    )).status_code == 409

    await client.post(f"/api/v1/approvals/announcements/{aid}/unpublish", headers=mgr)
    assert (await client.delete(
        f"/api/v1/announcements/{aid}", headers=mgr
    )).status_code == 204
    assert (await client.get("/api/v1/announcements")).json() == []


async def test_viewer_cannot_delete(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    ann = await create_published(client, engine, mgr)
    v = await make_viewer(client)
    r = await client.delete(f"/api/v1/announcements/{ann['id']}", headers=v)
    assert r.status_code == 403


# ── admin views ───────────────────────────────────────────────────────────────
async def test_admin_list_includes_drafts(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await client.post("/api/v1/announcements", json=BASE, headers=mgr)
    await create_published(client, engine, mgr, title="Live")

    public = (await client.get("/api/v1/announcements")).json()
    admin = (await client.get("/api/v1/announcements/admin/all", headers=mgr)).json()["items"]
    assert len(public) == 1
    assert len(admin) == 2


async def test_admin_status_filter(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await client.post("/api/v1/announcements", json=BASE, headers=mgr)
    await create_published(client, engine, mgr, title="Live")
    drafts = (await client.get(
        "/api/v1/announcements/admin/all?status=draft", headers=mgr
    )).json()["items"]
    assert len(drafts) == 1 and drafts[0]["status"] == "draft"


async def test_viewer_cannot_access_admin_list(client, engine):
    v = await make_viewer(client)
    r = await client.get("/api/v1/announcements/admin/all", headers=v)
    assert r.status_code == 403


# ── image ─────────────────────────────────────────────────────────────────────
async def test_image_upload_roundtrip(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    ann = (await client.post("/api/v1/announcements", json=BASE, headers=mgr)).json()

    ticket = (await client.post(
        f"/api/v1/announcements/{ann['id']}/image-url",
        json={"filename": "cover.jpg", "content_type": "image/jpeg"}, headers=mgr,
    ))
    assert ticket.status_code == 201
    key = ticket.json()["thumbnail_key"]
    assert key.startswith(f"thumbnails/announcements/{ann['id']}/")

    confirm = await client.post(
        f"/api/v1/announcements/{ann['id']}/image/confirm",
        params={"thumbnail_key": key}, headers=mgr,
    )
    assert confirm.status_code == 200
    assert confirm.json()["thumbnail_url"]

    aid = ann["id"]
    await client.post(f"/api/v1/announcements/{aid}/submit", headers=mgr)
    approver = await make_user(client, engine, "approver@example.com", "manager")
    await client.post(f"/api/v1/approvals/announcements/{aid}/approve", headers=approver)
    await client.post(f"/api/v1/approvals/announcements/{aid}/publish", headers=mgr)
    assert (await client.get("/api/v1/announcements")).json()[0]["image_url"]


async def test_image_url_falls_back_to_presigned_when_cdn_set_without_signing(
    client, engine, monkeypatch
):
    """Same CDN-bypass regression as media streaming, for announcement
    images: a bare, unsigned f"{cdn_base_url}/{key}" URL must never be
    emitted."""
    from app.services import announcement_service

    monkeypatch.setattr(
        announcement_service.settings, "cdn_base_url", "https://cdn.example.com"
    )

    mgr = await make_user(client, engine, "m2@example.com", "manager")
    ann = (await client.post("/api/v1/announcements", json=BASE, headers=mgr)).json()

    ticket = (await client.post(
        f"/api/v1/announcements/{ann['id']}/image-url",
        json={"filename": "cover.jpg", "content_type": "image/jpeg"}, headers=mgr,
    ))
    key = ticket.json()["thumbnail_key"]

    confirm = await client.post(
        f"/api/v1/announcements/{ann['id']}/image/confirm",
        params={"thumbnail_key": key}, headers=mgr,
    )
    url = confirm.json()["thumbnail_url"]
    assert url
    assert "cdn.example.com" not in url


async def test_image_rejects_non_image(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    ann = (await client.post("/api/v1/announcements", json=BASE, headers=mgr)).json()
    r = await client.post(
        f"/api/v1/announcements/{ann['id']}/image-url",
        json={"filename": "x.mp4", "content_type": "video/mp4"}, headers=mgr,
    )
    assert r.status_code == 400


async def test_image_confirm_rejects_foreign_key(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    ann = (await client.post("/api/v1/announcements", json=BASE, headers=mgr)).json()
    r = await client.post(
        f"/api/v1/announcements/{ann['id']}/image/confirm",
        params={"thumbnail_key": "thumbnails/announcements/00000000-0000-0000-0000-000000000000/x.jpg"},
        headers=mgr,
    )
    assert r.status_code == 400