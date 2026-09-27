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


async def publish(client, ed, mgr, **body):
    sid = (await client.post("/api/v1/sermons", json=body, headers=ed)).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)
    return sid


# ── basic search ──────────────────────────────────────────────────────────────
async def test_search_finds_by_title(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await publish(client, ed, mgr, title="Walking in Grace")
    await publish(client, ed, mgr, title="The Power of Prayer")

    r = await client.get("/api/v1/search?q=grace")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 1
    assert body["results"][0]["title"] == "Walking in Grace"


async def test_search_is_public(client, engine):
    """Anonymous callers can search."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await publish(client, ed, mgr, title="Hope")
    r = await client.get("/api/v1/search?q=hope")
    assert r.status_code == 200 and r.json()["total"] == 1


async def test_unpublished_not_searchable(client, engine):
    """Draft content must not be discoverable through search."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    await client.post("/api/v1/sermons", json={"title": "Secret Draft"}, headers=ed)
    r = await client.get("/api/v1/search?q=secret")
    assert r.json()["total"] == 0


async def test_search_matches_description(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await publish(
        client, ed, mgr, title="Sunday Message",
        description="A study on forgiveness and mercy",
    )
    assert (await client.get("/api/v1/search?q=forgiveness")).json()["total"] == 1


async def test_empty_query_returns_all_published(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await publish(client, ed, mgr, title="One")
    await publish(client, ed, mgr, title="Two")
    assert (await client.get("/api/v1/search")).json()["total"] == 2


async def test_no_match_returns_empty(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await publish(client, ed, mgr, title="Grace")
    body = (await client.get("/api/v1/search?q=zzzznotfound")).json()
    assert body["total"] == 0 and body["results"] == []


# ── filters ───────────────────────────────────────────────────────────────────
async def test_filter_by_speaker(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sp = (await client.post(
        "/api/v1/speakers", json={"name": "Pastor A"}, headers=ed
    )).json()
    await publish(client, ed, mgr, title="With speaker", speaker_id=sp["id"])
    await publish(client, ed, mgr, title="Without speaker")

    body = (await client.get(f"/api/v1/search?speaker_id={sp['id']}")).json()
    assert body["total"] == 1
    assert body["results"][0]["title"] == "With speaker"


async def test_filter_by_series(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post(
        "/api/v1/series", json={"title": "Faith Series"}, headers=ed
    )).json()
    await publish(client, ed, mgr, title="Ep1", series_id=series["id"], episode_number=1)
    await publish(client, ed, mgr, title="Standalone")

    body = (await client.get(f"/api/v1/search?series_id={series['id']}")).json()
    assert body["total"] == 1


async def test_filter_by_tag(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await publish(client, ed, mgr, title="Tagged", tags=["worship", "youth"])
    await publish(client, ed, mgr, title="Untagged")

    body = (await client.get("/api/v1/search?tag=worship")).json()
    assert body["total"] == 1
    assert body["results"][0]["title"] == "Tagged"


async def test_filter_by_tier(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await publish(client, ed, mgr, title="Free one", tier="free")
    await publish(client, ed, mgr, title="Paid one", tier="paid")

    results = (await client.get("/api/v1/search?tier=paid")).json()["results"]
    assert len(results) == 1 and results[0]["title"] == "Paid one"


async def test_tier_filter_total_agrees_with_page(client, engine):
    """finding 6: `total` must be the tier-filtered count, not the pre-filter
    count. Pre-fix the Python post-filter trimmed `results` but left `total` at
    the unfiltered value (4 here)."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    for i in range(3):
        await publish(client, ed, mgr, title=f"Free {i}", tier="free")
    await publish(client, ed, mgr, title="Paid one", tier="paid")

    body = (await client.get("/api/v1/search?tier=paid")).json()
    assert body["total"] == 1
    assert len(body["results"]) == 1
    assert body["results"][0]["title"] == "Paid one"


async def test_tier_filter_paginates_on_the_filtered_set(client, engine):
    """finding 6: paging must partition the tier-filtered set, with `total`
    equal to the tier-filtered count on every page."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    for i in range(4):
        await publish(client, ed, mgr, title=f"Paid {i}", tier="paid")
    for i in range(3):
        await publish(client, ed, mgr, title=f"Free {i}", tier="free")

    page1 = (await client.get("/api/v1/search?tier=paid&limit=2&offset=0")).json()
    page2 = (await client.get("/api/v1/search?tier=paid&limit=2&offset=2")).json()
    assert page1["total"] == 4 and page2["total"] == 4
    assert len(page1["results"]) == 2 and len(page2["results"]) == 2
    ids1 = {r["id"] for r in page1["results"]}
    ids2 = {r["id"] for r in page2["results"]}
    assert not (ids1 & ids2)
    assert all(r["tier"] == "paid" for r in page1["results"] + page2["results"])


async def test_tier_filter_uses_effective_tier_from_series(client, engine):
    """finding 6: a sermon with no explicit tier inside a `paid` series is
    counted and returned under ?tier=paid, and absent from ?tier=free. This is
    what the COALESCE(sermon.tier, series.tier, 'free') is for — a naive
    `WHERE sermon.tier = :tier` would miss it."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    paid_series = (await client.post(
        "/api/v1/series", json={"title": "Paid Series", "tier": "paid"}, headers=ed
    )).json()
    await publish(
        client, ed, mgr, title="Inherits paid",
        series_id=paid_series["id"], episode_number=1,
    )
    await publish(client, ed, mgr, title="Explicit free", tier="free")

    paid = (await client.get("/api/v1/search?tier=paid")).json()
    assert paid["total"] == 1
    assert [r["title"] for r in paid["results"]] == ["Inherits paid"]

    free = (await client.get("/api/v1/search?tier=free")).json()
    assert free["total"] == 1
    assert [r["title"] for r in free["results"]] == ["Explicit free"]


async def test_results_carry_locked_flag(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await publish(client, ed, mgr, title="Premium", tier="paid")
    item = (await client.get("/api/v1/search?q=premium")).json()["results"][0]
    assert item["locked"] is True


# ── pagination ────────────────────────────────────────────────────────────────
async def test_pagination(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    for i in range(5):
        await publish(client, ed, mgr, title=f"Sermon {i}")

    page1 = (await client.get("/api/v1/search?limit=2&offset=0")).json()
    page2 = (await client.get("/api/v1/search?limit=2&offset=2")).json()
    assert page1["total"] == 5 and len(page1["results"]) == 2
    assert len(page2["results"]) == 2
    ids1 = {r["id"] for r in page1["results"]}
    ids2 = {r["id"] for r in page2["results"]}
    assert not (ids1 & ids2)


async def test_limit_is_capped(client, engine):
    r = await client.get("/api/v1/search?limit=999")
    assert r.status_code == 422


# ── autocomplete ──────────────────────────────────────────────────────────────
async def test_suggest_titles(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await publish(client, ed, mgr, title="Grace Abounding")
    r = await client.get("/api/v1/search/suggest?q=gra")
    assert r.status_code == 200
    assert "Grace Abounding" in r.json()


async def test_suggest_requires_two_chars(client):
    r = await client.get("/api/v1/search/suggest?q=a")
    assert r.status_code == 422


# ── three-way grouping (decision 4) ─────────────────────────────────────────
async def test_grouped_fields_empty_without_q(client, engine):
    """Filtered-browse mode (`q` absent) is sermons-only, unchanged."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await client.post(
        "/api/v1/series", json={"title": "Grace Series"}, headers=ed
    )
    await client.post("/api/v1/speakers", json={"name": "Grace Speaker"}, headers=ed)
    await publish(client, ed, mgr, title="One")

    body = (await client.get("/api/v1/search")).json()
    assert body["series"] == [] and body["series_total"] == 0
    assert body["speakers"] == [] and body["speakers_total"] == 0


async def test_grouped_series_and_speakers_match_q(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post(
        "/api/v1/series", json={"title": "Grace Abounding"}, headers=ed
    )).json()
    speaker = (await client.post(
        "/api/v1/speakers", json={"name": "Pastor Grace"}, headers=ed
    )).json()
    await publish(
        client, ed, mgr, title="Grace Series Ep1",
        series_id=series["id"], episode_number=1,
    )
    await publish(client, ed, mgr, title="Unrelated")

    body = (await client.get("/api/v1/search?q=grace")).json()
    assert [s["id"] for s in body["series"]] == [series["id"]]
    assert body["series_total"] == 1
    assert [s["id"] for s in body["speakers"]] == [speaker["id"]]
    assert body["speakers_total"] == 1
    # Sermon results are unaffected by the added groups.
    assert body["total"] == 1
    assert body["results"][0]["title"] == "Grace Series Ep1"


async def test_grouped_series_visibility_matches_get_series(client, engine):
    """An anonymous caller sees the same series in the grouped search result
    that `GET /series` would show them — no separate visibility rule."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    draft = (await client.post(
        "/api/v1/series", json={"title": "Draft Grace Series"}, headers=ed
    )).json()

    # list_series applies no status filter of its own (episode_count scoping
    # is separate) — a draft series is visible there to anon callers too, so
    # the grouped search result must show it as well, not hide it.
    listed = (await client.get("/api/v1/series")).json()
    assert draft["id"] in {s["id"] for s in listed}

    body = (await client.get("/api/v1/search?q=draft+grace")).json()
    assert draft["id"] in {s["id"] for s in body["series"]}


async def test_grouped_speaker_carries_sermon_count(client, engine):
    """Speaker DTO in the grouped result is the same `SpeakerPublic` shape as
    `GET /speakers` — including `sermon_count` semantics."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    speaker = (await client.post(
        "/api/v1/speakers", json={"name": "Grace Preacher"}, headers=ed
    )).json()
    await publish(client, ed, mgr, title="Sermon A", speaker_id=speaker["id"])
    await publish(client, ed, mgr, title="Sermon B", speaker_id=speaker["id"])

    direct = (await client.get(f"/api/v1/speakers/{speaker['id']}")).json()
    body = (await client.get("/api/v1/search?q=grace+preacher")).json()
    assert body["speakers"][0]["sermon_count"] == direct["sermon_count"] == 2


async def test_grouped_no_match_returns_empty_groups(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await publish(client, ed, mgr, title="Something")
    body = (await client.get("/api/v1/search?q=zzzznotfound")).json()
    assert body["series"] == [] and body["series_total"] == 0
    assert body["speakers"] == [] and body["speakers_total"] == 0


async def test_grouped_series_capped_at_group_limit(client, engine):
    """Series/speaker matches are capped at a small fixed limit (5), unlike
    sermon results which page on `limit`/`offset`."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    for i in range(7):
        await client.post(
            "/api/v1/series", json={"title": f"Grace Series {i}"}, headers=ed
        )
    body = (await client.get("/api/v1/search?q=grace")).json()
    assert body["series_total"] == 7
    assert len(body["series"]) == 5
