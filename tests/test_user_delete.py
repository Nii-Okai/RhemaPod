"""Removing a staff account from Users & roles (`DELETE /users/{id}`).

Admin only; the account must be deactivated first; never yourself; and an
account linked to authored content or review history is refused (409) so the
record of who did what is never rewritten.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.models import AuditAction, AuditLog
from tests.test_user_lifecycle import db_user_id, make_user


async def _deactivate(client, headers, uid):
    r = await client.patch(
        f"/api/v1/users/{uid}/active", json={"is_active": False}, headers=headers
    )
    assert r.status_code == 200, r.text


async def test_admin_removes_a_deactivated_editor(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    await make_user(client, engine, "ed@example.com", "editor")
    uid = await db_user_id(engine, "ed@example.com")

    r = await client.delete(f"/api/v1/users/{uid}", headers=admin)
    assert r.status_code == 409 and "Deactivate" in r.json()["detail"]

    await _deactivate(client, admin, uid)
    r = await client.delete(f"/api/v1/users/{uid}", headers=admin)
    assert r.status_code == 204, r.text

    ids = [u["id"] for u in (await client.get("/api/v1/users", headers=admin)).json()["items"]]
    assert str(uid) not in ids

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        row = (await s.execute(
            select(AuditLog).where(AuditLog.action == AuditAction.USER_DELETED)
        )).scalar_one()
    assert row.target_label == "ed@example.com"


async def test_manager_cannot_remove_anyone(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    await make_user(client, engine, "ed@example.com", "editor")
    uid = await db_user_id(engine, "ed@example.com")
    await _deactivate(client, admin, uid)
    r = await client.delete(f"/api/v1/users/{uid}", headers=mgr)
    assert r.status_code == 403


async def test_cannot_remove_yourself(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    uid = await db_user_id(engine, "admin@example.com")
    r = await client.delete(f"/api/v1/users/{uid}", headers=admin)
    assert r.status_code == 403


async def test_account_with_content_is_kept(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    ed = await make_user(client, engine, "ed@example.com", "editor")
    r = await client.post("/api/v1/sermons", json={"title": "Mine"}, headers=ed)
    assert r.status_code == 201
    uid = await db_user_id(engine, "ed@example.com")
    await _deactivate(client, admin, uid)

    r = await client.delete(f"/api/v1/users/{uid}", headers=admin)
    assert r.status_code == 409
    assert "sermons (1)" in r.json()["detail"]


async def test_unknown_user_is_404(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    r = await client.delete(
        "/api/v1/users/00000000-0000-0000-0000-000000000001", headers=admin
    )
    assert r.status_code == 404
