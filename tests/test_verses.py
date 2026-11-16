"""GET /api/v1/verses/today and the admin CRUD routes — Home's "verse of the day"
(Isaac's ask, session 2026-09-30). No editorial workflow, unlike Announcements: plain
active/inactive rows, picked by a daily-seeded choice among the active ones.
"""
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


async def create_verse(client, headers, **overrides):
    body = {"reference": "Philippians 4:13", "text": "I can do all things...", **overrides}
    r = await client.post("/api/v1/verses", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


# ── GET /verses/today ─────────────────────────────────────────────────────────
async def test_verse_of_the_day_requires_no_auth(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    await create_verse(client, ed)

    r = await client.get("/api/v1/verses/today")
    assert r.status_code == 200
    assert r.json()["reference"] == "Philippians 4:13"


async def test_verse_of_the_day_404s_when_none_are_active(client, engine):
    r = await client.get("/api/v1/verses/today")
    assert r.status_code == 404


async def test_verse_of_the_day_excludes_inactive_verses(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    await create_verse(client, ed, reference="Psalm 23:1", is_active=False)

    r = await client.get("/api/v1/verses/today")
    assert r.status_code == 404


async def test_verse_of_the_day_is_stable_across_repeat_calls(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    for i in range(6):
        await create_verse(client, ed, reference=f"Ref {i}", text=f"Text {i}")

    first = (await client.get("/api/v1/verses/today")).json()
    second = (await client.get("/api/v1/verses/today")).json()
    assert first["id"] == second["id"]


async def test_verse_of_the_day_response_omits_admin_only_fields(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    await create_verse(client, ed)

    body = (await client.get("/api/v1/verses/today")).json()
    assert set(body.keys()) == {"id", "reference", "text", "translation"}


# ── admin CRUD ─────────────────────────────────────────────────────────────────
async def test_create_verse_requires_editor_role(client, engine):
    v = await make_viewer(client)
    r = await client.post(
        "/api/v1/verses", json={"reference": "Psalm 23:1", "text": "..."}, headers=v,
    )
    assert r.status_code == 403


async def test_create_verse_defaults_translation_to_kjv_and_active_true(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    body = await create_verse(client, ed)
    assert body["translation"] == "kjv"
    assert body["is_active"] is True
    assert body["created_by"] is not None


async def test_list_all_verses_requires_editor_role(client, engine):
    v = await make_viewer(client)
    r = await client.get("/api/v1/verses/admin/all", headers=v)
    assert r.status_code == 403


async def test_list_all_verses_includes_inactive(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    await create_verse(client, ed, reference="Active one", is_active=True)
    await create_verse(client, ed, reference="Inactive one", is_active=False)

    rows = (await client.get("/api/v1/verses/admin/all", headers=ed)).json()
    references = {r["reference"] for r in rows}
    assert references == {"Active one", "Inactive one"}


async def test_update_verse(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    created = await create_verse(client, ed)

    r = await client.patch(
        f"/api/v1/verses/{created['id']}", json={"is_active": False}, headers=ed,
    )
    assert r.status_code == 200
    assert r.json()["is_active"] is False
    assert r.json()["reference"] == created["reference"]  # untouched fields survive


async def test_update_missing_verse_404s(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    r = await client.patch(
        "/api/v1/verses/00000000-0000-0000-0000-000000000000",
        json={"is_active": False},
        headers=ed,
    )
    assert r.status_code == 404


async def test_delete_verse(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    created = await create_verse(client, ed)

    r = await client.delete(f"/api/v1/verses/{created['id']}", headers=ed)
    assert r.status_code == 204

    rows = (await client.get("/api/v1/verses/admin/all", headers=ed)).json()
    assert rows == []
