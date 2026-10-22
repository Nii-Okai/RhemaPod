"""Settings › Data: admin-only database export / import.

Covers the guard rails in `app/services/data_transfer_service.py`: admin
only, confirmation phrase, dry run rolls back, schema/format validation, type
checking before any write, merge vs replace, the replace-closure rule, the
password-hash redaction, audit_log being export-only, and the importing
admin's own row being untouchable.
"""
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.models import AuditAction, AuditLog

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


async def _setup(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    for name in ("Prayer", "Faith"):
        r = await client.post(
            "/api/v1/categories",
            json={"name": name, "slug": name.lower()},
            headers=admin,
        )
        assert r.status_code == 201, r.text
    return admin


async def _export(client, headers, *tables):
    params = [("tables", t) for t in tables]
    r = await client.get("/api/v1/admin/data/export", params=params, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


async def _import(client, headers, document, **body):
    return await client.post(
        "/api/v1/admin/data/import", json={"document": document, **body}, headers=headers
    )


async def _category_names(client, headers):
    r = await client.get("/api/v1/categories", headers=headers)
    return sorted(c["name"] for c in r.json())


async def test_manager_and_editor_are_refused(client, engine):
    await _setup(client, engine)
    for role in ("manager", "editor"):
        h = await make_user(client, engine, f"{role}@example.com", role)
        assert (await client.get("/api/v1/admin/data/tables", headers=h)).status_code == 403
        assert (await client.get("/api/v1/admin/data/export", headers=h)).status_code == 403
        r = await _import(client, h, {"format": "rhemapod-export"})
        assert r.status_code == 403


async def test_tables_lists_counts_and_rules(client, engine):
    admin = await _setup(client, engine)
    body = (await client.get("/api/v1/admin/data/tables", headers=admin)).json()
    by_name = {t["name"]: t for t in body["tables"]}
    assert by_name["categories"]["rows"] == 2
    assert by_name["audit_log"]["importable"] is False
    assert by_name["users"]["importable"] is True
    assert by_name["users"]["replaceable"] is False
    assert "sermons" in by_name["categories"]["referenced_by"]


async def test_export_redacts_password_hashes_and_is_audited(client, engine):
    admin = await _setup(client, engine)
    doc = await _export(client, admin, "users", "categories")
    assert doc["format"] == "rhemapod-export"
    assert set(doc["tables"]) == {"users", "categories"}
    assert "password_hash" not in doc["tables"]["users"]["columns"]
    assert PW not in str(doc)

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        actions = (await s.execute(select(AuditLog.action))).scalars().all()
    assert AuditAction.DATA_EXPORTED in actions


async def test_unknown_table_is_422(client, engine):
    admin = await _setup(client, engine)
    r = await client.get(
        "/api/v1/admin/data/export", params={"tables": "nope"}, headers=admin
    )
    assert r.status_code == 422


async def test_dry_run_reports_counts_and_changes_nothing(client, engine):
    admin = await _setup(client, engine)
    doc = await _export(client, admin, "categories")
    rows = doc["tables"]["categories"]["rows"]
    cols = doc["tables"]["categories"]["columns"]
    rows[0][cols.index("name")] = "Renamed"

    r = await _import(client, admin, doc, mode="merge")
    assert r.status_code == 200, r.text
    result = r.json()
    assert result["dry_run"] is True
    assert result["tables"] == [
        {"name": "categories", "inserted": 0, "updated": 2, "deleted": 0, "skipped": 0}
    ]
    assert await _category_names(client, admin) == ["Faith", "Prayer"]


async def test_real_run_needs_the_confirmation_phrase(client, engine):
    admin = await _setup(client, engine)
    doc = await _export(client, admin, "categories")
    r = await _import(client, admin, doc, mode="merge", dry_run=False)
    assert r.status_code == 422
    r = await _import(client, admin, doc, mode="replace", dry_run=False, confirm="IMPORT")
    assert r.status_code == 422


async def test_merge_updates_and_inserts(client, engine):
    admin = await _setup(client, engine)
    doc = await _export(client, admin, "categories")
    table = doc["tables"]["categories"]
    cols = table["columns"]
    table["rows"][0][cols.index("name")] = "Renamed"
    new_row = list(table["rows"][1])
    new_row[cols.index("id")] = "6f1c0a52-8a5e-4a43-9d6b-1d2a3b4c5d6e"
    new_row[cols.index("name")] = "Hope"
    new_row[cols.index("slug")] = "hope"
    table["rows"].append(new_row)

    r = await _import(client, admin, doc, mode="merge", dry_run=False, confirm="IMPORT")
    assert r.status_code == 200, r.text
    counts = r.json()["tables"][0]
    assert (counts["inserted"], counts["updated"]) == (1, 2)
    names = await _category_names(client, admin)
    assert "Hope" in names and "Renamed" in names

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        row = (await s.execute(
            select(AuditLog).where(AuditLog.action == AuditAction.DATA_IMPORTED)
        )).scalar_one()
    assert row.details["mode"] == "merge"
    assert row.details["tables"] == ["categories"]


async def test_replace_requires_the_tables_that_point_at_it(client, engine):
    admin = await _setup(client, engine)
    doc = await _export(client, admin)
    r = await _import(client, admin, doc, mode="replace", tables=["categories"])
    assert r.status_code == 422
    assert "sermons" in r.json()["detail"]


async def test_replace_full_restore_round_trips(client, engine):
    admin = await _setup(client, engine)
    doc = await _export(client, admin)
    await client.post(
        "/api/v1/categories", json={"name": "Extra", "slug": "extra"}, headers=admin
    )
    assert "Extra" in await _category_names(client, admin)

    replaceable = [
        t["name"]
        for t in (await client.get("/api/v1/admin/data/tables", headers=admin)).json()["tables"]
        # The test database has no church_settings row; a replace refuses
        # anything but exactly one, which is its own guard.
        if t["replaceable"] and t["name"] != "church_settings"
    ]
    r = await _import(
        client, admin, doc, mode="replace", tables=replaceable,
        dry_run=False, confirm="REPLACE",
    )
    assert r.status_code == 200, r.text
    assert await _category_names(client, admin) == ["Faith", "Prayer"]


async def test_users_and_audit_log_rules(client, engine):
    admin = await _setup(client, engine)
    doc = await _export(client, admin, "users", "audit_log")

    r = await _import(client, admin, doc, mode="merge", tables=["audit_log"])
    assert r.status_code == 422 and "export only" in r.json()["detail"]
    r = await _import(client, admin, doc, mode="replace", tables=["users"])
    assert r.status_code == 422

    # Demoting yourself through an import is silently skipped, not applied.
    users = doc["tables"]["users"]
    users["rows"][0][users["columns"].index("role")] = "viewer"
    r = await _import(
        client, admin, doc, mode="merge", tables=["users"], dry_run=False, confirm="IMPORT"
    )
    assert r.status_code == 200, r.text
    assert r.json()["tables"][0]["skipped"] == 1
    assert (await client.get("/api/v1/admin/data/tables", headers=admin)).status_code == 200

    # A password hash can't be planted.
    users["columns"].append("password_hash")
    for row in users["rows"]:
        row.append("x")
    r = await _import(client, admin, doc, mode="merge", tables=["users"])
    assert r.status_code == 422 and "password_hash" in r.json()["detail"]


async def test_bad_values_refuse_the_whole_file(client, engine):
    admin = await _setup(client, engine)
    doc = await _export(client, admin, "categories")
    cols = doc["tables"]["categories"]["columns"]
    doc["tables"]["categories"]["rows"][0][cols.index("id")] = "not-a-uuid"
    r = await _import(client, admin, doc, mode="merge", dry_run=False, confirm="IMPORT")
    assert r.status_code == 422
    assert "must be a UUID" in r.json()["detail"]


async def test_format_and_schema_mismatch(client, engine):
    admin = await _setup(client, engine)
    r = await _import(client, admin, {"hello": "world"})
    assert r.status_code == 422
    doc = await _export(client, admin, "categories")
    doc["schema_revision"] = "deadbeef"
    r = await _import(client, admin, doc)
    assert r.status_code == 409


async def test_foreign_key_violation_rolls_back(client, engine):
    admin = await _setup(client, engine)
    doc = await _export(client, admin, "categories", "series")
    series = doc["tables"]["series"]
    assert series["rows"] == []
    row = {c: None for c in series["columns"]}
    row.update({
        "id": "2b8f6a1e-0c1d-4e5f-8a9b-0c1d2e3f4a5b",
        "title": "Orphan",
        "status": "draft",
        "created_by": "9b8f6a1e-0c1d-4e5f-8a9b-0c1d2e3f4a5b",  # no such user
    })
    series["rows"].append([row[c] for c in series["columns"]])
    r = await _import(
        client, admin, doc, mode="merge", tables=["series"], dry_run=False, confirm="IMPORT"
    )
    assert r.status_code in (409, 422), r.text
    r = await client.get("/api/v1/admin/data/tables", headers=admin)
    assert {t["name"]: t["rows"] for t in r.json()["tables"]}["series"] == 0


async def test_import_route_accepts_a_body_over_the_general_cap(client, engine):
    """`BodySizeLimitMiddleware` lets this one route past `max_request_bytes`
    (2 MB) up to `max_import_bytes`; every other route still 413s."""
    admin = await _setup(client, engine)
    padding = "x" * (3 * 1024 * 1024)
    r = await _import(client, admin, {"format": "nope", "padding": padding})
    assert r.status_code == 422, r.text
    r = await client.post(
        "/api/v1/categories",
        json={"name": "Big", "slug": "big", "padding": padding},
        headers=admin,
    )
    assert r.status_code == 413
