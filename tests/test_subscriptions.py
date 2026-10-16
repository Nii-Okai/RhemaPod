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


async def entitle(engine, user_id, *, valid_until, tier=None, cancel_at_period_end=False):
    """Make an existing account an ACTIVE paid subscriber by writing its
    `Subscription` row directly through the ORM and busting the entitlement
    cache — no checkout, no webhook, no provider involved.

    Every account gets a FREE `Subscription` row the moment it registers
    (`auth_service.register_user`), so this mutates that row in place rather
    than inserting a second one: `user_id` is unique on the table.
    """
    import uuid as _uuid

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import Subscription, SubscriptionStatus, SubscriptionTier
    from app.services import subscription_service

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        sub = (await s.execute(
            select(Subscription).where(Subscription.user_id == _uuid.UUID(user_id))
        )).scalar_one()
        sub.tier = tier or SubscriptionTier.MONTHLY
        sub.status = SubscriptionStatus.ACTIVE
        sub.valid_until = valid_until
        sub.cancel_at_period_end = cancel_at_period_end
        await s.commit()
        # Invalidate via the ORM-loaded `sub.user_id`, not the raw `user_id`
        # argument: `user_id_for()` reads it back through a raw `text()`
        # SELECT, which skips the UUID type's result processor and can come
        # back as an undashed hex string on SQLite — a different cache key
        # than `is_entitled()` builds from the properly-typed ORM attribute,
        # so the delete would silently miss.
        await subscription_service.invalidate_entitlement(sub.user_id)


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


# ── removed subscription-provider surface ──────────────────────────────────────
async def test_checkout_portal_cancel_webhook_are_removed(client):
    """The four removed subscription endpoints are deleted outright (D6), not left
    dormant. `GET /subscriptions/me` is unaffected."""
    assert (await client.post(
        "/api/v1/subscriptions/checkout", json={"tier": "monthly"}
    )).status_code in (404, 405)
    assert (await client.post("/api/v1/subscriptions/portal")).status_code in (404, 405)
    assert (await client.delete("/api/v1/subscriptions/me")).status_code in (404, 405)
    assert (await client.post("/api/v1/subscriptions/webhook")).status_code in (404, 405)


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

    await entitle(
        engine, uid, valid_until=datetime.now(timezone.utc) + timedelta(days=30)
    )

    allowed = await client.get(f"/api/v1/sermons/{sid}/stream", headers=v)
    assert allowed.status_code == 200
    assert allowed.json()["variants"]


async def test_subscriber_sees_unlocked_in_catalog(client, engine):
    sid = await _published_paid_sermon(client, engine)
    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")

    before = (await client.get("/api/v1/catalog/sermons", headers=v)).json()
    assert next(i for i in before if i["id"] == sid)["locked"] is True

    await entitle(
        engine, uid, valid_until=datetime.now(timezone.utc) + timedelta(days=30)
    )

    after = (await client.get("/api/v1/catalog/sermons", headers=v)).json()
    assert next(i for i in after if i["id"] == sid)["locked"] is False


# ── reconciliation sweep ──────────────────────────────────────────────────────
async def test_expire_lapsed_revokes_past_period_end(client, engine):
    """Safety net for a lapsed period that was never renewed: it must not
    grant access."""
    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")
    await entitle(
        engine, uid, valid_until=datetime.now(timezone.utc) - timedelta(days=1)
    )

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.services import subscription_service

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        count = await subscription_service.expire_lapsed(s)
    assert count == 1

    me = (await client.get("/api/v1/subscriptions/me", headers=v)).json()
    assert me["tier"] == "free"
    assert me["is_entitled"] is False
