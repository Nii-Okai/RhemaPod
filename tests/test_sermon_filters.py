"""GET /api/v1/sermons — speaker / series / effective-tier filter bar.

The tier filter matches on the *effective* tier (sermon tier, else series tier,
else free), same COALESCE the catalog/search use, so a sermon that inherits
`paid` from its series is caught by `?tier=paid`.
"""
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


async def _create(client, headers, **body):
    r = await client.post("/api/v1/sermons", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _speaker(client, headers, name):
    r = await client.post("/api/v1/speakers", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _titles(client, headers, query=""):
    r = await client.get(f"/api/v1/sermons{query}", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    return {i["title"] for i in body["items"]}, body["total"]


async def test_filter_by_speaker_id(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    spk_a = await _speaker(client, ed, "Alice")
    spk_b = await _speaker(client, ed, "Bob")

    await _create(client, ed, title="A one", speaker_id=spk_a)
    await _create(client, ed, title="A two", speaker_id=spk_a)
    await _create(client, ed, title="B one", speaker_id=spk_b)

    titles, total = await _titles(client, mgr, f"?speaker_id={spk_a}")
    assert titles == {"A one", "A two"}
    assert total == 2

    titles, total = await _titles(client, mgr, f"?speaker_id={spk_b}")
    assert titles == {"B one"}
    assert total == 1


async def test_filter_by_series_id(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post(
        "/api/v1/series", json={"title": "Faith Series"}, headers=ed
    )).json()

    await _create(client, ed, title="Episode", series_id=series["id"])
    await _create(client, ed, title="Standalone")

    titles, total = await _titles(client, mgr, f"?series_id={series['id']}")
    assert titles == {"Episode"}
    assert total == 1


async def test_filter_by_tier_including_series_inheritance(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")

    paid_series = (await client.post(
        "/api/v1/series", json={"title": "Paid Series", "tier": "paid"}, headers=ed
    )).json()

    await _create(client, ed, title="Explicit free", tier="free")
    await _create(client, ed, title="Explicit paid", tier="paid")
    # tier omitted -> None -> inherits `paid` from the series (effective tier)
    await _create(client, ed, title="Inherited paid", series_id=paid_series["id"])

    paid_titles, paid_total = await _titles(client, mgr, "?tier=paid")
    assert paid_titles == {"Explicit paid", "Inherited paid"}
    assert paid_total == 2

    free_titles, free_total = await _titles(client, mgr, "?tier=free")
    assert free_titles == {"Explicit free"}
    assert free_total == 1


async def test_tier_filter_composes_with_status(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")

    draft_id = await _create(client, ed, title="Draft paid", tier="paid")
    submitted_id = await _create(client, ed, title="Submitted paid", tier="paid")
    await client.post(f"/api/v1/sermons/{submitted_id}/submit", headers=ed)
    await _create(client, ed, title="Draft free", tier="free")

    titles, total = await _titles(client, mgr, "?tier=paid&status=draft")
    assert titles == {"Draft paid"}
    assert total == 1

    titles, total = await _titles(client, mgr, "?tier=paid&status=pending_review")
    assert titles == {"Submitted paid"}
    assert total == 1


async def test_speaker_filter_composes_with_status(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    spk = await _speaker(client, ed, "Carol")

    await _create(client, ed, title="Kept draft", speaker_id=spk)
    submitted = await _create(client, ed, title="Sent for review", speaker_id=spk)
    await client.post(f"/api/v1/sermons/{submitted}/submit", headers=ed)

    titles, total = await _titles(
        client, mgr, f"?speaker_id={spk}&status=draft"
    )
    assert titles == {"Kept draft"}
    assert total == 1
