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


async def test_cancelled_but_entitled_member_cannot_open_second_checkout(
    client, engine
):
    """finding 5: a member inside a paid period they already bought — cancelled
    or not — cannot open a second checkout. The cancelled case gets a 409 that
    points at the billing portal. Pre-fix (`... and not sub.cancel_at_period_end`)
    this returns 200 and a checkout URL, orphaning a provider subscription."""
    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")
    period_end = int((datetime.now(timezone.utc) + timedelta(days=20)).timestamp())
    await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_dc", "checkout.session.completed", uid,
        id="sub_dc", customer="cus_dc", current_period_end=period_end,
    ))
    await client.delete("/api/v1/subscriptions/me", headers=v)

    r = await client.post(
        "/api/v1/subscriptions/checkout", json={"tier": "monthly"}, headers=v
    )
    assert r.status_code == 409
    assert "portal" in r.json()["detail"].lower()


async def test_fully_lapsed_member_can_resubscribe(client, engine):
    """Anti-regression guard for the Step 8 risk: a member whose entitlement
    has FULLY expired (tier back to free, status expired, valid_until past)
    must still be able to give the church money. Passes before and after the
    fix — it exists to fail loudly if the guard is ever tightened into a
    lockout. Do not weaken it."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.services import subscription_service

    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")
    past = int((datetime.now(timezone.utc) - timedelta(days=1)).timestamp())
    await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_lm", "checkout.session.completed", uid,
        id="sub_lm", customer="cus_lm", current_period_end=past,
    ))

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        assert await subscription_service.expire_lapsed(s) == 1

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


# ── provider seam: subscription period-end retrieval (Step 5) ─────────────────
async def test_mock_provider_returns_seeded_or_none_period_end(client):
    """The provider seam added for finding 4: unknown id -> None; a seeded id
    -> the seeded period end. MockProvider stays constructible with no args and
    offline."""
    from datetime import datetime, timedelta, timezone

    from app.core.payments import get_provider

    provider = get_provider()
    assert (
        provider.get_subscription_period_end(subscription_id="sub_unknown")
        is None
    )

    end = datetime.now(timezone.utc) + timedelta(days=30)
    provider.set_subscription_period_end("sub_seeded", end)
    assert (
        provider.get_subscription_period_end(subscription_id="sub_seeded") == end
    )


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


async def test_webhook_records_subscription_id_when_resolved(client, engine):
    """W16: an event that resolves to a local Subscription writes that
    subscription's id onto the ledger row (plan §A.4). Nothing reads it in
    Phase 2 — the assertion is straight off the table."""
    import uuid as _uuid

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import ProcessedWebhook, Subscription

    await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")
    r = await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_subid_hit", "checkout.session.completed", uid,
        id="sub_subid", customer="cus_subid",
    ))
    assert r.status_code == 200

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        sub_id = (await s.execute(
            select(Subscription.id).where(Subscription.user_id == _uuid.UUID(uid))
        )).scalar_one()
        row = (await s.execute(
            select(ProcessedWebhook).where(ProcessedWebhook.event_id == "evt_subid_hit")
        )).scalar_one()
    assert row.subscription_id == sub_id


async def test_webhook_records_null_subscription_id_when_unresolved(client, engine):
    """W16: an event that matches no local Subscription writes NULL — the
    column is nullable precisely because `_find_subscription` legitimately
    returns None (plan §A.4)."""
    import uuid as _uuid

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import ProcessedWebhook

    # A well-formed uuid that owns no subscription row, and no provider
    # subscription id in the payload → `_find_subscription` returns None.
    orphan_uid = str(_uuid.uuid4())
    r = await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_subid_miss", "invoice.payment_failed", orphan_uid,
    ))
    assert r.status_code == 200

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        row = (await s.execute(
            select(ProcessedWebhook).where(ProcessedWebhook.event_id == "evt_subid_miss")
        )).scalar_one()
    assert row.subscription_id is None


async def test_concurrent_duplicate_webhook_returns_duplicate_ignored(
    client, engine, monkeypatch
):
    """A duplicate delivery that slips past the `_already_processed` pre-check
    (a genuine race) must not 500. The race window — another delivery commits
    its ledger row between our check and our commit — is injected
    deterministically here. Pre-fix: the commit raises an uncaught
    IntegrityError on `uq_webhook_provider_event`. Post-fix: it is caught,
    rolled back, and returned as `duplicate_ignored`, with exactly one
    processed_webhooks row.
    """
    from sqlalchemy import func, select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import ProcessedWebhook
    from app.services import subscription_service

    await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")
    ev = sub_event(
        "evt_race", "checkout.session.completed", uid,
        id="sub_race", customer="cus_race",
    )

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    real_check = subscription_service._already_processed

    async def racing_check(db, provider, event_id):
        already = await real_check(db, provider, event_id)
        if not already:
            # The concurrent winner commits its ledger row + effect in full.
            async with Session() as other:
                other.add(ProcessedWebhook(
                    provider=provider, event_id=event_id,
                    event_type="checkout.session.completed",
                ))
                await other.commit()
        return already

    monkeypatch.setattr(
        subscription_service, "_already_processed", racing_check
    )

    async with Session() as s:
        outcome = await subscription_service.handle_webhook(s, ev)
    assert outcome == "duplicate_ignored"

    async with Session() as s:
        count = (await s.execute(
            select(func.count()).select_from(ProcessedWebhook).where(
                ProcessedWebhook.event_id == "evt_race"
            )
        )).scalar_one()
    assert count == 1


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


def _parse_dt(value: str):
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def test_checkout_expires_at_is_not_used_for_valid_until(client, engine):
    """finding 4: a checkout session's `expires_at` (the payment link's ~24h
    expiry) must never become `valid_until`. The real period end is sourced
    from the provider. Pre-fix `valid_until` lands ~24h out and `expire_lapsed`
    would revoke the payer ~1 day in."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.core.payments import get_provider
    from app.services import subscription_service

    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")
    thirty_days = datetime.now(timezone.utc) + timedelta(days=30)
    get_provider().set_subscription_period_end("sub_ea", thirty_days)
    link_expiry = int(
        (datetime.now(timezone.utc) + timedelta(hours=24)).timestamp()
    )

    r = await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_ea", "checkout.session.completed", uid,
        id="sub_ea", customer="cus_ea", expires_at=link_expiry,
    ))
    assert r.json()["outcome"] == "activated"

    me = (await client.get("/api/v1/subscriptions/me", headers=v)).json()
    valid_until = _parse_dt(me["valid_until"])
    # ~30 days, emphatically not ~24h.
    assert valid_until > datetime.now(timezone.utc) + timedelta(days=25)

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        assert await subscription_service.expire_lapsed(s) == 0
    me2 = (await client.get("/api/v1/subscriptions/me", headers=v)).json()
    assert me2["is_entitled"] is True


async def test_checkout_unresolvable_period_end_does_not_500(client, engine):
    """finding 4: when neither the event nor the provider yields a period end,
    the webhook still returns 200/activated and `valid_until` is left unset —
    never the `expires_at` value. Pre-fix `valid_until` becomes ~24h."""
    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")
    link_expiry = int(
        (datetime.now(timezone.utc) + timedelta(hours=24)).timestamp()
    )

    r = await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_up", "checkout.session.completed", uid,
        id="sub_up", customer="cus_up", expires_at=link_expiry,
    ))
    assert r.status_code == 200
    assert r.json()["outcome"] == "activated"

    me = (await client.get("/api/v1/subscriptions/me", headers=v)).json()
    assert me["valid_until"] is None


async def test_checkout_provider_lookup_error_does_not_500(
    client, engine, monkeypatch
):
    """finding 4: a `PaymentError` from the provider period-end lookup is
    logged and swallowed — the activation still commits with `valid_until`
    unset (fail open). Pre-fix the lookup is never reached and `valid_until`
    becomes the `expires_at` value."""
    from app.core.payments import PaymentError, get_provider

    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")

    def boom(*, subscription_id):
        raise PaymentError("provider unavailable")

    monkeypatch.setattr(get_provider(), "get_subscription_period_end", boom)
    link_expiry = int(
        (datetime.now(timezone.utc) + timedelta(hours=24)).timestamp()
    )

    r = await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_pe", "checkout.session.completed", uid,
        id="sub_pe", customer="cus_pe", expires_at=link_expiry,
    ))
    assert r.status_code == 200
    assert r.json()["outcome"] == "activated"

    me = (await client.get("/api/v1/subscriptions/me", headers=v)).json()
    assert me["valid_until"] is None


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


async def test_webhook_uncancel_restores_active(client, engine):
    """An un-cancel in the provider portal (`cancel_at_period_end: false` on
    `customer.subscription.updated`) clears the flag and promotes
    CANCELLED -> ACTIVE. Pre-fix the falsy branch is unhandled, so the row
    stays cancelled forever."""
    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")
    period_end = int((datetime.now(timezone.utc) + timedelta(days=20)).timestamp())
    await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_uc1", "checkout.session.completed", uid,
        id="sub_uc", customer="cus_uc", current_period_end=period_end,
    ))
    await client.delete("/api/v1/subscriptions/me", headers=v)

    r = await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_uc2", "customer.subscription.updated", uid,
        id="sub_uc", cancel_at_period_end=False,
    ))
    assert r.status_code == 200

    me = (await client.get("/api/v1/subscriptions/me", headers=v)).json()
    assert me["status"] == "active"
    assert me["cancel_at_period_end"] is False
    assert me["is_entitled"] is True


async def test_webhook_uncancel_does_not_resurrect_expired(client, engine):
    """Scoping guard: the un-cancel arm promotes CANCELLED only. A row driven
    to EXPIRED by `customer.subscription.deleted` is not revived by a later
    `customer.subscription.updated` carrying `cancel_at_period_end: false`."""
    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")
    await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_rr1", "checkout.session.completed", uid,
        id="sub_rr", customer="cus_rr",
    ))
    await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_rr2", "customer.subscription.deleted", uid, id="sub_rr",
    ))

    r = await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_rr3", "customer.subscription.updated", uid,
        id="sub_rr", cancel_at_period_end=False,
    ))
    assert r.status_code == 200

    me = (await client.get("/api/v1/subscriptions/me", headers=v)).json()
    assert me["status"] == "expired"
    assert me["is_entitled"] is False


async def test_webhook_updated_without_cancel_key_is_inert(client, engine):
    """Scoping guard: a `customer.subscription.updated` that never mentions
    `cancel_at_period_end` leaves a cancelled row cancelled — the falsy arm
    must key on the field being present, not on `obj.get(...)` being falsy."""
    v = await make_viewer(client)
    uid = await user_id_for(engine, "viewer@example.com")
    period_end = int((datetime.now(timezone.utc) + timedelta(days=20)).timestamp())
    await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_in1", "checkout.session.completed", uid,
        id="sub_in", customer="cus_in", current_period_end=period_end,
    ))
    await client.delete("/api/v1/subscriptions/me", headers=v)

    r = await client.post("/api/v1/subscriptions/webhook", json=sub_event(
        "evt_in2", "customer.subscription.updated", uid, id="sub_in",
        current_period_end=period_end,
    ))
    assert r.status_code == 200

    me = (await client.get("/api/v1/subscriptions/me", headers=v)).json()
    assert me["status"] == "cancelled"
    assert me["cancel_at_period_end"] is True


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
