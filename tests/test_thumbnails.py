import pytest

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"
IMG = {"filename": "cover.jpg", "content_type": "image/jpeg"}


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


async def upload_thumbnail(client, headers, kind, entity_id, payload=None):
    ticket = (await client.post(
        f"/api/v1/{kind}/{entity_id}/thumbnail-url",
        json=payload or IMG, headers=headers,
    ))
    if ticket.status_code != 201:
        return ticket, None
    key = ticket.json()["thumbnail_key"]
    confirm = await client.post(
        f"/api/v1/{kind}/{entity_id}/thumbnail/confirm",
        params={"thumbnail_key": key}, headers=headers,
    )
    return ticket, confirm


# ── sermon thumbnails ─────────────────────────────────────────────────────────
async def test_sermon_thumbnail_ticket_and_confirm(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]

    ticket, confirm = await upload_thumbnail(client, ed, "sermons", sid)
    assert ticket.status_code == 201
    body = ticket.json()
    assert body["upload_url"].startswith("https://")
    assert body["headers"]["Content-Type"] == "image/jpeg"
    assert body["thumbnail_key"].startswith(f"thumbnails/sermons/{sid}/")

    assert confirm.status_code == 200
    assert confirm.json()["thumbnail_url"]


async def test_confirm_rejects_approved_sermon(client, engine):
    """Same content lock as update_sermon (ADR 0008 §1): a thumbnail swap on
    an approved/published sermon is refused for the same reason — it rides on
    the cached public catalog card exactly like any other field."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/thumbnail-url", json=IMG, headers=ed,
    )).json()
    key = ticket["thumbnail_key"]

    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)

    r = await client.post(
        f"/api/v1/sermons/{sid}/thumbnail/confirm",
        params={"thumbnail_key": key}, headers=mgr,
    )
    assert r.status_code == 409, r.text
    assert "approved" in r.json()["detail"] and "locked" in r.json()["detail"]


async def test_confirm_rejects_published_sermon(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/thumbnail-url", json=IMG, headers=ed,
    )).json()
    key = ticket["thumbnail_key"]

    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)

    r = await client.post(
        f"/api/v1/sermons/{sid}/thumbnail/confirm",
        params={"thumbnail_key": key}, headers=mgr,
    )
    assert r.status_code == 409, r.text
    assert "published" in r.json()["detail"] and "locked" in r.json()["detail"]


async def test_sermon_thumbnail_appears_in_catalog(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]
    await upload_thumbnail(client, ed, "sermons", sid)

    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)

    item = (await client.get("/api/v1/catalog/sermons")).json()[0]
    assert item["thumbnail_url"]


async def test_rejects_non_image_content_type(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]
    r = await client.post(
        f"/api/v1/sermons/{sid}/thumbnail-url",
        json={"filename": "x.mp4", "content_type": "video/mp4"}, headers=ed,
    )
    assert r.status_code == 400


async def test_confirm_rejects_foreign_key_path(client, engine):
    """A client-supplied key must stay inside its own entity's prefix."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]
    r = await client.post(
        f"/api/v1/sermons/{sid}/thumbnail/confirm",
        params={"thumbnail_key": "thumbnails/sermons/00000000-0000-0000-0000-000000000000/x.jpg"},
        headers=ed,
    )
    assert r.status_code == 400


async def test_confirm_fails_when_object_missing(client, engine, monkeypatch):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/thumbnail-url", json=IMG, headers=ed
    )).json()

    from app.core import storage as storage_module
    monkeypatch.setattr(storage_module.get_storage(), "object_exists", lambda b, k: False)

    r = await client.post(
        f"/api/v1/sermons/{sid}/thumbnail/confirm",
        params={"thumbnail_key": ticket["thumbnail_key"]}, headers=ed,
    )
    assert r.status_code == 409


async def test_editor_cannot_set_others_thumbnail(client, engine):
    a = await make_user(client, engine, "a@example.com", "editor")
    b = await make_user(client, engine, "b@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "A"}, headers=a
    )).json()["id"]
    r = await client.post(
        f"/api/v1/sermons/{sid}/thumbnail-url", json=IMG, headers=b
    )
    assert r.status_code == 403


async def test_viewer_cannot_set_thumbnail(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "S"}, headers=ed
    )).json()["id"]
    await client.post("/api/v1/auth/register", json={"email": "v@example.com", "password": PW})
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": "v@example.com", "password": PW}
    )).json()
    r = await client.post(
        f"/api/v1/sermons/{sid}/thumbnail-url", json=IMG,
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert r.status_code == 403


# ── series thumbnails ─────────────────────────────────────────────────────────
async def test_confirm_thumbnail_on_published_series_still_allowed(client, engine):
    """Series are deliberately exempt from the sermon content lock: a series
    never enters the review workflow at all (draft <-> published only, via
    update_series, which itself has no lock on a published series' other
    fields either) — nothing to extend here."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post(
        "/api/v1/series", json={"title": "Faith"}, headers=ed
    )).json()
    r = await client.patch(
        f"/api/v1/series/{series['id']}", json={"status": "published"}, headers=mgr
    )
    assert r.status_code == 200, r.text

    ticket, confirm = await upload_thumbnail(client, mgr, "series", series["id"])
    assert ticket.status_code == 201
    assert confirm.status_code == 200, confirm.text


async def test_series_thumbnail_roundtrip(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post(
        "/api/v1/series", json={"title": "Faith"}, headers=ed
    )).json()
    assert series["thumbnail_url"] is None
    r = await client.patch(
        f"/api/v1/series/{series['id']}", json={"status": "published"}, headers=mgr
    )
    assert r.status_code == 200, r.text

    ticket, confirm = await upload_thumbnail(client, ed, "series", series["id"])
    assert ticket.status_code == 201
    assert ticket.json()["thumbnail_key"].startswith(f"thumbnails/series/{series['id']}/")
    assert confirm.status_code == 200

    fetched = (await client.get(f"/api/v1/series/{series['id']}")).json()
    assert fetched["thumbnail_url"]


async def test_series_list_includes_thumbnail(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post(
        "/api/v1/series", json={"title": "Hope"}, headers=ed
    )).json()
    r = await client.patch(
        f"/api/v1/series/{series['id']}", json={"status": "published"}, headers=mgr
    )
    assert r.status_code == 200, r.text
    await upload_thumbnail(client, ed, "series", series["id"])

    rows = (await client.get("/api/v1/series")).json()
    assert rows[0]["thumbnail_url"]


async def test_replacing_thumbnail_changes_key(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    series = (await client.post(
        "/api/v1/series", json={"title": "S"}, headers=ed
    )).json()
    t1, _ = await upload_thumbnail(client, ed, "series", series["id"])
    t2, _ = await upload_thumbnail(client, ed, "series", series["id"])
    # A fresh UUID per upload avoids serving a cached copy of the old image.
    assert t1.json()["thumbnail_key"] != t2.json()["thumbnail_key"]
