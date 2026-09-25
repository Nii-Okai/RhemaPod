"""Coverage for GET /series/{id}/episodes — new in this stream (finding 7).

The endpoint had no test at all. It hard-coded `has_subscription=False`, so a
paid episode showed `locked: true` even to an entitled subscriber.
"""
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
            text("UPDATE users SET role = :r WHERE email = :e"),
            {"r": role.upper(), "e": email},
        )
        await s.commit()
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


async def publish_episode(client, ed, mgr, series_id, episode_number=1, title="Ep1"):
    sid = (await client.post(
        "/api/v1/sermons",
        json={"title": title, "series_id": series_id, "episode_number": episode_number},
        headers=ed,
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)
    return sid


async def activate_subscription(client, engine, email):
    """Register + entitle a viewer via the webhook path, return auth headers."""
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    uid = await user_id_for(engine, email)
    period_end = int(
        (datetime.now(timezone.utc) + timedelta(days=30)).timestamp()
    )
    await client.post("/api/v1/subscriptions/webhook", json={
        "id": f"evt_{email}",
        "type": "checkout.session.completed",
        "data": {"object": {
            "metadata": {"user_id": uid, "tier": "monthly"},
            "id": f"sub_{email}", "customer": f"cus_{email}",
            "current_period_end": period_end,
        }},
    })
    tokens = (await client.post(
        "/api/v1/auth/login", json={"email": email, "password": PW}
    )).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def test_series_episodes_locked_for_anonymous(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post(
        "/api/v1/series", json={"title": "Paid Series", "tier": "paid"}, headers=ed
    )).json()
    await publish_episode(client, ed, mgr, series["id"])

    episodes = (await client.get(
        f"/api/v1/series/{series['id']}/episodes"
    )).json()
    assert len(episodes) == 1
    assert episodes[0]["tier"] == "paid"
    assert episodes[0]["locked"] is True


async def test_series_episodes_unlocked_for_entitled_subscriber(client, engine):
    """finding 7: an entitled subscriber must see `locked: false`. Pre-fix the
    endpoint hard-codes has_subscription=False and the subscriber still sees
    `true`."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post(
        "/api/v1/series", json={"title": "Paid Series", "tier": "paid"}, headers=ed
    )).json()
    await publish_episode(client, ed, mgr, series["id"])

    sub = await activate_subscription(client, engine, "sub@example.com")
    episodes = (await client.get(
        f"/api/v1/series/{series['id']}/episodes", headers=sub
    )).json()
    assert len(episodes) == 1
    assert episodes[0]["locked"] is False


async def test_series_episodes_renumbered_contiguous_on_public_read(client, engine):
    """W2.3 / plan L11: a series with real episode_number 1, 2, 5 (a gap left
    by e.g. a deleted episode 3-4) reads as 1, 2, 3 on the public endpoint.
    The admin-facing read (`GET /sermons?series_id=`, used by the portal's
    episode-order panel) and the DB must still show the real numbers.
    """
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post(
        "/api/v1/series", json={"title": "Gappy Series"}, headers=ed
    )).json()
    await publish_episode(client, ed, mgr, series["id"], episode_number=1, title="One")
    await publish_episode(client, ed, mgr, series["id"], episode_number=2, title="Two")
    await publish_episode(client, ed, mgr, series["id"], episode_number=5, title="Five")

    public = (await client.get(f"/api/v1/series/{series['id']}/episodes")).json()
    assert [e["episode_number"] for e in public] == [1, 2, 3]
    # Order and identity are preserved — only the number changes.
    assert [e["title"] for e in public] == ["One", "Two", "Five"]

    admin = (await client.get(
        f"/api/v1/sermons?series_id={series['id']}", headers=mgr
    )).json()["items"]
    admin_numbers = sorted(item["episode_number"] for item in admin)
    assert admin_numbers == [1, 2, 5]

    # Raw-text SQL would compare against the ORM's UUID storage format
    # (opaque on SQLite), so go through the mapped column like the app does.
    import uuid as uuid_module

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import Sermon

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        numbers = (await s.execute(
            select(Sermon.episode_number).where(
                Sermon.series_id == uuid_module.UUID(series["id"])
            )
        )).scalars().all()
    assert sorted(numbers) == [1, 2, 5]


async def test_series_episodes_hides_gap_from_invisible_episode(client, engine):
    """An episode that exists but isn't visible to a member (still a draft)
    is exactly the kind of gap L11 hides. Numbering runs over the visible
    set only, in episode_number order — the draft's slot disappears from the
    public sequence rather than leaving a hole or a null.
    """
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post(
        "/api/v1/series", json={"title": "Draft Gap Series"}, headers=ed
    )).json()
    await publish_episode(client, ed, mgr, series["id"], episode_number=1, title="One")
    # episode_number=2 stays a draft — never submitted/approved/published.
    await client.post(
        "/api/v1/sermons",
        json={"title": "Two (draft)", "series_id": series["id"], "episode_number": 2},
        headers=ed,
    )
    await publish_episode(client, ed, mgr, series["id"], episode_number=3, title="Three")

    public = (await client.get(f"/api/v1/series/{series['id']}/episodes")).json()
    assert [e["title"] for e in public] == ["One", "Three"]
    assert [e["episode_number"] for e in public] == [1, 2]

    # The draft still carries its real, editor-owned number on the staff read.
    admin = (await client.get(
        f"/api/v1/sermons?series_id={series['id']}", headers=mgr
    )).json()["items"]
    admin_by_title = {item["title"]: item["episode_number"] for item in admin}
    assert admin_by_title == {"One": 1, "Two (draft)": 2, "Three": 3}
