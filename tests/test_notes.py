import uuid as _uuid

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


async def publish(client, ed, mgr, **body):
    sid = (await client.post("/api/v1/sermons", json=body, headers=ed)).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)
    return sid


async def set_duration(engine, sid, seconds):
    """Set duration via the ORM — SQLite cannot bind a raw UUID parameter, so a
    text() UPDATE keyed on id silently matches nothing. Copied verbatim from
    test_analytics.py's helper of the same name."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import Sermon

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        sermon = await s.get(Sermon, _uuid.UUID(str(sid)))
        sermon.duration_seconds = seconds
        await s.commit()


# ── create + read ────────────────────────────────────────────────────────────
async def test_create_and_list_note(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    v = await make_viewer(client)

    r = await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 120, "body": "Great point about grace."},
        headers=v,
    )
    assert r.status_code == 201
    body = r.json()
    assert body["position_seconds"] == 120
    assert body["body"] == "Great point about grace."
    assert body["sermon_id"] == sid

    rows = (await client.get(f"/api/v1/sermons/{sid}/notes", headers=v)).json()
    assert len(rows) == 1
    assert rows[0]["id"] == body["id"]


async def test_notes_requires_auth(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    r = await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 10, "body": "x"},
    )
    assert r.status_code in (401, 403)


async def test_list_for_sermon_ordered_by_position(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    v = await make_viewer(client)

    await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 300, "body": "late"}, headers=v,
    )
    await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 50, "body": "early"}, headers=v,
    )
    await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 200, "body": "mid"}, headers=v,
    )
    rows = (await client.get(f"/api/v1/sermons/{sid}/notes", headers=v)).json()
    assert [r["position_seconds"] for r in rows] == [50, 200, 300]


async def test_list_for_sermon_is_scoped_to_caller(client, engine):
    """Two members note the same sermon — each only ever sees their own."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    a = await make_viewer(client, "a@example.com")
    b = await make_viewer(client, "b@example.com")

    await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 10, "body": "a's note"}, headers=a,
    )
    await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 20, "body": "b's note"}, headers=b,
    )

    a_rows = (await client.get(f"/api/v1/sermons/{sid}/notes", headers=a)).json()
    b_rows = (await client.get(f"/api/v1/sermons/{sid}/notes", headers=b)).json()
    assert len(a_rows) == 1 and a_rows[0]["body"] == "a's note"
    assert len(b_rows) == 1 and b_rows[0]["body"] == "b's note"


async def test_me_notes_spans_all_sermons_most_recent_first(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    s1 = await publish(client, ed, mgr, title="First")
    s2 = await publish(client, ed, mgr, title="Second")
    v = await make_viewer(client)

    await client.post(
        f"/api/v1/sermons/{s1}/notes",
        json={"position_seconds": 10, "body": "note on first"}, headers=v,
    )
    await client.post(
        f"/api/v1/sermons/{s2}/notes",
        json={"position_seconds": 10, "body": "note on second"}, headers=v,
    )
    rows = (await client.get("/api/v1/me/notes", headers=v)).json()
    assert len(rows) == 2
    # Most recent first: the second sermon's note was created last.
    assert rows[0]["body"] == "note on second"


async def test_me_notes_is_per_user(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    a = await make_viewer(client, "a@example.com")
    b = await make_viewer(client, "b@example.com")

    await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 10, "body": "a's note"}, headers=a,
    )
    assert len((await client.get("/api/v1/me/notes", headers=a)).json()) == 1
    assert (await client.get("/api/v1/me/notes", headers=b)).json() == []


# ── update / delete ───────────────────────────────────────────────────────────
async def test_update_note_partial(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    v = await make_viewer(client)

    created = (await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 10, "body": "original"}, headers=v,
    )).json()

    r = await client.patch(
        f"/api/v1/notes/{created['id']}", json={"body": "revised"}, headers=v,
    )
    assert r.status_code == 200
    assert r.json()["body"] == "revised"
    assert r.json()["position_seconds"] == 10  # untouched by a body-only patch

    r = await client.patch(
        f"/api/v1/notes/{created['id']}",
        json={"position_seconds": 99}, headers=v,
    )
    assert r.json()["position_seconds"] == 99
    assert r.json()["body"] == "revised"  # untouched by a position-only patch


async def test_delete_note(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    v = await make_viewer(client)

    created = (await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 10, "body": "x"}, headers=v,
    )).json()

    r = await client.delete(f"/api/v1/notes/{created['id']}", headers=v)
    assert r.status_code == 204

    rows = (await client.get(f"/api/v1/sermons/{sid}/notes", headers=v)).json()
    assert rows == []
    # Gone, not just hidden — a second delete finds nothing to delete either.
    assert (await client.delete(
        f"/api/v1/notes/{created['id']}", headers=v
    )).status_code == 404


# ── ownership: the load-bearing behaviour ────────────────────────────────────
async def test_cannot_read_another_users_note_via_sermon_list(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    a = await make_viewer(client, "a@example.com")
    b = await make_viewer(client, "b@example.com")

    await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 10, "body": "private to a"}, headers=a,
    )
    rows = (await client.get(f"/api/v1/sermons/{sid}/notes", headers=b)).json()
    assert rows == []


async def test_cannot_patch_another_users_note_404_not_403(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    a = await make_viewer(client, "a@example.com")
    b = await make_viewer(client, "b@example.com")

    created = (await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 10, "body": "a's note"}, headers=a,
    )).json()

    r = await client.patch(
        f"/api/v1/notes/{created['id']}", json={"body": "hijacked"}, headers=b,
    )
    assert r.status_code == 404  # not 403 — existence is not confirmed to b


async def test_cannot_delete_another_users_note_404_not_403(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    a = await make_viewer(client, "a@example.com")
    b = await make_viewer(client, "b@example.com")

    created = (await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 10, "body": "a's note"}, headers=a,
    )).json()

    r = await client.delete(f"/api/v1/notes/{created['id']}", headers=b)
    assert r.status_code == 404

    # And it's genuinely untouched — a can still read/patch/delete it.
    still_there = (await client.get(f"/api/v1/sermons/{sid}/notes", headers=a)).json()
    assert len(still_there) == 1 and still_there[0]["id"] == created["id"]


@pytest.mark.parametrize("role", ["manager", "admin"])
async def test_staff_have_no_bypass_on_patch(client, engine, role):
    """The one thing this feature must get right: a manager/admin calling
    PATCH on another user's note is refused exactly like a stranger would
    be — 404, not elevated access via a require_role-style shortcut."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    staff = await make_user(client, engine, f"{role}@example.com", role)
    v = await make_viewer(client)

    created = (await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 10, "body": "member's private note"}, headers=v,
    )).json()

    r = await client.patch(
        f"/api/v1/notes/{created['id']}", json={"body": "staff edit"}, headers=staff,
    )
    assert r.status_code == 404


@pytest.mark.parametrize("role", ["manager", "admin"])
async def test_staff_have_no_bypass_on_delete(client, engine, role):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    staff = await make_user(client, engine, f"{role}@example.com", role)
    v = await make_viewer(client)

    created = (await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 10, "body": "member's private note"}, headers=v,
    )).json()

    r = await client.delete(f"/api/v1/notes/{created['id']}", headers=staff)
    assert r.status_code == 404

    # Confirm it wasn't actually deleted by the "denied" staff call.
    still_there = (await client.get(f"/api/v1/sermons/{sid}/notes", headers=v)).json()
    assert len(still_there) == 1


async def test_staff_cannot_list_another_users_notes_for_a_sermon(client, engine):
    """No admin read path at all — not even a filtered one. A manager hitting
    the per-sermon list endpoint sees only THEIR OWN notes (none here),
    never the member's."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    v = await make_viewer(client)

    await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 10, "body": "member's private note"}, headers=v,
    )
    rows = (await client.get(f"/api/v1/sermons/{sid}/notes", headers=mgr)).json()
    assert rows == []


# ── sermon visibility: no existence leak ─────────────────────────────────────
async def test_note_on_nonexistent_sermon_404s(client, engine):
    v = await make_viewer(client)
    fake_id = str(_uuid.uuid4())
    r = await client.post(
        f"/api/v1/sermons/{fake_id}/notes",
        json={"position_seconds": 10, "body": "x"}, headers=v,
    )
    assert r.status_code == 404


async def test_note_on_unpublished_sermon_404s(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Draft"}, headers=ed
    )).json()["id"]
    v = await make_viewer(client)

    r = await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 10, "body": "x"}, headers=v,
    )
    assert r.status_code == 404

    r = await client.get(f"/api/v1/sermons/{sid}/notes", headers=v)
    assert r.status_code == 404


async def test_note_on_not_yet_scheduled_sermon_404s(client, engine):
    """A sermon whose status is PUBLISHED but whose publish_at is in the
    future is not yet visible to viewers — same visibility rule the public
    catalog detail read enforces (content_service.get_sermon_detail)."""
    from datetime import datetime, timedelta, timezone

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import Sermon

    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="Future")

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        sermon = await s.get(Sermon, _uuid.UUID(str(sid)))
        sermon.publish_at = datetime.now(timezone.utc) + timedelta(days=1)
        await s.commit()

    v = await make_viewer(client)
    r = await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 10, "body": "x"}, headers=v,
    )
    assert r.status_code == 404


async def test_own_note_survives_sermon_later_becoming_unpublished(client, engine):
    """update/delete are keyed on note ownership, not sermon visibility — a
    member can still manage their own note if staff later pull the sermon
    back to draft. This is a deliberate asymmetry (see notes_service
    docstring), not an oversight."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import Sermon, SermonStatus

    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    v = await make_viewer(client)

    created = (await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 10, "body": "before unpublish"}, headers=v,
    )).json()

    # ORM update, not a raw text() UPDATE keyed on id — SQLite can't bind a
    # raw UUID parameter, so that would silently match nothing (see
    # set_duration above / test_analytics.py's identical helper).
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        sermon = await s.get(Sermon, _uuid.UUID(str(sid)))
        sermon.status = SermonStatus.DRAFT
        await s.commit()

    r = await client.patch(
        f"/api/v1/notes/{created['id']}", json={"body": "after unpublish"}, headers=v,
    )
    assert r.status_code == 200
    assert r.json()["body"] == "after unpublish"


# ── position_seconds validation ──────────────────────────────────────────────
async def test_negative_position_rejected(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    v = await make_viewer(client)

    r = await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": -1, "body": "x"}, headers=v,
    )
    assert r.status_code == 422


async def test_negative_position_rejected_on_update(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    v = await make_viewer(client)

    created = (await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 10, "body": "x"}, headers=v,
    )).json()

    r = await client.patch(
        f"/api/v1/notes/{created['id']}", json={"position_seconds": -5}, headers=v,
    )
    assert r.status_code == 422


async def test_position_clamped_to_sermon_duration(client, engine):
    """Mirrors analytics_service.record_progress's established precedent for
    the same field on the same entity: clamp, don't reject, when the
    sermon's real length is known."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    await set_duration(engine, sid, 600)
    v = await make_viewer(client)

    r = await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 5000, "body": "x"}, headers=v,
    )
    assert r.status_code == 201
    assert r.json()["position_seconds"] == 600


async def test_position_clamped_on_update_too(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    await set_duration(engine, sid, 600)
    v = await make_viewer(client)

    created = (await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 10, "body": "x"}, headers=v,
    )).json()

    r = await client.patch(
        f"/api/v1/notes/{created['id']}",
        json={"position_seconds": 9999}, headers=v,
    )
    assert r.status_code == 200
    assert r.json()["position_seconds"] == 600


async def test_empty_body_rejected(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="S")
    v = await make_viewer(client)

    r = await client.post(
        f"/api/v1/sermons/{sid}/notes",
        json={"position_seconds": 10, "body": ""}, headers=v,
    )
    assert r.status_code == 422
