from datetime import datetime, timedelta, timezone

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


async def user_id_for(engine, email):
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        row = (await s.execute(
            text("SELECT id FROM users WHERE email = :e"), {"e": email}
        )).fetchone()
        return str(row.id)


def sub_event(event_id, event_type, user_id, **obj):
    return {
        "id": event_id,
        "type": event_type,
        "data": {"object": {"metadata": {"user_id": user_id, "tier": "monthly"}, **obj}},
    }


# ── status ────────────────────────────────────────────────────────────────────
async def test_new_user_is_free_and_unentitled(client):
    v = await make_viewer(client)
    r = await client.get("/api/v1/subscriptions/me", headers=v)
    assert r.status_code == 200
    body = r.json()
    assert body["tier"] == "free"
    assert body["is_entitled"] is False


async def test_subscription_requires_auth(client):
    r = await client.get("/api/v1/subscriptions/me")
    assert r.status_code in (401, 403)


# ── checkout ──────────────────────────────────────────────────────────────────
async def test_checkout_returns_url(client):
    v = await make_viewer(client)
    r = await client.post(
        "/api/v1/subscriptions/checkout", json={"tier": "monthly"}, headers=v
    )
    assert r.status_code == 200
    assert r.json()["checkout_url"].startswith("https://")


async def test_checkout_rejects_free_tier(client):
    v = await make_viewer(client)
    r = await client.post(
        "/api/v1/subscriptions/checkout", json={"tier": "free"}, headers=v
    )
    assert r.status_code == 422


# ── webhooks ──────────────────────────────────────────────────────────────────
async def test_checkout_completed_activates(client, engine):
    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")
    period_end = int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())

    r = await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_1", "checkout.session.completed", uid,
        id="sub_abc", customer="cus_abc", current_period_end=period_end,
    ))
    assert r.status_code == 200
    assert r.json()["outcome"] == "activated"

    me = (await client.get("/api/v1/subscriptions/me", headers=v)).json()
    assert me["tier"] == "monthly"
    assert me["status"] == "active"
    assert me["is_entitled"] is True


async def test_webhook_is_idempotent(client, engine):
    await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")
    ev = sub_event("evt_dup", "checkout.session.completed", uid,
                   id="sub_x", customer="cus_x")

    first = await client.post("/api/v1/subscriptions/webhook", json=ev)
    second = await client.post("/api/v1/subscriptions/webhook", json=ev)
    assert first.json()["outcome"] == "activated"
    assert second.json()["outcome"] == "duplicate_ignored"


async def test_payment_failed_sets_past_due_but_keeps_access(client, engine):
    """A failed charge starts a retry window; don't cut off a paying member."""
    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")
    period_end = int((datetime.now(timezone.utc) + timedelta(days=10)).timestamp())
    await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_a", "checkout.session.completed", uid,
        id="sub_p", customer="cus_p", current_period_end=period_end,
    ))
    r = await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_b", "invoice.payment_failed", uid, subscription="sub_p",
    ))
    assert r.json()["outcome"] == "past_due"

    me = (await client.get("/api/v1/subscriptions/me", headers=v)).json()
    assert me["status"] == "past_due"
    assert me["is_entitled"] is True     # grace period


async def test_subscription_deleted_revokes(client, engine):
    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")
    await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_c", "checkout.session.completed", uid, id="sub_d", customer="cus_d",
    ))
    r = await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_d", "customer.subscription.deleted", uid, id="sub_d",
    ))
    assert r.json()["outcome"] == "expired"

    me = (await client.get("/api/v1/subscriptions/me", headers=v)).json()
    assert me["tier"] == "free"
    assert me["is_entitled"] is False


async def test_renewal_extends_validity(client, engine):
    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")
    await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_e", "checkout.session.completed", uid, id="sub_r", customer="cus_r",
        current_period_end=int((datetime.now(timezone.utc) + timedelta(days=1)).timestamp()),
    ))
    new_end = int((datetime.now(timezone.utc) + timedelta(days=31)).timestamp())
    r = await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_f", "invoice.paid", uid, subscription="sub_r", current_period_end=new_end,
    ))
    assert r.json()["outcome"] == "renewed"
    me = (await client.get("/api/v1/subscriptions/me", headers=v)).json()
    assert me["is_entitled"] is True


async def test_malformed_webhook_rejected(client):
    r = await client.post(
        "/api/v1/subscriptions/webhook",
        content=b"not json",
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 400


# ── cancellation ──────────────────────────────────────────────────────────────
async def test_cancel_keeps_access_until_period_end(client, engine):
    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")
    period_end = int((datetime.now(timezone.utc) + timedelta(days=20)).timestamp())
    await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_g", "checkout.session.completed", uid,
        id="sub_c", customer="cus_c", current_period_end=period_end,
    ))

    r = await client.delete("/api/v1/subscriptions/me", headers=v)
    assert r.status_code == 200
    body = r.json()
    assert body["cancel_at_period_end"] is True
    assert body["status"] == "cancelled"
    assert body["is_entitled"] is True     # paid for it; keep it


async def test_cancel_without_subscription_rejected(client):
    v = await make_viewer(client)
    r = await client.delete("/api/v1/subscriptions/me", headers=v)
    assert r.status_code == 409


# ── the payoff: paid content playback ─────────────────────────────────────────
VIDEO = {"filename": "s.mp4", "content_type": "video/mp4", "media_type": "video"}


async def _published_paid_sermon(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = (await client.post(
        "/api/v1/sermons", json={"title": "Premium", "tier": "paid"}, headers=ed
    )).json()["id"]
    ticket = (await client.post(
        f"/api/v1/sermons/{sid}/upload-url", json=VIDEO, headers=ed
    )).json()
    await client.post(f"/api/v1/uploads/{ticket['job_id']}/confirm", headers=ed)
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)
    return sid


async def test_subscriber_can_stream_paid_content(client, engine):
    """End to end: paid sermon blocked, subscribe, then playable."""
    sid = await _published_paid_sermon(client, engine)
    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")

    blocked = await client.get(f"/api/v1/sermons/{sid}/stream", headers=v)
    assert blocked.status_code == 403
    assert blocked.json()["detail"]["upgrade_required"] is True

    await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_pay", "checkout.session.completed", uid,
        id="sub_pay", customer="cus_pay",
        current_period_end=int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp()),
    ))

    allowed = await client.get(f"/api/v1/sermons/{sid}/stream", headers=v)
    assert allowed.status_code == 200
    assert allowed.json()["variants"]


async def test_subscriber_sees_unlocked_in_catalog(client, engine):
    sid = await _published_paid_sermon(client, engine)
    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")

    before = (await client.get("/api/v1/catalog/sermons", headers=v)).json()
    assert next(i for i in before if i["id"] == sid)["locked"] is True

    await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_cat", "checkout.session.completed", uid,
        id="sub_cat", customer="cus_cat",
        current_period_end=int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp()),
    ))

    after = (await client.get("/api/v1/catalog/sermons", headers=v)).json()
    assert next(i for i in after if i["id"] == sid)["locked"] is False


# ── reconciliation sweep ──────────────────────────────────────────────────────
async def test_expire_lapsed_revokes_past_period_end(client, engine):
    """Safety net for missed webhooks: a lapsed period must not grant access."""
    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")
    await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_h", "checkout.session.completed", uid, id="sub_l", customer="cus_l",
        current_period_end=int((datetime.now(timezone.utc) - timedelta(days=1)).timestamp()),
    ))

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
    from app.services import subscription_service

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        count = await subscription_service.expire_lapsed(s)
    assert count == 1

    me = (await client.get("/api/v1/subscriptions/me", headers=v)).json()
    assert me["tier"] == "free"
    assert me["is_entitled"] is False
