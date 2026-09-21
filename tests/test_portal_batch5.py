"""GATE 3 Batch 5 — series episode-order, series publish, DTO counts, review lock.

Covers:
  1. PUT /api/v1/series/{id}/episode-order — bulk atomic reorder, set-equality
     validation (422), the review lock (409), the approved/published content
     lock (409, ADR 0008 §1), and the manager-only guard (403).
  2. Review lock on episode_number in PATCH /api/v1/sermons/{id} (single row).
  3. Minimal series publish — `status` on SeriesUpdate (manager-only, draft <->
     published only).
  4. Count fields on the public DTOs: SeriesPublic.episode_count /
     .category_name, SpeakerPublic.sermon_count, CategoryPublic.sermon_count —
     on both the list and the by-id endpoints.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

# asyncio_mode = "auto" — async tests need no marker.

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


async def _series(client, headers, title="S", **body):
    return (await client.post(
        "/api/v1/series", json={"title": title, **body}, headers=headers
    )).json()


async def _episode(client, headers, series_id, title, **body):
    return (await client.post(
        "/api/v1/sermons",
        json={"title": title, "series_id": series_id, **body},
        headers=headers,
    )).json()


async def _episode_numbers(client, headers, series_id):
    """{title: episode_number} as persisted, read via the staff sermon list."""
    page = (await client.get(
        f"/api/v1/sermons?series_id={series_id}&limit=100", headers=headers
    )).json()
    return {row["title"]: row["episode_number"] for row in page["items"]}


async def _submit(client, headers, sermon_id):
    return await client.post(f"/api/v1/sermons/{sermon_id}/submit", headers=headers)


async def _start_review(client, mgr, sermon_id):
    return await client.post(
        f"/api/v1/approvals/sermons/{sermon_id}/start-review", headers=mgr
    )


async def _publish(client, ed, mgr, sermon_id):
    """Drive a sermon draft -> published through the approval workflow."""
    await client.post(f"/api/v1/sermons/{sermon_id}/submit", headers=ed)
    await client.post(
        f"/api/v1/approvals/sermons/{sermon_id}/start-review", headers=mgr
    )
    await client.post(
        f"/api/v1/approvals/sermons/{sermon_id}/approve", headers=mgr
    )
    r = await client.post(
        f"/api/v1/approvals/sermons/{sermon_id}/publish", headers=mgr
    )
    assert r.status_code == 200, r.text
    return r


# ═══════════════════════════════════════════════════════════════════════════════
# 1. PUT /series/{id}/episode-order
# ═══════════════════════════════════════════════════════════════════════════════
async def test_episode_order_reassigns_by_position(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = await _series(client, ed, "Reorder me")
    e1 = await _episode(client, ed, series["id"], "E1")
    e2 = await _episode(client, ed, series["id"], "E2")
    e3 = await _episode(client, ed, series["id"], "E3")
    assert (e1["episode_number"], e2["episode_number"], e3["episode_number"]) == (1, 2, 3)

    resp = await client.put(
        f"/api/v1/series/{series['id']}/episode-order",
        json={"episode_ids": [e3["id"], e1["id"], e2["id"]]},
        headers=mgr,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body == [
        {"id": e3["id"], "episode_number": 1},
        {"id": e1["id"], "episode_number": 2},
        {"id": e2["id"], "episode_number": 3},
    ]
    # Persisted, not just echoed.
    assert await _episode_numbers(client, mgr, series["id"]) == {"E1": 2, "E2": 3, "E3": 1}


async def test_episode_order_rejects_missing_id(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = await _series(client, ed, "S")
    e1 = await _episode(client, ed, series["id"], "E1")
    e2 = await _episode(client, ed, series["id"], "E2")
    await _episode(client, ed, series["id"], "E3")

    resp = await client.put(
        f"/api/v1/series/{series['id']}/episode-order",
        json={"episode_ids": [e1["id"], e2["id"]]},
        headers=mgr,
    )
    assert resp.status_code == 422
    assert "missing" in resp.json()["detail"].lower()


async def test_episode_order_rejects_extra_id(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = await _series(client, ed, "S")
    other = await _series(client, ed, "Other")
    e1 = await _episode(client, ed, series["id"], "E1")
    e2 = await _episode(client, ed, series["id"], "E2")
    stray = await _episode(client, ed, other["id"], "Stray")

    resp = await client.put(
        f"/api/v1/series/{series['id']}/episode-order",
        json={"episode_ids": [e1["id"], e2["id"], stray["id"]]},
        headers=mgr,
    )
    assert resp.status_code == 422
    assert stray["id"] in resp.json()["detail"]


async def test_episode_order_rejects_duplicate_id(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = await _series(client, ed, "S")
    e1 = await _episode(client, ed, series["id"], "E1")
    e2 = await _episode(client, ed, series["id"], "E2")
    e3 = await _episode(client, ed, series["id"], "E3")

    resp = await client.put(
        f"/api/v1/series/{series['id']}/episode-order",
        json={"episode_ids": [e1["id"], e2["id"], e3["id"], e1["id"]]},
        headers=mgr,
    )
    assert resp.status_code == 422
    assert "more than once" in resp.json()["detail"]


async def test_episode_order_empty_list_is_422(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = await _series(client, ed, "S")
    await _episode(client, ed, series["id"], "E1")

    resp = await client.put(
        f"/api/v1/series/{series['id']}/episode-order",
        json={"episode_ids": []},
        headers=mgr,
    )
    assert resp.status_code == 422  # schema min_length=1


async def test_episode_order_over_page_size_is_422(client, engine):
    """episode_ids is capped at MAX_PAGE_SIZE (100) so the schema ceiling matches
    what the paginated drag client can actually assemble."""
    import uuid as _uuid

    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = await _series(client, ed, "S")
    await _episode(client, ed, series["id"], "E1")

    resp = await client.put(
        f"/api/v1/series/{series['id']}/episode-order",
        json={"episode_ids": [str(_uuid.uuid4()) for _ in range(101)]},
        headers=mgr,
    )
    assert resp.status_code == 422  # schema max_length=100, rejected before load


async def test_episode_order_refused_when_in_review_episode_would_move(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = await _series(client, ed, "S")
    e1 = await _episode(client, ed, series["id"], "E1")
    e2 = await _episode(client, ed, series["id"], "E2")
    e3 = await _episode(client, ed, series["id"], "E3")
    await _submit(client, ed, e2["id"])  # E2 -> pending_review, number 2

    resp = await client.put(
        f"/api/v1/series/{series['id']}/episode-order",
        json={"episode_ids": [e2["id"], e1["id"], e3["id"]]},  # E2 2 -> 1
        headers=mgr,
    )
    assert resp.status_code == 409
    assert "E2" in resp.json()["detail"]
    # Nothing written — the whole op is refused.
    assert await _episode_numbers(client, mgr, series["id"]) == {"E1": 1, "E2": 2, "E3": 3}


async def test_episode_order_refused_when_under_review_episode_would_move(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = await _series(client, ed, "S")
    e1 = await _episode(client, ed, series["id"], "E1")
    e2 = await _episode(client, ed, series["id"], "E2")
    await _submit(client, ed, e1["id"])
    await _start_review(client, mgr, e1["id"])  # E1 -> under_review, number 1

    resp = await client.put(
        f"/api/v1/series/{series['id']}/episode-order",
        json={"episode_ids": [e2["id"], e1["id"]]},  # E1 1 -> 2
        headers=mgr,
    )
    assert resp.status_code == 409
    assert "E1" in resp.json()["detail"]


async def test_episode_order_allows_reorder_that_keeps_in_review_number(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = await _series(client, ed, "S")
    e1 = await _episode(client, ed, series["id"], "E1")
    e2 = await _episode(client, ed, series["id"], "E2")
    e3 = await _episode(client, ed, series["id"], "E3")
    await _submit(client, ed, e2["id"])  # E2 pending_review, number 2

    # E2 stays at position 2 — its number does not change, so this is allowed.
    resp = await client.put(
        f"/api/v1/series/{series['id']}/episode-order",
        json={"episode_ids": [e3["id"], e2["id"], e1["id"]]},
        headers=mgr,
    )
    assert resp.status_code == 200
    assert await _episode_numbers(client, mgr, series["id"]) == {"E1": 3, "E2": 2, "E3": 1}


async def test_episode_order_refused_when_approved_episode_would_move(client, engine):
    """ADR 0008 §1's content lock (APPROVED/PUBLISHED), extended to this bulk
    endpoint — same episode_number column PATCH /sermons/{id} already refuses
    to touch on an approved sermon."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = await _series(client, ed, "S")
    e1 = await _episode(client, ed, series["id"], "E1")
    e2 = await _episode(client, ed, series["id"], "E2")
    e3 = await _episode(client, ed, series["id"], "E3")
    await _submit(client, ed, e2["id"])
    await _start_review(client, mgr, e2["id"])
    r = await client.post(f"/api/v1/approvals/sermons/{e2['id']}/approve", headers=mgr)
    assert r.status_code == 200, r.text  # E2 -> approved, number 2

    resp = await client.put(
        f"/api/v1/series/{series['id']}/episode-order",
        json={"episode_ids": [e2["id"], e1["id"], e3["id"]]},  # E2 2 -> 1
        headers=mgr,
    )
    assert resp.status_code == 409
    assert "E2" in resp.json()["detail"]
    assert "approved" in resp.json()["detail"].lower()
    # Distinct from the in-review lock message.
    assert "in review" not in resp.json()["detail"]
    # Nothing written.
    assert await _episode_numbers(client, mgr, series["id"]) == {"E1": 1, "E2": 2, "E3": 3}


async def test_episode_order_refused_when_published_episode_would_move(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = await _series(client, ed, "S")
    e1 = await _episode(client, ed, series["id"], "E1")
    e2 = await _episode(client, ed, series["id"], "E2")
    await _publish(client, ed, mgr, e1["id"])  # E1 -> published, number 1

    resp = await client.put(
        f"/api/v1/series/{series['id']}/episode-order",
        json={"episode_ids": [e2["id"], e1["id"]]},  # E1 1 -> 2
        headers=mgr,
    )
    assert resp.status_code == 409
    assert "E1" in resp.json()["detail"]
    assert "published" in resp.json()["detail"].lower()


async def test_episode_order_allows_reorder_that_keeps_approved_number(client, engine):
    """Same no-op semantics as the in-review case: staying at its current
    number while others shuffle around it is not a move."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = await _series(client, ed, "S")
    e1 = await _episode(client, ed, series["id"], "E1")
    e2 = await _episode(client, ed, series["id"], "E2")
    e3 = await _episode(client, ed, series["id"], "E3")
    await _submit(client, ed, e2["id"])
    await _start_review(client, mgr, e2["id"])
    r = await client.post(f"/api/v1/approvals/sermons/{e2['id']}/approve", headers=mgr)
    assert r.status_code == 200, r.text  # E2 -> approved, number 2

    resp = await client.put(
        f"/api/v1/series/{series['id']}/episode-order",
        json={"episode_ids": [e3["id"], e2["id"], e1["id"]]},
        headers=mgr,
    )
    assert resp.status_code == 200
    assert await _episode_numbers(client, mgr, series["id"]) == {"E1": 3, "E2": 2, "E3": 1}


async def test_episode_order_forbidden_for_editor(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    series = await _series(client, ed, "S")
    e1 = await _episode(client, ed, series["id"], "E1")
    e2 = await _episode(client, ed, series["id"], "E2")

    resp = await client.put(
        f"/api/v1/series/{series['id']}/episode-order",
        json={"episode_ids": [e2["id"], e1["id"]]},
        headers=ed,
    )
    assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# 2. Review lock on episode_number in PATCH /sermons/{id}
# ═══════════════════════════════════════════════════════════════════════════════
async def test_patch_episode_number_on_pending_review_is_409(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    series = await _series(client, ed, "S")
    e1 = await _episode(client, ed, series["id"], "E1")
    await _submit(client, ed, e1["id"])  # -> pending_review

    resp = await client.patch(
        f"/api/v1/sermons/{e1['id']}", json={"episode_number": 5}, headers=ed
    )
    assert resp.status_code == 409
    # Unchanged.
    assert await _episode_numbers(client, ed, series["id"]) == {"E1": 1}


async def test_patch_episode_number_on_under_review_is_409(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = await _series(client, ed, "S")
    e1 = await _episode(client, ed, series["id"], "E1")
    await _submit(client, ed, e1["id"])
    await _start_review(client, mgr, e1["id"])  # -> under_review

    resp = await client.patch(
        f"/api/v1/sermons/{e1['id']}", json={"episode_number": 9}, headers=mgr
    )
    assert resp.status_code == 409


async def test_patch_episode_number_on_draft_is_200(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    series = await _series(client, ed, "S")
    e1 = await _episode(client, ed, series["id"], "E1")

    resp = await client.patch(
        f"/api/v1/sermons/{e1['id']}", json={"episode_number": 5}, headers=ed
    )
    assert resp.status_code == 200
    assert resp.json()["episode_number"] == 5


async def test_patch_same_episode_number_on_in_review_is_not_a_move(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    series = await _series(client, ed, "S")
    e1 = await _episode(client, ed, series["id"], "E1")  # number 1
    await _submit(client, ed, e1["id"])

    resp = await client.patch(
        f"/api/v1/sermons/{e1['id']}", json={"episode_number": 1}, headers=ed
    )
    assert resp.status_code == 200


async def test_patch_title_only_on_in_review_still_ok(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    series = await _series(client, ed, "S")
    e1 = await _episode(client, ed, series["id"], "E1")
    await _submit(client, ed, e1["id"])  # -> pending_review

    resp = await client.patch(
        f"/api/v1/sermons/{e1['id']}", json={"title": "E1 renamed"}, headers=ed
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "E1 renamed"
    assert resp.json()["status"] == "pending_review"


async def test_patch_series_id_on_pending_review_is_409(client, engine):
    """Moving an in-review sermon to a different series is a position change —
    locked the same as renumbering, even when episode_number is untouched."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    s1 = await _series(client, ed, "S1")
    s2 = await _series(client, ed, "S2")
    e1 = await _episode(client, ed, s1["id"], "E1")  # number 1
    await _submit(client, ed, e1["id"])  # -> pending_review

    resp = await client.patch(
        f"/api/v1/sermons/{e1['id']}", json={"series_id": s2["id"]}, headers=ed
    )
    assert resp.status_code == 409
    # Not moved.
    assert await _episode_numbers(client, ed, s2["id"]) == {}


async def test_patch_series_id_on_draft_is_200(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    s1 = await _series(client, ed, "S1")
    s2 = await _series(client, ed, "S2")
    e1 = await _episode(client, ed, s1["id"], "E1")

    resp = await client.patch(
        f"/api/v1/sermons/{e1['id']}", json={"series_id": s2["id"]}, headers=ed
    )
    assert resp.status_code == 200
    assert resp.json()["series_id"] == s2["id"]


# ═══════════════════════════════════════════════════════════════════════════════
# 3. Minimal series publish — status on SeriesUpdate
# ═══════════════════════════════════════════════════════════════════════════════
async def test_manager_publishes_series_and_list_reflects_it(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = await _series(client, ed, "Grace")
    assert series["status"] == "draft"

    resp = await client.patch(
        f"/api/v1/series/{series['id']}", json={"status": "published"}, headers=mgr
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "published"

    listed = (await client.get("/api/v1/series")).json()
    card = next(s for s in listed if s["id"] == series["id"])
    assert card["status"] == "published"


async def test_manager_unpublishes_series(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = await _series(client, ed, "Grace")
    await client.patch(
        f"/api/v1/series/{series['id']}", json={"status": "published"}, headers=mgr
    )

    resp = await client.patch(
        f"/api/v1/series/{series['id']}", json={"status": "draft"}, headers=mgr
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "draft"


async def test_editor_sending_series_status_is_403(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    series = await _series(client, ed, "Grace")

    resp = await client.patch(
        f"/api/v1/series/{series['id']}", json={"status": "published"}, headers=ed
    )
    assert resp.status_code == 403
    # Non-status edits by the owner still work.
    ok = await client.patch(
        f"/api/v1/series/{series['id']}", json={"description": "d"}, headers=ed
    )
    assert ok.status_code == 200


async def test_illegal_series_status_target_is_422(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = await _series(client, ed, "Grace")

    resp = await client.patch(
        f"/api/v1/series/{series['id']}",
        json={"status": "pending_review"},
        headers=mgr,
    )
    assert resp.status_code == 422


async def test_manager_patch_null_status_is_noop_200(client, engine):
    """`{"status": null}` is schema-legal (SermonStatus | None) — it must be a
    silent no-op, not an AttributeError -> unhandled 500."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    series = await _series(client, ed, "Grace")

    resp = await client.patch(
        f"/api/v1/series/{series['id']}",
        json={"status": None, "description": "still draft"},
        headers=mgr,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "draft"
    assert resp.json()["description"] == "still draft"


async def test_editor_full_object_patch_echoing_unchanged_status_is_200(client, engine):
    """An editor doing a full-object PATCH that echoes the (unchanged) status
    alongside a real edit must pass — the no-op check precedes the role gate."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    series = await _series(client, ed, "Grace")

    resp = await client.patch(
        f"/api/v1/series/{series['id']}",
        json={"status": "draft", "title": "Grace renamed"},
        headers=ed,
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "Grace renamed"
    assert resp.json()["status"] == "draft"

    # A real change by an editor is still 403.
    denied = await client.patch(
        f"/api/v1/series/{series['id']}", json={"status": "published"}, headers=ed
    )
    assert denied.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Count fields on the public DTOs
# ═══════════════════════════════════════════════════════════════════════════════
async def _get_series_card(client, series_id, headers=None):
    listed = (await client.get("/api/v1/series", headers=headers or {})).json()
    return next(s for s in listed if s["id"] == series_id)


async def test_series_episode_count_scoped_to_caller(client, engine):
    """episode_count is Option-B scoped: anon/viewer see published episodes
    only; staff (editor+) see the true all-status count. category_name is not
    status-scoped."""
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    cat = (await client.post(
        "/api/v1/categories", json={"name": "Teaching", "slug": "teaching"}, headers=mgr
    )).json()

    with_cat = await _series(client, ed, "With cat", category_id=cat["id"])
    no_cat = await _series(client, ed, "No cat")

    # Create response is a staff call — carries the (zero) count + category name.
    assert with_cat["episode_count"] == 0
    assert with_cat["category_name"] == "Teaching"
    assert no_cat["category_name"] is None

    e1 = await _episode(client, ed, with_cat["id"], "E1")
    await _episode(client, ed, with_cat["id"], "E2")
    await _episode(client, ed, with_cat["id"], "E3")
    await _episode(client, ed, no_cat["id"], "Solo")
    await _publish(client, ed, mgr, e1["id"])  # 1 of 3 published in with_cat

    # anon by-id — published-only
    a = (await client.get(f"/api/v1/series/{with_cat['id']}")).json()
    assert a["episode_count"] == 1
    assert a["category_name"] == "Teaching"
    b = (await client.get(f"/api/v1/series/{no_cat['id']}")).json()
    assert b["episode_count"] == 0
    assert b["category_name"] is None

    # staff by-id — full count
    a_staff = (await client.get(f"/api/v1/series/{with_cat['id']}", headers=ed)).json()
    assert a_staff["episode_count"] == 3
    b_staff = (await client.get(f"/api/v1/series/{no_cat['id']}", headers=ed)).json()
    assert b_staff["episode_count"] == 1

    # list — same split
    assert (await _get_series_card(client, with_cat["id"]))["episode_count"] == 1
    assert (await _get_series_card(client, no_cat["id"]))["episode_count"] == 0
    assert (await _get_series_card(client, with_cat["id"], ed))["episode_count"] == 3
    assert (await _get_series_card(client, no_cat["id"], ed))["episode_count"] == 1
    assert (await _get_series_card(client, with_cat["id"]))["category_name"] == "Teaching"


async def test_speaker_sermon_count_scoped_to_caller(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    speaker = (await client.post(
        "/api/v1/speakers", json={"name": "Pastor A"}, headers=ed
    )).json()
    assert speaker["sermon_count"] == 0

    s1 = (await client.post(
        "/api/v1/sermons",
        json={"title": "S1", "speaker_id": speaker["id"]},
        headers=ed,
    )).json()
    (await client.post(
        "/api/v1/sermons",
        json={"title": "S2", "speaker_id": speaker["id"]},
        headers=ed,
    )).json()
    await _publish(client, ed, mgr, s1["id"])  # 1 of 2 published

    def _card(listed, sid):
        return next(s for s in listed if s["id"] == sid)

    # anon — published-only
    assert (await client.get(f"/api/v1/speakers/{speaker['id']}")).json()["sermon_count"] == 1
    assert _card((await client.get("/api/v1/speakers")).json(), speaker["id"])["sermon_count"] == 1

    # staff (editor+) — full count
    assert (await client.get(
        f"/api/v1/speakers/{speaker['id']}", headers=ed
    )).json()["sermon_count"] == 2
    assert _card(
        (await client.get("/api/v1/speakers", headers=ed)).json(), speaker["id"]
    )["sermon_count"] == 2

    # Detach the published sermon — anon drops to 0, staff to 1. A published
    # sermon is content-locked (see the approved/published field-lock guard),
    # so unpublish first, edit, then republish.
    await client.post(f"/api/v1/approvals/sermons/{s1['id']}/unpublish", headers=mgr)
    await client.patch(
        f"/api/v1/sermons/{s1['id']}", json={"speaker_id": None}, headers=ed
    )
    await client.post(f"/api/v1/approvals/sermons/{s1['id']}/publish", headers=mgr)
    assert (await client.get(f"/api/v1/speakers/{speaker['id']}")).json()["sermon_count"] == 0
    assert (await client.get(
        f"/api/v1/speakers/{speaker['id']}", headers=ed
    )).json()["sermon_count"] == 1


async def test_category_sermon_count_scoped_to_caller(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    viewer = await make_user(client, engine, "viewer@example.com", "viewer")
    cat = (await client.post(
        "/api/v1/categories", json={"name": "Worship", "slug": "worship"}, headers=mgr
    )).json()
    assert cat["sermon_count"] == 0

    s1 = (await client.post(
        "/api/v1/sermons",
        json={"title": "S1", "category_id": cat["id"]},
        headers=ed,
    )).json()
    (await client.post(
        "/api/v1/sermons",
        json={"title": "S2", "category_id": cat["id"]},
        headers=ed,
    )).json()
    await _publish(client, ed, mgr, s1["id"])  # 1 of 2 published

    def _c(rows):
        return next(c for c in rows if c["id"] == cat["id"])["sermon_count"]

    # anon — published-only, across by-id, admin list route, public catalog route
    assert (await client.get(f"/api/v1/categories/{cat['id']}")).json()["sermon_count"] == 1
    assert _c((await client.get("/api/v1/categories")).json()) == 1
    assert _c((await client.get("/api/v1/catalog/categories")).json()) == 1
    # viewer role — also published-only
    assert _c((await client.get("/api/v1/catalog/categories", headers=viewer)).json()) == 1
    assert (await client.get(
        f"/api/v1/categories/{cat['id']}", headers=viewer
    )).json()["sermon_count"] == 1

    # staff (editor+) — full count on every one of those routes
    assert (await client.get(
        f"/api/v1/categories/{cat['id']}", headers=ed
    )).json()["sermon_count"] == 2
    assert _c((await client.get("/api/v1/categories", headers=ed)).json()) == 2
    assert _c((await client.get("/api/v1/catalog/categories", headers=ed)).json()) == 2

    # Published sermon is content-locked — unpublish first, edit, republish.
    await client.post(f"/api/v1/approvals/sermons/{s1['id']}/unpublish", headers=mgr)
    await client.patch(
        f"/api/v1/sermons/{s1['id']}", json={"category_id": None}, headers=ed
    )
    await client.post(f"/api/v1/approvals/sermons/{s1['id']}/publish", headers=mgr)
    assert (await client.get(f"/api/v1/categories/{cat['id']}")).json()["sermon_count"] == 0
    assert (await client.get(
        f"/api/v1/categories/{cat['id']}", headers=ed
    )).json()["sermon_count"] == 1
