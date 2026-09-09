"""GATE 3 Batch 6 — editor category writes, review-claim lock + take-over,
approved-stays-in-queue.

Covers:
  #3  POST/PATCH /api/v1/categories are EditorPlus (DELETE stays ManagerPlus).
  #9  The manager who runs start-review holds the review claim: only they (or an
      admin) may approve / reject / publish while the sermon is in the review
      cycle. POST /api/v1/approvals/sermons/{id}/take-over-review reassigns it and
      writes an ApprovalLog row.
  #12 An `approved` (not yet published) sermon stays in GET
      /api/v1/approvals/sermons/review-queue; publishing drops it.
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


async def _me_id(client, headers):
    return (await client.get("/api/v1/auth/me", headers=headers)).json()["id"]


async def _new_sermon(client, headers, title="S", **body):
    return (await client.post(
        "/api/v1/sermons", json={"title": title, **body}, headers=headers
    )).json()["id"]


async def _submit(client, headers, sermon_id):
    r = await client.post(f"/api/v1/sermons/{sermon_id}/submit", headers=headers)
    assert r.status_code == 200, r.text


async def _queue_ids(client, mgr):
    body = (await client.get(
        "/api/v1/approvals/sermons/review-queue", headers=mgr
    )).json()
    return {item["id"]: item for item in body["items"]}


# ═══════════════════════════════════════════════════════════════════════════════
# #3 — Editors can create and change categories (but not delete)
# ═══════════════════════════════════════════════════════════════════════════════
async def test_editor_can_create_category(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    r = await client.post(
        "/api/v1/categories", json={"name": "Doctrine", "slug": "doctrine"}, headers=ed
    )
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "Doctrine"


async def test_editor_can_update_category(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    cid = (await client.post(
        "/api/v1/categories", json={"name": "Old", "slug": "old"}, headers=mgr
    )).json()["id"]

    r = await client.patch(
        f"/api/v1/categories/{cid}", json={"name": "New", "slug": "new"}, headers=ed
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "New" and r.json()["slug"] == "new"


async def test_editor_still_cannot_delete_category(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    cid = (await client.post(
        "/api/v1/categories", json={"name": "X", "slug": "x"}, headers=ed
    )).json()["id"]
    r = await client.delete(f"/api/v1/categories/{cid}", headers=ed)
    assert r.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# #9 — Review-claim lock: only the claiming manager (or an admin) may act
# ═══════════════════════════════════════════════════════════════════════════════
async def test_claiming_manager_locks_out_other_managers(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr_a = await make_user(client, engine, "a@example.com", "manager", full_name="Alice Ng")
    mgr_b = await make_user(client, engine, "b@example.com", "manager", full_name="Bob Roy")

    sid = await _new_sermon(client, ed, "Grace")
    await _submit(client, ed, sid)
    r = await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr_a)
    assert r.status_code == 200, r.text

    for action, body in (("approve", None), ("reject", {"note": "no"}), ("publish", None)):
        r = await client.post(
            f"/api/v1/approvals/sermons/{sid}/{action}", headers=mgr_b, json=body
        )
        assert r.status_code == 403, (action, r.text)
        assert "review_claimed_by_another" in r.json()["detail"]
        assert "Alice Ng" in r.json()["detail"]


async def test_take_over_review_transfers_claim_and_audits(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr_a = await make_user(client, engine, "a@example.com", "manager", full_name="Alice Ng")
    mgr_b = await make_user(client, engine, "b@example.com", "manager", full_name="Bob Roy")
    b_id = await _me_id(client, mgr_b)

    sid = await _new_sermon(client, ed, "Grace")
    await _submit(client, ed, sid)
    await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr_a)

    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/take-over-review", headers=mgr_b
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "under_review"

    # An ApprovalLog row records the hand-off and names the previous claimer.
    log = (await client.get(
        f"/api/v1/approvals/sermons/{sid}/approval-log", headers=mgr_b
    )).json()
    handoff = [
        row for row in log
        if row["from_status"] == "under_review" and row["to_status"] == "under_review"
    ]
    assert len(handoff) == 1
    assert handoff[0]["actor_id"] == b_id
    assert "Alice Ng" in handoff[0]["note"]

    # The claim now sits with B — visible on the queue row...
    item = (await _queue_ids(client, mgr_b))[sid]
    assert item["review_claimed_by_id"] == b_id
    assert item["review_claimed_by"] == "Bob Roy"

    # ...and A can no longer act, while B can.
    r = await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr_a)
    assert r.status_code == 403
    r = await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr_b)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"


async def test_admin_bypasses_the_review_claim(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr_a = await make_user(client, engine, "a@example.com", "manager", full_name="Alice Ng")
    admin = await make_user(client, engine, "adm@example.com", "admin", full_name="Root")

    sid = await _new_sermon(client, ed, "Grace")
    await _submit(client, ed, sid)
    await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr_a)

    # Admin acts without taking over.
    r = await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=admin)
    assert r.status_code == 200, r.text
    r = await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=admin)
    assert r.status_code == 200, r.text

    # The claim was never reassigned — the queue row (while approved) still
    # showed A; now it's published and gone from the queue.
    assert sid not in await _queue_ids(client, admin)


async def test_take_over_when_you_already_hold_the_claim_is_409(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr_a = await make_user(client, engine, "a@example.com", "manager", full_name="Alice Ng")

    sid = await _new_sermon(client, ed, "Grace")
    await _submit(client, ed, sid)
    await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr_a)

    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/take-over-review", headers=mgr_a
    )
    assert r.status_code == 409, r.text
    assert "already_reviewing" in r.json()["detail"]


async def test_take_over_on_a_not_yet_reviewed_sermon_is_422(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")

    sid = await _new_sermon(client, ed, "Grace")
    await _submit(client, ed, sid)  # pending_review, nobody started a review

    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/take-over-review", headers=mgr
    )
    assert r.status_code == 422, r.text
    assert "not under review yet" in r.json()["detail"]


async def test_take_over_requires_manager(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")

    sid = await _new_sermon(client, ed, "Grace")
    await _submit(client, ed, sid)
    await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr)

    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/take-over-review", headers=ed
    )
    assert r.status_code == 403


async def test_unclaimed_pending_review_stays_open_to_any_manager(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")

    sid = await _new_sermon(client, ed, "Grace")
    await _submit(client, ed, sid)

    # No start-review — any manager may approve straight from pending_review.
    r = await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"


# ═══════════════════════════════════════════════════════════════════════════════
# #12 — "Approve only" keeps the sermon in the review queue until published
# ═══════════════════════════════════════════════════════════════════════════════
async def test_approved_sermon_stays_in_review_queue_until_published(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager", full_name="Meg P")
    mgr_id = await _me_id(client, mgr)

    sid = await _new_sermon(client, ed, "Grace")
    await _submit(client, ed, sid)
    await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr)
    r = await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    assert r.status_code == 200 and r.json()["status"] == "approved"

    # Approved but not published -> still in the queue, tagged approved, with the
    # approving reviewer as the claimer and a populated waiting-since key.
    item = (await _queue_ids(client, mgr)).get(sid)
    assert item is not None
    assert item["status"] == "approved"
    assert item["review_claimed_by_id"] == mgr_id
    assert item["review_claimed_by"] == "Meg P"
    assert item["submitted_at"] is not None

    # Publishing removes it.
    r = await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)
    assert r.status_code == 200, r.text
    assert sid not in await _queue_ids(client, mgr)


async def test_rejected_sermon_is_not_in_review_queue(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")

    sid = await _new_sermon(client, ed, "Grace")
    await _submit(client, ed, sid)
    await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr)
    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/reject", headers=mgr, json={"note": "redo"}
    )
    assert r.status_code == 200, r.text

    assert sid not in await _queue_ids(client, mgr)
