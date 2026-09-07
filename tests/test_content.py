import uuid

import pytest

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"


# ── helpers ───────────────────────────────────────────────────────────────────
async def make_user(client, engine, email, role):
    """Register a viewer, then elevate the role directly in the DB."""
    r = await client.post(
        "/api/v1/auth/register", json={"email": email, "password": PW}
    )
    assert r.status_code == 201, r.text

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    # The UserRole enum (native_enum=False) persists the member NAME, so write
    # the uppercase name, e.g. "EDITOR", not "editor".
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


async def make_viewer(client, email="viewer@example.com"):
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": email, "password": PW}
    )).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


# ── role enforcement ──────────────────────────────────────────────────────────
async def test_viewer_cannot_create_sermon(client):
    headers = await make_viewer(client)
    r = await client.post("/api/v1/sermons", json={"title": "X"}, headers=headers)
    assert r.status_code == 403


async def test_editor_can_create_draft(client, engine):
    headers = await make_user(client, engine, "editor@example.com", "editor")
    r = await client.post(
        "/api/v1/sermons", json={"title": "My Sermon"}, headers=headers
    )
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "draft"
    assert body["title"] == "My Sermon"


# ── full approval workflow ────────────────────────────────────────────────────
async def test_full_approval_flow(client, engine):
    editor = await make_user(client, engine, "editor@example.com", "editor")
    manager = await make_user(client, engine, "manager@example.com", "manager")

    # Editor creates and submits.
    sermon = (await client.post(
        "/api/v1/sermons", json={"title": "Grace"}, headers=editor
    )).json()
    sid = sermon["id"]

    r = await client.post(f"/api/v1/sermons/{sid}/submit", headers=editor)
    assert r.status_code == 200 and r.json()["status"] == "pending_review"

    # Editor cannot approve.
    r = await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=editor)
    assert r.status_code == 403

    # Manager approves then publishes.
    r = await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=manager)
    assert r.status_code == 200 and r.json()["status"] == "approved"

    r = await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=manager)
    assert r.status_code == 200 and r.json()["status"] == "published"

    # Now visible in the public catalog.
    listing = (await client.get("/api/v1/catalog/sermons")).json()
    assert any(item["id"] == sid for item in listing)


async def test_illegal_transition_rejected(client, engine):
    manager = await make_user(client, engine, "manager@example.com", "manager")
    editor = await make_user(client, engine, "editor@example.com", "editor")
    sermon = (await client.post(
        "/api/v1/sermons", json={"title": "X"}, headers=editor
    )).json()
    # Cannot approve a draft (must be submitted first).
    r = await client.post(f"/api/v1/approvals/sermons/{sermon['id']}/approve", headers=manager)
    assert r.status_code == 409


async def test_reject_returns_to_draft_capable(client, engine):
    editor = await make_user(client, engine, "editor@example.com", "editor")
    manager = await make_user(client, engine, "manager@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "X"}, headers=editor
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=editor)

    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/reject",
        json={"note": "Audio quality poor"}, headers=manager,
    )
    assert r.status_code == 200 and r.json()["status"] == "rejected"

    # Audit log records the rejection with the note.
    log = (await client.get(f"/api/v1/approvals/sermons/{sid}/approval-log", headers=manager)).json()
    assert any(e["to_status"] == "rejected" and e["note"] == "Audio quality poor" for e in log)

    # Editor can resubmit a rejected sermon.
    r = await client.post(f"/api/v1/sermons/{sid}/submit", headers=editor)
    assert r.status_code == 200 and r.json()["status"] == "pending_review"


# ── visibility & locked flag ──────────────────────────────────────────────────
async def test_unpublished_not_in_catalog(client, engine):
    editor = await make_user(client, engine, "editor@example.com", "editor")
    (await client.post("/api/v1/sermons", json={"title": "Draft"}, headers=editor))
    listing = (await client.get("/api/v1/catalog/sermons")).json()
    assert listing == []


async def test_paid_sermon_locked_for_anonymous(client, engine):
    editor = await make_user(client, engine, "editor@example.com", "editor")
    manager = await make_user(client, engine, "manager@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Premium", "tier": "paid"}, headers=editor
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=editor)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=manager)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=manager)

    item = (await client.get("/api/v1/catalog/sermons")).json()[0]
    assert item["tier"] == "paid"
    assert item["locked"] is True


async def test_free_sermon_not_locked(client, engine):
    editor = await make_user(client, engine, "editor@example.com", "editor")
    manager = await make_user(client, engine, "manager@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Free one", "tier": "free"}, headers=editor
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=editor)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=manager)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=manager)

    item = (await client.get("/api/v1/catalog/sermons")).json()[0]
    assert item["locked"] is False


# ── tier inheritance from series ──────────────────────────────────────────────
async def test_episode_inherits_series_tier(client, engine):
    editor = await make_user(client, engine, "editor@example.com", "editor")
    manager = await make_user(client, engine, "manager@example.com", "manager")

    series = (await client.post(
        "/api/v1/series", json={"title": "Paid Series", "tier": "paid"}, headers=editor
    )).json()

    # Episode with no explicit tier inherits 'paid' from the series.
    sid = (await client.post(
        "/api/v1/sermons",
        json={"title": "Ep1", "series_id": series["id"], "episode_number": 1},
        headers=editor,
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=editor)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=manager)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=manager)

    detail = (await client.get(f"/api/v1/catalog/sermons/{sid}")).json()
    assert detail["tier"] == "paid"
    assert detail["locked"] is True


async def test_episode_overrides_series_tier(client, engine):
    editor = await make_user(client, engine, "editor@example.com", "editor")
    manager = await make_user(client, engine, "manager@example.com", "manager")
    series = (await client.post(
        "/api/v1/series", json={"title": "Paid Series", "tier": "paid"}, headers=editor
    )).json()
    # Free pilot in a paid series.
    sid = (await client.post(
        "/api/v1/sermons",
        json={"title": "Pilot", "series_id": series["id"], "episode_number": 0, "tier": "free"},
        headers=editor,
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=editor)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=manager)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=manager)

    detail = (await client.get(f"/api/v1/catalog/sermons/{sid}")).json()
    assert detail["tier"] == "free"
    assert detail["locked"] is False


# ── ownership ─────────────────────────────────────────────────────────────────
async def test_editor_cannot_edit_others_sermon(client, engine):
    editor_a = await make_user(client, engine, "a@example.com", "editor")
    editor_b = await make_user(client, engine, "b@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "A's"}, headers=editor_a
    )).json()["id"]
    r = await client.patch(
        f"/api/v1/sermons/{sid}", json={"title": "hijack"}, headers=editor_b
    )
    assert r.status_code == 403


# ── review queue ──────────────────────────────────────────────────────────────
async def test_review_queue_shows_pending(client, engine):
    editor = await make_user(client, engine, "editor@example.com", "editor")
    manager = await make_user(client, engine, "manager@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Queued"}, headers=editor
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=editor)

    queue = (await client.get("/api/v1/approvals/sermons/review-queue", headers=manager)).json()
    assert any(item["id"] == sid for item in queue)


# ── categories ────────────────────────────────────────────────────────────────
async def test_categories_are_flat(client, engine):
    """Categories have no parent — creating two yields two independent rows."""
    manager = await make_user(client, engine, "manager@example.com", "manager")
    await client.post(
        "/api/v1/categories", json={"name": "Teaching", "slug": "teaching"},
        headers=manager,
    )
    await client.post(
        "/api/v1/categories", json={"name": "Worship", "slug": "worship"},
        headers=manager,
    )
    cats = (await client.get("/api/v1/catalog/categories")).json()
    assert len(cats) == 2
    assert {c["slug"] for c in cats} == {"teaching", "worship"}
    # No parent field is exposed at all.
    assert all("parent_id" not in c for c in cats)


async def test_category_rejects_unknown_parent_field(client, engine):
    """A parent_id sent by an old client is ignored, not persisted."""
    manager = await make_user(client, engine, "manager@example.com", "manager")
    r = await client.post(
        "/api/v1/categories",
        json={"name": "X", "slug": "x", "parent_id": str(__import__("uuid").uuid4())},
        headers=manager,
    )
    assert r.status_code == 201
    assert "parent_id" not in r.json()


# ── catalog cache invalidation on sermon edit (finding 1) ─────────────────────
async def test_patch_published_sermon_busts_catalog_cache(client, engine):
    """A tier PATCH on a published sermon must invalidate the cached catalog so
    /catalog/sermons and the live stream/detail endpoints never disagree on
    `locked`/`tier`. Pre-fix, update_sermon never busts the cache, so the
    anonymous re-read below still serves the stale `free`/unlocked row.
    """
    editor = await make_user(client, engine, "editor@example.com", "editor")
    manager = await make_user(client, engine, "manager@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Free then paid", "tier": "free"},
        headers=editor,
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=editor)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=manager)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=manager)

    # Prime the catalog cache as an anonymous caller.
    primed = (await client.get("/api/v1/catalog/sermons")).json()
    row = next(i for i in primed if i["id"] == sid)
    assert row["tier"] == "free"
    assert row["locked"] is False

    # Owning editor flips it to paid.
    r = await client.patch(
        f"/api/v1/sermons/{sid}", json={"tier": "paid"}, headers=editor
    )
    assert r.status_code == 200

    # Immediately re-read: the cache must reflect the new tier.
    after = (await client.get("/api/v1/catalog/sermons")).json()
    row = next(i for i in after if i["id"] == sid)
    assert row["tier"] == "paid"
    assert row["locked"] is True


async def test_patch_draft_sermon_does_not_touch_catalog_cache(client, engine):
    """A no-op guard: editing a non-published sermon leaves the primed catalog
    cache alone (nothing to invalidate — it was never in the catalog)."""
    editor = await make_user(client, engine, "editor@example.com", "editor")
    manager = await make_user(client, engine, "manager@example.com", "manager")
    published = (await client.post(
        "/api/v1/sermons", json={"title": "Live", "tier": "free"}, headers=editor
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{published}/submit", headers=editor)
    await client.post(f"/api/v1/approvals/sermons/{published}/approve", headers=manager)
    await client.post(f"/api/v1/approvals/sermons/{published}/publish", headers=manager)

    draft = (await client.post(
        "/api/v1/sermons", json={"title": "Draft", "tier": "free"}, headers=editor
    )).json()["id"]

    (await client.get("/api/v1/catalog/sermons")).json()
    r = await client.patch(
        f"/api/v1/sermons/{draft}", json={"tier": "paid"}, headers=editor
    )
    assert r.status_code == 200
    listing = (await client.get("/api/v1/catalog/sermons")).json()
    assert [i["id"] for i in listing] == [published]
