"""GATE 3 Batch 4 — small backend items for the admin portal.

Covers:
  1. ReviewQueueItem.review_claimed_by_id — raw actor id on an under_review
     item, null on a pending one.
  2. ReviewQueueItem.episode_number — Sermon.episode_number verbatim (value for
     a series sermon, null for a standalone).
  3. POST /approvals/sermons/{id}/reject — note is required and non-blank; an
     empty / whitespace-only / missing note is 422, a real note is 200 and lands
     in the approval log.
  4. POST /approvals/sermons/{id}/publish — response carries
     notified_subscriber_count (count of active paid subscriptions).
"""
import uuid

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


async def _user_id(engine, email):
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        row = (await s.execute(
            text("SELECT id FROM users WHERE email = :e"), {"e": email}
        )).fetchone()
        return uuid.UUID(str(row.id))


async def _new_sermon(client, headers, title="S", **body):
    return (await client.post(
        "/api/v1/sermons", json={"title": title, **body}, headers=headers
    )).json()["id"]


async def _seed_subscription(engine, user_id, tier, status):
    from sqlalchemy import select

    from app.models.models import Subscription, SubscriptionStatus, SubscriptionTier

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        sub = (await s.execute(
            select(Subscription).where(Subscription.user_id == user_id)
        )).scalar_one_or_none()
        if sub is None:
            sub = Subscription(user_id=user_id)
            s.add(sub)
        sub.tier = SubscriptionTier(tier)
        sub.status = SubscriptionStatus(status)
        await s.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# 1. review_claimed_by_id
# ═══════════════════════════════════════════════════════════════════════════════
async def test_review_claimed_by_id_is_null_while_pending(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = await _new_sermon(client, ed, "Pending")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)

    item = (await client.get(
        "/api/v1/approvals/sermons/review-queue", headers=mgr
    )).json()["items"][0]

    assert item["status"] == "pending_review"
    assert item["review_claimed_by"] is None
    assert item["review_claimed_by_id"] is None


async def test_review_claimed_by_id_is_the_claimers_actor_id(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(
        client, engine, "mgr@example.com", "manager", full_name="Ivy Okafor"
    )
    mgr_id = await _user_id(engine, "mgr@example.com")

    sid = await _new_sermon(client, ed, "Claimed")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/start-review", headers=mgr)

    item = (await client.get(
        "/api/v1/approvals/sermons/review-queue", headers=mgr
    )).json()["items"][0]

    assert item["status"] == "under_review"
    assert item["review_claimed_by"] == "Ivy Okafor"
    assert item["review_claimed_by_id"] == str(mgr_id)
    # The id survives a claimer whose display name is null — the whole point of
    # adding it.
    assert uuid.UUID(item["review_claimed_by_id"]) == mgr_id


# ═══════════════════════════════════════════════════════════════════════════════
# 2. episode_number
# ═══════════════════════════════════════════════════════════════════════════════
async def test_review_queue_carries_episode_number(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")

    series_id = (await client.post(
        "/api/v1/series", json={"title": "Romans"}, headers=ed
    )).json()["id"]

    ep = await _new_sermon(client, ed, "Romans 1", series_id=series_id)
    await client.post(f"/api/v1/sermons/{ep}/submit", headers=ed)

    standalone = await _new_sermon(client, ed, "One-off")
    await client.post(f"/api/v1/sermons/{standalone}/submit", headers=ed)

    items = (await client.get(
        "/api/v1/approvals/sermons/review-queue", headers=mgr
    )).json()["items"]
    by_id = {i["id"]: i for i in items}

    assert by_id[ep]["episode_number"] == 1
    assert by_id[standalone]["episode_number"] is None


# ═══════════════════════════════════════════════════════════════════════════════
# 3. reject requires a non-blank note
# ═══════════════════════════════════════════════════════════════════════════════
async def _submitted_sermon(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")
    sid = await _new_sermon(client, ed, "Needs work")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    return ed, mgr, sid


async def test_reject_with_empty_note_is_422(client, engine):
    _ed, mgr, sid = await _submitted_sermon(client, engine)
    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/reject", json={"note": ""}, headers=mgr
    )
    assert r.status_code == 422


async def test_reject_with_whitespace_note_is_422(client, engine):
    _ed, mgr, sid = await _submitted_sermon(client, engine)
    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/reject",
        json={"note": "   "}, headers=mgr,
    )
    assert r.status_code == 422


async def test_reject_with_missing_note_is_422(client, engine):
    _ed, mgr, sid = await _submitted_sermon(client, engine)
    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/reject", json={}, headers=mgr
    )
    assert r.status_code == 422


async def test_reject_with_a_real_note_succeeds_and_logs_it(client, engine):
    _ed, mgr, sid = await _submitted_sermon(client, engine)
    r = await client.post(
        f"/api/v1/approvals/sermons/{sid}/reject",
        json={"note": "  tighten the intro  "}, headers=mgr,
    )
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"

    log = (await client.get(
        f"/api/v1/approvals/sermons/{sid}/approval-log", headers=mgr
    )).json()
    rejection = next(e for e in log if e["to_status"] == "rejected")
    # Stored note is the trimmed value.
    assert rejection["note"] == "tighten the intro"


# ═══════════════════════════════════════════════════════════════════════════════
# 4. publish response carries notified_subscriber_count
# ═══════════════════════════════════════════════════════════════════════════════
async def _approved_sermon(client, engine, mgr, ed):
    sid = await _new_sermon(client, ed, "To publish")
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    return sid


async def test_publish_response_counts_active_paid_subscriptions(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")

    a = await make_user(client, engine, "a@example.com", "editor")  # any real user
    b = await make_user(client, engine, "b@example.com", "editor")
    c = await make_user(client, engine, "c@example.com", "editor")
    await _seed_subscription(engine, await _user_id(engine, "a@example.com"),
                             "monthly", "active")
    await _seed_subscription(engine, await _user_id(engine, "b@example.com"),
                             "annual", "past_due")   # still entitled
    # Not counted: free tier, and an expired paid tier.
    await _seed_subscription(engine, await _user_id(engine, "c@example.com"),
                             "monthly", "expired")

    sid = await _approved_sermon(client, engine, mgr, ed)
    r = await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "published"
    assert body["notified_subscriber_count"] == 2


async def test_publish_response_count_is_zero_with_no_paid_subscribers(client, engine):
    ed = await make_user(client, engine, "ed@example.com", "editor")
    mgr = await make_user(client, engine, "mgr@example.com", "manager")

    sid = await _approved_sermon(client, engine, mgr, ed)
    r = await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)

    assert r.status_code == 200
    assert r.json()["notified_subscriber_count"] == 0
