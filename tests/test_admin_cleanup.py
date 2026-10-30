"""Admin clean-up tools: mobile users, audit trail clean-up, data reset, the
sign-in screen image, and the Dashboard's counts.

* `GET /users/members` lists viewers to admins only; an admin can deactivate
  and then remove a viewer, a manager can't touch one.
* `POST /admin/audit/delete` removes chosen `audit_log` rows and leaves one
  row saying so; `POST /admin/audit/wipe` needs the phrase and the admin's
  password.
* `POST /admin/data/reset` previews by default, empties dependent tables,
  clears SET NULL links, never deletes the admin running it, and needs the
  phrase and password for a real run.
* The sign-in image is set, served on `/settings/public` and audited.
* `/sermons/status-counts` and the overview's member/watch-time figures.
"""
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.models import AuditAction, AuditLog, ChurchSettings, Sermon, User

PW = "correct-horse-battery"


def _session(engine):
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def make_user(client, engine, email, role):
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    if role != "viewer":
        async with _session(engine)() as s:
            await s.execute(
                text("UPDATE users SET role = :r WHERE email = :e"),
                {"r": role.upper(), "e": email},
            )
            await s.commit()
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": email, "password": PW}
    )).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def _user_id(engine, email):
    async with _session(engine)() as s:
        return (await s.execute(select(User.id).where(User.email == email))).scalar_one()


async def _audit_actions(engine):
    async with _session(engine)() as s:
        return list((await s.execute(select(AuditLog.action))).scalars().all())


# ── Mobile users ─────────────────────────────────────────────────────────────
async def test_members_list_is_admin_only_and_viewers_only(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    await make_user(client, engine, "ama@example.com", "viewer")
    await make_user(client, engine, "kofi@example.com", "viewer")

    assert (await client.get("/api/v1/users/members", headers=mgr)).status_code == 403

    r = await client.get("/api/v1/users/members", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 2
    assert {u["email"] for u in body["items"]} == {"ama@example.com", "kofi@example.com"}
    assert all(u["role"] == "viewer" for u in body["items"])

    r = await client.get("/api/v1/users/members", params={"q": "KOFI"}, headers=admin)
    assert [u["email"] for u in r.json()["items"]] == ["kofi@example.com"]
    # LIKE wildcards are literal.
    r = await client.get("/api/v1/users/members", params={"q": "%"}, headers=admin)
    assert r.json()["total"] == 0


async def test_admin_deactivates_then_removes_a_viewer(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    viewer = await make_user(client, engine, "ama@example.com", "viewer")
    vid = await _user_id(engine, "ama@example.com")

    # A manager can't switch a mobile account off.
    r = await client.patch(f"/api/v1/users/{vid}/active", json={"is_active": False}, headers=mgr)
    assert r.status_code == 403

    # Removing is two steps: an active account is refused.
    assert (await client.delete(f"/api/v1/users/{vid}", headers=admin)).status_code == 409

    r = await client.patch(f"/api/v1/users/{vid}/active", json={"is_active": False}, headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["is_active"] is False
    # The deactivated account is locked out at once.
    assert (await client.get("/api/v1/auth/me", headers=viewer)).status_code in (401, 403)

    r = await client.get(
        "/api/v1/users/members", params={"status": "deactivated"}, headers=admin
    )
    assert [u["email"] for u in r.json()["items"]] == ["ama@example.com"]

    assert (await client.delete(f"/api/v1/users/{vid}", headers=admin)).status_code == 204
    async with _session(engine)() as s:
        assert (await s.execute(select(User).where(User.id == vid))).scalar_one_or_none() is None
    actions = await _audit_actions(engine)
    assert AuditAction.DEACTIVATED in actions and AuditAction.USER_DELETED in actions


async def test_admin_still_cant_assign_the_viewer_role(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    await make_user(client, engine, "ed@example.com", "editor")
    eid = await _user_id(engine, "ed@example.com")
    r = await client.patch(f"/api/v1/users/{eid}/role", json={"role": "viewer"}, headers=admin)
    assert r.status_code == 400


# ── Audit trail clean-up ─────────────────────────────────────────────────────
async def _audit_ids(engine):
    async with _session(engine)() as s:
        return list((await s.execute(select(AuditLog.id))).scalars().all())


async def test_delete_selected_audit_entries_leaves_a_record(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    ids = await _audit_ids(engine)  # the sign-ins above
    assert len(ids) >= 2

    r = await client.post("/api/v1/admin/audit/delete", json={"ids": [str(ids[0])]}, headers=mgr)
    assert r.status_code == 403

    r = await client.post(
        "/api/v1/admin/audit/delete", json={"ids": [str(i) for i in ids[:2]]}, headers=admin
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"deleted": 2}
    remaining = await _audit_ids(engine)
    assert ids[0] not in remaining and ids[1] not in remaining
    assert AuditAction.AUDIT_DELETED in await _audit_actions(engine)


async def test_wipe_needs_phrase_and_password(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    await make_user(client, engine, "ed@example.com", "editor")
    before = len(await _audit_ids(engine))
    assert before >= 2

    r = await client.post(
        "/api/v1/admin/audit/wipe", json={"confirm": "wipe", "password": PW}, headers=admin
    )
    assert r.status_code == 422
    r = await client.post(
        "/api/v1/admin/audit/wipe",
        json={"confirm": "WIPE AUDIT TRAIL", "password": "wrong"}, headers=admin,
    )
    assert r.status_code == 403
    assert len(await _audit_ids(engine)) == before

    r = await client.post(
        "/api/v1/admin/audit/wipe",
        json={"confirm": "WIPE AUDIT TRAIL", "password": PW}, headers=admin,
    )
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] == before
    # Only the record of the wipe itself is left.
    assert await _audit_actions(engine) == [AuditAction.AUDIT_WIPED]


# ── Data reset ────────────────────────────────────────────────────────────────
async def _seed_content(client, admin):
    r = await client.post(
        "/api/v1/categories", json={"name": "Prayer", "slug": "prayer"}, headers=admin
    )
    assert r.status_code == 201, r.text
    cat = r.json()["id"]
    r = await client.post(
        "/api/v1/sermons", json={"title": "S1", "category_id": cat}, headers=admin
    )
    assert r.status_code == 201, r.text
    return cat


async def _count(engine, model):
    async with _session(engine)() as s:
        return (await s.execute(select(func.count()).select_from(model))).scalar_one()


async def test_tables_list_reset_rules(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    body = (await client.get("/api/v1/admin/data/tables", headers=admin)).json()
    by_name = {t["name"]: t for t in body["tables"]}
    assert by_name["audit_log"]["resettable"] is False
    assert by_name["church_settings"]["resettable"] is False
    # Sermons go with users (RESTRICT), but not with categories (SET NULL).
    assert "sermons" in by_name["users"]["reset_with"]
    assert "sermons" not in by_name["categories"]["reset_with"]
    assert "approval_log" in by_name["sermons"]["reset_with"]


async def test_reset_dry_run_then_real_run(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    await _seed_content(client, admin)

    r = await client.post(
        "/api/v1/admin/data/reset", json={"tables": ["categories"]}, headers=admin
    )
    assert r.status_code == 200, r.text
    preview = {t["name"]: t for t in r.json()["tables"]}
    assert r.json()["dry_run"] is True
    assert preview["categories"]["deleted"] == 1
    # The sermon keeps its row; only its category link is cleared.
    assert preview["sermons"] == {"name": "sermons", "deleted": 0, "unlinked": 1}
    assert await _count(engine, Sermon) == 1

    # A real run needs the phrase and the password.
    r = await client.post(
        "/api/v1/admin/data/reset",
        json={"tables": ["categories"], "dry_run": False, "confirm": "RESET", "password": "no"},
        headers=admin,
    )
    assert r.status_code == 403
    r = await client.post(
        "/api/v1/admin/data/reset",
        json={"tables": ["categories"], "dry_run": False, "confirm": "nope", "password": PW},
        headers=admin,
    )
    assert r.status_code == 422

    r = await client.post(
        "/api/v1/admin/data/reset",
        json={"tables": ["categories"], "dry_run": False, "confirm": "RESET", "password": PW},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    assert (await client.get("/api/v1/categories", headers=admin)).json() == []
    async with _session(engine)() as s:
        sermon = (await s.execute(select(Sermon))).scalar_one()
        assert sermon.category_id is None
    assert AuditAction.DATA_RESET in await _audit_actions(engine)


async def test_reset_refuses_audit_log_and_settings(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    for name in ("audit_log", "church_settings"):
        r = await client.post(
            "/api/v1/admin/data/reset", json={"tables": [name]}, headers=admin
        )
        assert r.status_code == 422


async def test_wipe_database_keeps_the_admin_and_the_audit_trail(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    await make_user(client, engine, "ed@example.com", "editor")
    await make_user(client, engine, "ama@example.com", "viewer")
    await _seed_content(client, admin)
    audit_before = len(await _audit_ids(engine))

    r = await client.post(
        "/api/v1/admin/data/reset",
        json={"dry_run": False, "confirm": "RESET", "password": PW},
        headers=admin,
    )
    assert r.status_code == 422  # wiping everything needs its own phrase

    r = await client.post(
        "/api/v1/admin/data/reset",
        json={"dry_run": False, "confirm": "WIPE DATABASE", "password": PW},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    assert r.json()["all_tables"] is True

    async with _session(engine)() as s:
        emails = (await s.execute(select(User.email))).scalars().all()
    assert emails == ["admin@example.com"]
    assert await _count(engine, Sermon) == 0
    # The trail stays, plus the record of the wipe.
    assert len(await _audit_ids(engine)) == audit_before + 1
    # The admin is still signed in and can keep working.
    assert (await client.get("/api/v1/auth/me", headers=admin)).status_code == 200


async def test_reset_is_admin_only(client, engine):
    await make_user(client, engine, "admin@example.com", "admin")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    r = await client.post("/api/v1/admin/data/reset", json={}, headers=mgr)
    assert r.status_code == 403


# ── Sign-in image ────────────────────────────────────────────────────────────
async def _seed_settings(engine):
    async with _session(engine)() as s:
        s.add(ChurchSettings(id=1, contact_email="c@example.com"))
        await s.commit()


async def test_sign_in_image_upload_and_remove(client, engine):
    await _seed_settings(engine)
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    ed = await make_user(client, engine, "ed@example.com", "editor")

    img = {"filename": "church.jpg", "content_type": "image/jpeg"}
    assert (await client.post(
        "/api/v1/admin/settings/sign-in-image-url", json=img, headers=ed
    )).status_code == 403
    bad = {"filename": "x.gif", "content_type": "image/gif"}
    assert (await client.post(
        "/api/v1/admin/settings/sign-in-image-url", json=bad, headers=mgr
    )).status_code == 400

    ticket = await client.post("/api/v1/admin/settings/sign-in-image-url", json=img, headers=mgr)
    assert ticket.status_code == 200, ticket.text
    key = ticket.json()["thumbnail_key"]
    assert key.startswith("branding/sign-in/")

    # A key outside the prefix is refused.
    r = await client.post(
        "/api/v1/admin/settings/sign-in-image/confirm",
        params={"thumbnail_key": "thumbnails/sermons/x/y.jpg"}, headers=mgr,
    )
    assert r.status_code == 400

    before = (await client.get("/api/v1/admin/settings", headers=mgr)).json()["version"]
    r = await client.post(
        "/api/v1/admin/settings/sign-in-image/confirm",
        params={"thumbnail_key": key}, headers=mgr,
    )
    assert r.status_code == 200, r.text
    assert r.json()["sign_in_image_url"]
    assert r.json()["version"] == before + 1

    public = (await client.get("/api/v1/settings/public")).json()
    assert public["sign_in_image_url"]

    r = await client.delete("/api/v1/admin/settings/sign-in-image", headers=mgr)
    assert r.status_code == 200
    assert r.json()["sign_in_image_url"] is None
    assert (await client.get("/api/v1/settings/public")).json()["sign_in_image_url"] is None


# ── Dashboard counts ─────────────────────────────────────────────────────────
async def test_sermon_status_counts_are_scoped(client, engine):
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    ed = await make_user(client, engine, "ed@example.com", "editor")
    for title in ("A", "B"):
        await client.post("/api/v1/sermons", json={"title": title}, headers=ed)
    await client.post("/api/v1/sermons", json={"title": "C"}, headers=mgr)
    sid = (await client.get("/api/v1/sermons", headers=ed)).json()["items"][0]["id"]
    assert (await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)).status_code == 200

    r = await client.get("/api/v1/sermons/status-counts", headers=ed)
    assert r.status_code == 200, r.text
    assert r.json()["draft"] == 1 and r.json()["pending_review"] == 1
    assert r.json()["total"] == 2

    everyone = (await client.get("/api/v1/sermons/status-counts", headers=mgr)).json()
    assert everyone["total"] == 3 and everyone["draft"] == 2
    mine = (await client.get(
        "/api/v1/sermons/status-counts", params={"created_by": "me"}, headers=mgr
    )).json()
    assert mine["total"] == 1


async def test_overview_counts_members(client, engine):
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    await make_user(client, engine, "a@example.com", "viewer")
    await make_user(client, engine, "b@example.com", "viewer")
    async with _session(engine)() as s:
        await s.execute(text("UPDATE users SET is_active = 0 WHERE email = 'b@example.com'"))
        await s.commit()
    body = (await client.get("/api/v1/admin/analytics/overview", headers=mgr)).json()
    assert body["members"] == 2
    assert body["active_members"] == 1
    assert body["watch_hours"] == 0
