"""W20 — staff subscriptions read API.

`GET /api/v1/admin/subscriptions` (+ `/counts`) — Manager+, paginated,
filterable, joined to `User` for name/email. Plan §W20 + §A.3.

Hard constraints, all asserted here (not as comments):
  * no outbound payment-provider call anywhere in either route — structural,
    since there is no payment provider in this codebase at all;
  * `active_paid` == `subscription_service.count_active_paid_subscribers` on
    the same data (and == monthly + annual by construction);
  * the response schema carries no amount / price / currency field;
  * pagination has a hard maximum page size;
  * `require_role(MANAGER, ADMIN)` — editor/viewer 403, manager/admin 200.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.api.admin_subscriptions as admin_subs_module
from app.models.content_schemas import SubscriptionAdminItem
from app.models.models import (
    Subscription,
    SubscriptionStatus,
    SubscriptionTier,
    User,
)
from app.services import subscription_service

# asyncio_mode = "auto" — async tests need no marker.

PW = "correct-horse-battery"
REPO_ROOT = Path(__file__).resolve().parents[1]


def _sf(engine):
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class _RecordingLogger:
    """Stand-in for the router's structlog logger — records every line.

    Same shape as `tests/test_auth_hardening.py::_RecordingLogger`; the codebase
    injects this via `monkeypatch.setattr(module, "log", recorder)` rather than
    `structlog.testing.capture_logs`, which does not intercept a module-level
    logger frozen by `cache_logger_on_first_use=True`.
    """

    def __init__(self) -> None:
        self.records: list[dict] = []

    def _record(self, level: str, event: str, **kw) -> None:
        self.records.append({"level": level, "event": event, **kw})

    def debug(self, event, **kw):
        self._record("debug", event, **kw)

    def info(self, event, **kw):
        self._record("info", event, **kw)

    def warning(self, event, **kw):
        self._record("warning", event, **kw)

    def error(self, event, **kw):
        self._record("error", event, **kw)

    def exception(self, event, **kw):
        self._record("exception", event, **kw)


async def _user_id(engine, email):
    async with _sf(engine)() as s:
        return str((await s.execute(
            select(User.id).where(User.email == email)
        )).scalar_one())


async def register(client, email, role=None, engine=None):
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    if role is not None:
        async with _sf(engine)() as s:
            await s.execute(
                text("UPDATE users SET role = :r WHERE email = :e"),
                {"r": role.upper(), "e": email},
            )
            await s.commit()
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": email, "password": PW}
    )).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def seed_sub(
    engine,
    email,
    tier=SubscriptionTier.MONTHLY,
    status=SubscriptionStatus.ACTIVE,
    *,
    customer_id=None,
    full_name=None,
    valid_until=None,
    created_at=None,
):
    """Create a User + its Subscription row directly through the DB fixture."""
    async with _sf(engine)() as s:
        u = User(
            email=email,
            password_hash="x" * 20,
            full_name=full_name,
        )
        s.add(u)
        await s.flush()
        sub = Subscription(
            user_id=u.id,
            tier=tier,
            status=status,
            provider_customer_id=customer_id,
            valid_until=valid_until,
        )
        if created_at is not None:
            # Override the server_default so a test can force a timestamp
            # collision across rows.
            sub.created_at = created_at
        s.add(sub)
        await s.commit()
        return str(u.id), str(sub.id)


# ── require_role(MANAGER, ADMIN) ─────────────────────────────────────────────
async def test_list_and_counts_enforce_manager_plus(client, engine):
    admin = await register(client, "admin@example.com", "admin", engine)
    manager = await register(client, "mgr@example.com", "manager", engine)
    editor = await register(client, "editor@example.com", "editor", engine)
    viewer = await register(client, "viewer@example.com")  # defaults to viewer

    for path in ("/api/v1/admin/subscriptions", "/api/v1/admin/subscriptions/counts"):
        assert (await client.get(path, headers=editor)).status_code == 403
        assert (await client.get(path, headers=viewer)).status_code == 403
        assert (await client.get(path, headers=manager)).status_code == 200
        assert (await client.get(path, headers=admin)).status_code == 200


async def test_list_unauthenticated_is_rejected(client, engine):
    r = await client.get("/api/v1/admin/subscriptions")
    # `HTTPBearer(auto_error=True)` on this codebase — "no credentials" is 401,
    # not 403 (which is "authenticated but wrong role").
    assert r.status_code == 401


# ── joined to User for name + email ─────────────────────────────────────────
async def test_list_row_joins_user_name_and_email(client, engine):
    admin = await register(client, "admin@example.com", "admin", engine)
    uid, sid = await seed_sub(
        engine, "paid@example.com", full_name="Paid Member",
        customer_id="cus_live_1",
    )

    body = (await client.get(
        "/api/v1/admin/subscriptions", headers=admin
    )).json()
    row = next(r for r in body["items"] if r["id"] == sid)
    assert row["user_id"] == uid
    assert row["user_name"] == "Paid Member"
    assert row["user_email"] == "paid@example.com"
    assert row["provider_customer_id"] == "cus_live_1"
    assert row["tier"] == "monthly"
    assert row["status"] == "active"
    assert "current_period_end" in row


async def test_list_null_customer_id_passes_through(client, engine):
    admin = await register(client, "admin@example.com", "admin", engine)
    _, sid = await seed_sub(engine, "nocard@example.com", customer_id=None)

    body = (await client.get(
        "/api/v1/admin/subscriptions", headers=admin
    )).json()
    row = next(r for r in body["items"] if r["id"] == sid)
    # Null (not absent, not disabled-string) — the admin portal hides the
    # external provider-dashboard link on exactly this.
    assert row["provider_customer_id"] is None


# ── filters ────────────────────────────────────────────────────────────────
async def test_list_filters_by_status_and_tier(client, engine):
    # NB: registering `admin` also creates its own FREE/ACTIVE subscription row
    # (auth_service.register_user), so `status=active` assertions use a subset
    # check; the tier / past_due filters exclude that row and are exact.
    admin = await register(client, "admin@example.com", "admin", engine)
    await seed_sub(engine, "m_active@example.com",
                   SubscriptionTier.MONTHLY, SubscriptionStatus.ACTIVE)
    await seed_sub(engine, "a_active@example.com",
                   SubscriptionTier.ANNUAL, SubscriptionStatus.ACTIVE)
    await seed_sub(engine, "m_pastdue@example.com",
                   SubscriptionTier.MONTHLY, SubscriptionStatus.PAST_DUE)
    await seed_sub(engine, "a_expired@example.com",
                   SubscriptionTier.ANNUAL, SubscriptionStatus.EXPIRED)

    by_tier = (await client.get(
        "/api/v1/admin/subscriptions?tier=monthly", headers=admin
    )).json()
    assert by_tier["total"] == 2
    assert all(r["tier"] == "monthly" for r in by_tier["items"])
    assert {r["user_email"] for r in by_tier["items"]} == {
        "m_active@example.com", "m_pastdue@example.com"
    }

    by_status = (await client.get(
        "/api/v1/admin/subscriptions?status=past_due", headers=admin
    )).json()
    assert by_status["total"] == 1
    assert by_status["items"][0]["user_email"] == "m_pastdue@example.com"

    both = (await client.get(
        "/api/v1/admin/subscriptions?status=active&tier=annual", headers=admin
    )).json()
    assert both["total"] == 1
    assert both["items"][0]["user_email"] == "a_active@example.com"

    # `status=active` also matches admin's own FREE/ACTIVE row — subset check.
    active = (await client.get(
        "/api/v1/admin/subscriptions?status=active", headers=admin
    )).json()
    assert all(r["status"] == "active" for r in active["items"])
    assert {"m_active@example.com", "a_active@example.com"} <= {
        r["user_email"] for r in active["items"]
    }


async def test_list_rejects_unknown_filter_values(client, engine):
    admin = await register(client, "admin@example.com", "admin", engine)
    assert (await client.get(
        "/api/v1/admin/subscriptions?status=bogus", headers=admin
    )).status_code == 422
    assert (await client.get(
        "/api/v1/admin/subscriptions?tier=platinum", headers=admin
    )).status_code == 422


# ── pagination + hard maximum page size ────────────────────────────────────
async def test_list_paginates(client, engine):
    admin = await register(client, "admin@example.com", "admin", engine)
    # Seed 5 ANNUAL rows and page within `tier=annual` so admin's own FREE row
    # does not perturb the totals.
    for i in range(5):
        await seed_sub(engine, f"s{i}@example.com", SubscriptionTier.ANNUAL)

    page = (await client.get(
        "/api/v1/admin/subscriptions?tier=annual&limit=2&offset=0", headers=admin
    )).json()
    assert page["total"] == 5
    assert page["limit"] == 2
    assert page["offset"] == 0
    assert len(page["items"]) == 2

    page2 = (await client.get(
        "/api/v1/admin/subscriptions?tier=annual&limit=2&offset=4", headers=admin
    )).json()
    assert page2["total"] == 5
    assert len(page2["items"]) == 1

    # No overlap between pages; union covers the seeded set.
    seen = {r["id"] for r in page["items"]}
    p1 = (await client.get(
        "/api/v1/admin/subscriptions?tier=annual&limit=2&offset=2", headers=admin
    )).json()
    seen |= {r["id"] for r in p1["items"]} | {r["id"] for r in page2["items"]}
    assert len(seen) == 5


async def test_list_pagination_is_stable_when_created_at_collides(client, engine):
    """>=3 rows sharing an identical `created_at` must still partition cleanly
    across pages.

    `created_at` is `server_default=func.now()` — transaction-start time on
    Postgres, 1s resolution on SQLite — so equal timestamps are ordinary.
    `ORDER BY created_at DESC` alone is not a total order; `id DESC` is the
    deterministic tiebreaker. Without it a paged client repeats or drops a row
    when timestamps collide, which W21's paginated table would surface.
    """
    admin = await register(client, "admin@example.com", "admin", engine)
    ts = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    seeded = []
    for i in range(5):
        _, sid = await seed_sub(
            engine, f"c{i}@example.com", SubscriptionTier.ANNUAL, created_at=ts
        )
        seeded.append(sid)

    pages = []
    for off in (0, 2, 4):
        body = (await client.get(
            f"/api/v1/admin/subscriptions?tier=annual&limit=2&offset={off}",
            headers=admin,
        )).json()
        assert body["total"] == 5
        pages.append([r["id"] for r in body["items"]])

    ordered = pages[0] + pages[1] + pages[2]
    # No gap and no overlap: the three pages partition the seeded set exactly.
    assert len(ordered) == 5
    assert set(ordered) == set(seeded)
    # Deterministic: `id` desc within the identical timestamp. Repeated calls to
    # the same window return the same rows.
    assert ordered == sorted(seeded, reverse=True)
    again = (await client.get(
        "/api/v1/admin/subscriptions?tier=annual&limit=2&offset=2", headers=admin
    )).json()
    assert [r["id"] for r in again["items"]] == pages[1]


async def test_list_has_hard_maximum_page_size(client, engine):
    admin = await register(client, "admin@example.com", "admin", engine)
    # Over the ceiling is rejected outright — not silently served as a huge page.
    assert (await client.get(
        "/api/v1/admin/subscriptions?limit=1000", headers=admin
    )).status_code == 422
    assert (await client.get(
        "/api/v1/admin/subscriptions?limit=101", headers=admin
    )).status_code == 422
    assert (await client.get(
        "/api/v1/admin/subscriptions?limit=100", headers=admin
    )).status_code == 200


# ── no monetary field, anywhere ───────────────────────────────────────────
_FORBIDDEN = ("amount", "price", "currency", "mrr", "cents", "revenue")


def test_dto_has_no_monetary_attribute():
    fields = set(SubscriptionAdminItem.model_fields)
    assert fields == {
        "id", "user_id", "user_name", "user_email", "tier", "status",
        "current_period_end", "provider_customer_id", "created_at",
    }
    for name in fields:
        assert not any(bad in name.lower() for bad in _FORBIDDEN)


def test_openapi_schema_has_no_monetary_field():
    spec = json.loads((REPO_ROOT / "openapi.json").read_text())
    schemas = spec["components"]["schemas"]
    assert "SubscriptionAdminItem" in schemas
    assert "SubscriptionCounts" in schemas

    item = schemas["SubscriptionAdminItem"]
    for prop in item["properties"]:
        assert not any(bad in prop.lower() for bad in _FORBIDDEN), prop
    assert not any(
        bad in r.lower() for r in item["required"] for bad in _FORBIDDEN
    )
    # Grep the property definitions (names, titles, types, $refs) — not the
    # human-readable class description, which legitimately names the fields
    # that are deliberately absent.
    blob = json.dumps(item["properties"]).lower()
    for bad in ("amount", "price", "currency"):
        assert bad not in blob
    # The counts DTO is three integers and nothing else.
    assert set(schemas["SubscriptionCounts"]["properties"]) == {
        "active_paid", "monthly", "annual"
    }


async def test_response_rows_carry_no_monetary_key(client, engine):
    admin = await register(client, "admin@example.com", "admin", engine)
    await seed_sub(engine, "paid@example.com", customer_id="cus_1")

    body = (await client.get(
        "/api/v1/admin/subscriptions", headers=admin
    )).json()
    for row in body["items"]:
        for key in row:
            assert not any(bad in key.lower() for bad in _FORBIDDEN)

    counts = (await client.get(
        "/api/v1/admin/subscriptions/counts", headers=admin
    )).json()
    assert set(counts) == {"active_paid", "monthly", "annual"}


# ── active_paid == count_active_paid_subscribers on the same data ──────────
async def test_counts_active_paid_matches_service_function(client, engine):
    admin = await register(client, "admin@example.com", "admin", engine)

    # A deliberate mix across every tier x status.
    await seed_sub(engine, "m_active@example.com",
                   SubscriptionTier.MONTHLY, SubscriptionStatus.ACTIVE)
    await seed_sub(engine, "m_active2@example.com",
                   SubscriptionTier.MONTHLY, SubscriptionStatus.ACTIVE)
    await seed_sub(engine, "m_cancelled@example.com",
                   SubscriptionTier.MONTHLY, SubscriptionStatus.CANCELLED)
    await seed_sub(engine, "a_active@example.com",
                   SubscriptionTier.ANNUAL, SubscriptionStatus.ACTIVE)
    await seed_sub(engine, "a_cancelled@example.com",
                   SubscriptionTier.ANNUAL, SubscriptionStatus.CANCELLED)
    # These must NOT count toward active_paid.
    await seed_sub(engine, "m_pastdue@example.com",
                   SubscriptionTier.MONTHLY, SubscriptionStatus.PAST_DUE)
    await seed_sub(engine, "a_expired@example.com",
                   SubscriptionTier.ANNUAL, SubscriptionStatus.EXPIRED)
    await seed_sub(engine, "free@example.com",
                   SubscriptionTier.FREE, SubscriptionStatus.ACTIVE)

    counts = (await client.get(
        "/api/v1/admin/subscriptions/counts", headers=admin
    )).json()

    async with _sf(engine)() as s:
        expected = await subscription_service.count_active_paid_subscribers(s)

    # 2 monthly active + 1 monthly cancelled + 1 annual active + 1 annual
    # cancelled = 5. past_due / expired / free are excluded.
    assert counts["active_paid"] == expected == 5
    assert counts["monthly"] == 3
    assert counts["annual"] == 2
    # Holds by construction — same status predicate, partitioned by tier.
    assert counts["active_paid"] == counts["monthly"] + counts["annual"]


# ── audit logging (CWE-778) ──────────────────────────────────────────────────
_PII_TOKENS = ("@example.com", "provider_customer_id", "cus_", "user_name", "full_name")


async def test_list_emits_audit_line_with_actor_and_filters(
    client, engine, monkeypatch
):
    admin = await register(client, "admin@example.com", "admin", engine)
    admin_id = await _user_id(engine, "admin@example.com")
    await seed_sub(engine, "m@example.com",
                   SubscriptionTier.MONTHLY, SubscriptionStatus.ACTIVE,
                   customer_id="cus_live_x", full_name="Paid Member")

    recorder = _RecordingLogger()
    monkeypatch.setattr(admin_subs_module, "log", recorder)

    r = await client.get(
        "/api/v1/admin/subscriptions?status=active&tier=monthly&limit=10&offset=0",
        headers=admin,
    )
    assert r.status_code == 200

    lines = [x for x in recorder.records if x["event"] == "admin_subscriptions_listed"]
    assert len(lines) == 1
    line = lines[0]
    assert line["actor_user_id"] == admin_id
    assert line["status_filter"] == "active"
    assert line["tier_filter"] == "monthly"
    assert line["offset"] == 0
    assert line["limit"] == 10
    assert line["returned"] == len(r.json()["items"])
    # No emails / names / customer ids in the audit line.
    blob = json.dumps(line).lower()
    assert not any(bad in blob for bad in _PII_TOKENS)


async def test_list_audit_line_records_absent_filters_as_null(
    client, engine, monkeypatch
):
    admin = await register(client, "admin@example.com", "admin", engine)
    recorder = _RecordingLogger()
    monkeypatch.setattr(admin_subs_module, "log", recorder)

    r = await client.get("/api/v1/admin/subscriptions", headers=admin)
    assert r.status_code == 200

    line = next(
        x for x in recorder.records if x["event"] == "admin_subscriptions_listed"
    )
    assert line["status_filter"] is None
    assert line["tier_filter"] is None


async def test_counts_emits_audit_line_with_actor_and_counts(
    client, engine, monkeypatch
):
    admin = await register(client, "admin@example.com", "admin", engine)
    admin_id = await _user_id(engine, "admin@example.com")
    await seed_sub(engine, "m@example.com",
                   SubscriptionTier.MONTHLY, SubscriptionStatus.ACTIVE)
    await seed_sub(engine, "a@example.com",
                   SubscriptionTier.ANNUAL, SubscriptionStatus.ACTIVE)

    recorder = _RecordingLogger()
    monkeypatch.setattr(admin_subs_module, "log", recorder)

    r = await client.get("/api/v1/admin/subscriptions/counts", headers=admin)
    assert r.status_code == 200
    body = r.json()

    lines = [
        x for x in recorder.records
        if x["event"] == "admin_subscriptions_counts_read"
    ]
    assert len(lines) == 1
    line = lines[0]
    assert line["actor_user_id"] == admin_id
    assert line["active_paid"] == body["active_paid"]
    assert line["monthly"] == body["monthly"]
    assert line["annual"] == body["annual"]
    blob = json.dumps(line).lower()
    assert not any(bad in blob for bad in _PII_TOKENS)


# ── Cache-Control: no-store on the PII responses ────────────────────────────
async def test_pii_responses_are_not_cacheable(client, engine):
    admin = await register(client, "admin@example.com", "admin", engine)
    await seed_sub(engine, "m@example.com")

    for path in (
        "/api/v1/admin/subscriptions",
        "/api/v1/admin/subscriptions/counts",
    ):
        r = await client.get(path, headers=admin)
        assert r.status_code == 200
        assert r.headers["cache-control"] == "no-store"
