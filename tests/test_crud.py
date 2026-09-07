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


async def publish(client, editor, manager, **body):
    sid = (await client.post("/api/v1/sermons", json=body, headers=editor)).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=editor)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=manager)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=manager)
    return sid


# ── Categories ────────────────────────────────────────────────────────────────
async def test_category_crud_roundtrip(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    created = (await client.post(
        "/api/v1/categories", json={"name": "Teaching", "slug": "teaching"}, headers=mgr
    )).json()
    cid = created["id"]

    # Read one
    assert (await client.get(f"/api/v1/categories/{cid}")).json()["name"] == "Teaching"
    # List
    assert any(c["id"] == cid for c in (await client.get("/api/v1/categories")).json())
    # Update
    r = await client.patch(
        f"/api/v1/categories/{cid}", json={"name": "Teachings"}, headers=mgr
    )
    assert r.status_code == 200 and r.json()["name"] == "Teachings"
    # Delete
    assert (await client.delete(f"/api/v1/categories/{cid}", headers=mgr)).status_code == 204
    assert (await client.get(f"/api/v1/categories/{cid}")).status_code == 404


async def test_category_update_changes_name_and_slug(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    cat = (await client.post(
        "/api/v1/categories", json={"name": "Old", "slug": "old"}, headers=mgr
    )).json()
    r = await client.patch(
        f"/api/v1/categories/{cat['id']}",
        json={"name": "New", "slug": "new"}, headers=mgr,
    )
    assert r.status_code == 200
    assert r.json()["name"] == "New" and r.json()["slug"] == "new"
async def test_category_slug_conflict(client, engine):
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await client.post("/api/v1/categories", json={"name": "A", "slug": "dup"}, headers=mgr)
    b = (await client.post(
        "/api/v1/categories", json={"name": "B", "slug": "bee"}, headers=mgr
    )).json()
    r = await client.patch(
        f"/api/v1/categories/{b['id']}", json={"slug": "dup"}, headers=mgr
    )
    assert r.status_code == 409


async def test_editor_cannot_delete_category(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    cid = (await client.post(
        "/api/v1/categories", json={"name": "X", "slug": "x"}, headers=mgr
    )).json()["id"]
    assert (await client.delete(f"/api/v1/categories/{cid}", headers=ed)).status_code == 403


# ── Speakers ──────────────────────────────────────────────────────────────────
async def test_speaker_crud_roundtrip(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post(
        "/api/v1/speakers", json={"name": "Pastor A", "bio": "Bio"}, headers=ed
    )).json()["id"]

    assert (await client.get(f"/api/v1/speakers/{sid}")).json()["name"] == "Pastor A"
    r = await client.patch(
        f"/api/v1/speakers/{sid}", json={"name": "Pastor B"}, headers=ed
    )
    assert r.status_code == 200 and r.json()["name"] == "Pastor B"
    # Editors can't delete speakers; managers can.
    assert (await client.delete(f"/api/v1/speakers/{sid}", headers=ed)).status_code == 403
    assert (await client.delete(f"/api/v1/speakers/{sid}", headers=mgr)).status_code == 204
    assert (await client.get(f"/api/v1/speakers/{sid}")).status_code == 404


# ── Series ────────────────────────────────────────────────────────────────────
async def test_series_crud_roundtrip(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post(
        "/api/v1/series", json={"title": "Faith", "tier": "free"}, headers=ed
    )).json()["id"]

    assert (await client.get(f"/api/v1/series/{sid}")).json()["title"] == "Faith"
    assert any(s["id"] == sid for s in (await client.get("/api/v1/series")).json())
    r = await client.patch(
        f"/api/v1/series/{sid}", json={"title": "Faith II", "tier": "paid"}, headers=ed
    )
    assert r.status_code == 200 and r.json()["tier"] == "paid"
    assert (await client.delete(f"/api/v1/series/{sid}", headers=mgr)).status_code == 204


async def test_editor_cannot_edit_others_series(client, engine):
    ed_a = await make_user(client, engine, "a@example.com", "editor")
    ed_b = await make_user(client, engine, "b@example.com", "editor")
    sid = (await client.post(
        "/api/v1/series", json={"title": "A's series"}, headers=ed_a
    )).json()["id"]
    r = await client.patch(
        f"/api/v1/series/{sid}", json={"title": "hijack"}, headers=ed_b
    )
    assert r.status_code == 403


async def test_delete_series_orphans_episodes(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post(
        "/api/v1/series", json={"title": "S", "tier": "free"}, headers=ed
    )).json()
    sid = await publish(
        client, ed, mgr, title="Ep1", series_id=series["id"], episode_number=1
    )
    # Delete the series; the episode survives as a standalone sermon.
    assert (await client.delete(f"/api/v1/series/{series['id']}", headers=mgr)).status_code == 204
    detail = (await client.get(f"/api/v1/catalog/sermons/{sid}")).json()
    assert detail["series_id"] is None


# ── Sermons ───────────────────────────────────────────────────────────────────
async def test_sermon_list_scoped_to_editor(client, engine):
    ed_a = await make_user(client, engine, "a@example.com", "editor")
    ed_b = await make_user(client, engine, "b@example.com", "editor")
    await client.post("/api/v1/sermons", json={"title": "A1"}, headers=ed_a)
    await client.post("/api/v1/sermons", json={"title": "B1"}, headers=ed_b)

    a_list = (await client.get("/api/v1/sermons", headers=ed_a)).json()["items"]
    assert len(a_list) == 1  # only own draft


async def test_manager_sees_all_sermons(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await client.post("/api/v1/sermons", json={"title": "One"}, headers=ed)
    await client.post("/api/v1/sermons", json={"title": "Two"}, headers=ed)
    mgr_list = (await client.get("/api/v1/sermons", headers=mgr)).json()["items"]
    assert len(mgr_list) == 2


async def test_sermon_list_status_filter(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    await client.post("/api/v1/sermons", json={"title": "D1"}, headers=ed)
    sid = (await client.post("/api/v1/sermons", json={"title": "D2"}, headers=ed)).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)

    drafts = (await client.get("/api/v1/sermons?status=draft", headers=ed)).json()["items"]
    assert len(drafts) == 1 and drafts[0]["title"] == "D1"


async def test_editor_deletes_own_draft(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "D"}, headers=ed)).json()["id"]
    assert (await client.delete(f"/api/v1/sermons/{sid}", headers=ed)).status_code == 204


async def test_editor_cannot_delete_others_sermon(client, engine):
    ed_a = await make_user(client, engine, "a@example.com", "editor")
    ed_b = await make_user(client, engine, "b@example.com", "editor")
    sid = (await client.post("/api/v1/sermons", json={"title": "A"}, headers=ed_a)).json()["id"]
    assert (await client.delete(f"/api/v1/sermons/{sid}", headers=ed_b)).status_code == 403


async def test_cannot_delete_published_sermon(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="Live")
    # Even a manager must unpublish first.
    r = await client.delete(f"/api/v1/sermons/{sid}", headers=mgr)
    assert r.status_code == 409
    # After unpublish, deletion is allowed.
    await client.post(f"/api/v1/approvals/sermons/{sid}/unpublish", headers=mgr)
    assert (await client.delete(f"/api/v1/sermons/{sid}", headers=mgr)).status_code == 204


async def test_delete_removes_from_catalog_after_unpublish(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="Temp")
    assert len((await client.get("/api/v1/catalog/sermons")).json()) == 1
    await client.post(f"/api/v1/approvals/sermons/{sid}/unpublish", headers=mgr)
    await client.delete(f"/api/v1/sermons/{sid}", headers=mgr)
    assert (await client.get("/api/v1/catalog/sermons")).json() == []
