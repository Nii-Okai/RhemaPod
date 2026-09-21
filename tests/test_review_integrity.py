"""Segregation of duties (no self-approval) on sermons and announcements, and
the sermon approved/published field lock.

Covers:
  1. A manager who created a sermon/announcement cannot approve it themselves
     (a different manager can; an admin bypasses). `reject` stays ungated for
     the announcement's own creator (self-correction); a sermon's own creator
     is blocked from the whole review-entry surface (start-review,
     take-over-review, approve, reject), not just approve — `publish` is
     never gated (mirrors the existing publish-is-never-claim-gated rule).
  2. `update_sermon` refuses a PATCH once a sermon is `approved` or
     `published` — the real backend guard (the frontend's client-side lock is
     UX only). `unpublish` returns it to `unpublished`, which is editable
     again.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

# asyncio_mode = "auto" — async tests need no marker.

PW = "correct-horse-battery"


async def make_user(client, engine, email, role, full_name=None):
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await s.execute(
            text("UPDATE users SET role = :r WHERE email = :e"),
            {"r": role.upper(), "e": email},
        )
        if full_name is not None:
            await s.execute(
                text("UPDATE users SET full_name = :n WHERE email = :e"),
                {"n": full_name, "e": email},
            )
        await s.commit()
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": email, "password": PW}
    )).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def _new_sermon(client, headers, title="S", **body):
    return (await client.post(
        "/api/v1/sermons", json={"title": title, **body}, headers=headers
    )).json()["id"]


# ═══════════════════════════════════════════════════════════════════════════════
# Sermons — self-authorship blocks the whole review-entry surface
# ═══════════════════════════════════════════════════════════════════════════════
async def test_manager_cannot_start_review_own_sermon(client, engine):
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = await _new_sermon(client, mgr, "Own work")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=mgr)

    r = await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr)
    assert r.status_code == 403, r.text
    assert "another manager needs to review it" in r.json()["detail"]


async def test_manager_cannot_approve_own_sermon(client, engine):
    mgr_a = await make_user(client, engine, "a@example.com", "manager")
    mgr_b = await make_user(client, engine, "b@example.com", "manager")
    sid = await _new_sermon(client, mgr_a, "Own work")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=mgr_a)
    await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr_b)

    r = await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr_a)
    assert r.status_code == 403, r.text
    assert "another manager needs to review it" in r.json()["detail"]

    # A different manager, already holding the claim, approves fine.
    r = await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr_b)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"


async def test_manager_cannot_reject_own_sermon(client, engine):
    mgr_a = await make_user(client, engine, "a@example.com", "manager")
    mgr_b = await make_user(client, engine, "b@example.com", "manager")
    sid = await _new_sermon(client, mgr_a, "Own work")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=mgr_a)
    await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr_b)

    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/reject",
        json={"note": "no"}, headers=mgr_a,
    )
    assert r.status_code == 403, r.text
    assert "another manager needs to review it" in r.json()["detail"]


async def test_manager_cannot_take_over_review_of_own_sermon(client, engine):
    mgr_a = await make_user(client, engine, "a@example.com", "manager")
    mgr_b = await make_user(client, engine, "b@example.com", "manager")
    sid = await _new_sermon(client, mgr_a, "Own work")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=mgr_a)
    await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr_b)

    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/take-over-review", headers=mgr_a
    )
    assert r.status_code == 403, r.text
    assert "another manager needs to review it" in r.json()["detail"]


async def test_different_manager_can_start_review_a_sermon_they_did_not_create(
    client, engine
):
    """Unchanged behaviour: a manager reviewing someone else's sermon is
    unaffected by the self-authorship rule."""
    mgr_a = await make_user(client, engine, "a@example.com", "manager")
    mgr_b = await make_user(client, engine, "b@example.com", "manager")
    sid = await _new_sermon(client, mgr_a, "Own work")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=mgr_a)

    r = await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr_b)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "under_review"


async def test_admin_bypasses_self_approval_on_own_sermon(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    sid = await _new_sermon(client, admin, "Admin's own")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=admin)

    r = await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=admin)
    assert r.status_code == 200, r.text
    r = await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"


async def test_publish_not_blocked_by_self_authorship(client, engine):
    """publish is deliberately excluded — once approved by someone else, the
    original creator (a manager) may still publish."""
    mgr_a = await make_user(client, engine, "a@example.com", "manager")
    mgr_b = await make_user(client, engine, "b@example.com", "manager")
    sid = await _new_sermon(client, mgr_a, "Own work")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=mgr_a)
    await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr_b)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr_b)

    r = await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr_a)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "published"


async def test_withdraw_not_blocked_by_self_authorship(client, engine):
    """withdraw is self-correction on a manager's own submission, same
    reasoning as the announcement `reject` exemption — not gated."""
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = await _new_sermon(client, mgr, "Own work")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=mgr)

    r = await client.post(f"/api/v1/sermons/{sid}/withdraw", headers=mgr)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "draft"


async def test_editor_created_sermon_unaffected_by_self_authorship_rule(client, engine):
    """Editor-created content: editors already can't reach these actions at
    all (role-gated), so the new rule adds nothing here — a manager who did
    not create it reviews normally."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = await _new_sermon(client, ed, "Editor's sermon")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)

    r = await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr)
    assert r.status_code == 200
    r = await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    assert r.status_code == 200 and r.json()["status"] == "approved"


# ═══════════════════════════════════════════════════════════════════════════════
# Announcements — self-approval only (reject stays ungated)
# ═══════════════════════════════════════════════════════════════════════════════
ANN_BASE = {"title": "Notice", "body": "Details."}


async def test_manager_cannot_approve_own_announcement(client, engine):
    mgr_a = await make_user(client, engine, "a@example.com", "manager")
    mgr_b = await make_user(client, engine, "b@example.com", "manager")
    aid = (await client.post(
        "/api/v1/announcements", json=ANN_BASE, headers=mgr_a
    )).json()["id"]
    await client.post(f"/api/v1/announcements/{aid}/submit", headers=mgr_a)

    r = await client.post(
        f"/api/v1/approvals/announcements/{aid}/approve", headers=mgr_a
    )
    assert r.status_code == 403, r.text
    assert "another manager needs to review it" in r.json()["detail"]

    r = await client.post(
        f"/api/v1/approvals/announcements/{aid}/approve", headers=mgr_b
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"


async def test_manager_can_reject_own_announcement(client, engine):
    """reject is NOT gated — rejecting your own draft is harmless
    self-correction, not a conflict of interest."""
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    aid = (await client.post(
        "/api/v1/announcements", json=ANN_BASE, headers=mgr
    )).json()["id"]
    await client.post(f"/api/v1/announcements/{aid}/submit", headers=mgr)

    r = await client.post(
        f"/api/v1/approvals/announcements/{aid}/reject",
        json={"note": "changed my mind"}, headers=mgr,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "rejected"


async def test_admin_bypasses_self_approval_on_own_announcement(client, engine):
    admin = await make_user(client, engine, "admin@example.com", "admin")
    aid = (await client.post(
        "/api/v1/announcements", json=ANN_BASE, headers=admin
    )).json()["id"]
    await client.post(f"/api/v1/announcements/{aid}/submit", headers=admin)

    r = await client.post(
        f"/api/v1/approvals/announcements/{aid}/approve", headers=admin
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"


# ═══════════════════════════════════════════════════════════════════════════════
# Sermon approved/published field lock
# ═══════════════════════════════════════════════════════════════════════════════
async def test_patch_approved_sermon_is_409(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = await _new_sermon(client, ed, "Locked")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)

    r = await client.patch(
        f"/api/v1/sermons/{sid}", json={"title": "sneaky edit"}, headers=ed
    )
    assert r.status_code == 409, r.text
    assert "approved" in r.json()["detail"] and "locked" in r.json()["detail"]


async def test_patch_published_sermon_is_409(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = await _new_sermon(client, ed, "Locked")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)

    # Even a manager/admin cannot edit it directly — this is a data-integrity
    # guard, not a role check.
    r = await client.patch(
        f"/api/v1/sermons/{sid}", json={"title": "sneaky edit"}, headers=mgr
    )
    assert r.status_code == 409, r.text
    assert "published" in r.json()["detail"] and "locked" in r.json()["detail"]

    # Distinct from the pre-existing in-review episode-position lock message.
    assert "in review" not in r.json()["detail"]


async def test_patch_draft_and_rejected_sermon_still_200(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")

    draft = await _new_sermon(client, ed, "Draft")
    r = await client.patch(
        f"/api/v1/sermons/{draft}", json={"title": "still editable"}, headers=ed
    )
    assert r.status_code == 200, r.text

    rejected = await _new_sermon(client, ed, "Will be rejected")
    await client.post(f"/api/v1/sermons/{rejected}/submit", headers=ed)
    await client.post(
        f"/api/v1/approvals/sermons/{rejected}/reject",
        json={"note": "fix this"}, headers=mgr,
    )
    r = await client.patch(
        f"/api/v1/sermons/{rejected}", json={"title": "fixed"}, headers=ed
    )
    assert r.status_code == 200, r.text


async def test_unpublish_unlocks_the_sermon_for_editing(client, engine):
    """unpublish -> unpublished, which is not in the locked set — editable
    again. This is the self-resolving path the brief asked to confirm."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = await _new_sermon(client, ed, "Cycle")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)

    r = await client.post(f"/api/v1/approvals/sermons/{sid}/unpublish", headers=mgr)
    assert r.status_code == 200 and r.json()["status"] == "unpublished"

    r = await client.patch(
        f"/api/v1/sermons/{sid}", json={"title": "now editable"}, headers=ed
    )
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "now editable"
