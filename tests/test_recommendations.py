"""GET /api/v1/catalog/sermons/trending and GET /api/v1/me/recommended —
Home's "Trending" and "Recommended for you" shelves (Isaac's call, session
2026-09-29): trending is a 30-day play-count window over public sermons;
recommended is category/speaker affinity from the caller's own
`PlaybackSession` rows, falling back to trending when that history has
nothing to work with.
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


async def make_viewer(client, email="viewer@example.com"):
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
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


async def speaker(client, headers, name):
    r = await client.post("/api/v1/speakers", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def play(client, sid, headers, position=100):
    r = await client.post(
        f"/api/v1/sermons/{sid}/progress",
        json={"position_seconds": position, "watched_delta": position},
        headers=headers,
    )
    assert r.status_code == 200, r.text


# ── trending ────────────────────────────────────────────────────────────────
async def test_trending_orders_by_play_count_desc(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    popular = await publish(client, ed, mgr, title="Popular")
    quiet = await publish(client, ed, mgr, title="Quiet")

    for email in ["a@example.com", "b@example.com", "c@example.com"]:
        h = await make_viewer(client, email)
        await play(client, popular, h)
    h = await make_viewer(client, "d@example.com")
    await play(client, quiet, h)

    rows = (await client.get("/api/v1/catalog/sermons/trending")).json()
    titles = [r["title"] for r in rows]
    assert titles.index("Popular") < titles.index("Quiet")


async def test_trending_excludes_sermons_with_no_recent_plays(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await publish(client, ed, mgr, title="Never played")

    rows = (await client.get("/api/v1/catalog/sermons/trending")).json()
    assert rows == []


async def test_trending_requires_no_auth(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    sid = await publish(client, ed, mgr, title="Public")
    v = await make_viewer(client)
    await play(client, sid, v)

    r = await client.get("/api/v1/catalog/sermons/trending")
    assert r.status_code == 200
    assert len(r.json()) == 1


async def test_trending_ranks_by_viewers_not_one_viewers_replays(client, engine):
    """One person replaying a sermon many times must not outrank a sermon that
    several people watched — `play_count` is per-viewer restarts, not reach."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    replayed = await publish(client, ed, mgr, title="Replayed by one")
    shared = await publish(client, ed, mgr, title="Watched by three")

    fan = await make_viewer(client, "fan@example.com")
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    await play(client, replayed, fan)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await s.execute(text("UPDATE playback_sessions SET play_count = 40"))
        await s.commit()
    for email in ["a@example.com", "b@example.com", "c@example.com"]:
        await play(client, shared, await make_viewer(client, email))

    titles = [r["title"] for r in (await client.get("/api/v1/catalog/sermons/trending")).json()]
    assert titles.index("Watched by three") < titles.index("Replayed by one")


# ── recommended ───────────────────────────────────────────────────────────────
async def test_recommended_surfaces_unwatched_sermon_by_same_speaker(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    spk = await speaker(client, ed, "Pastor A")
    watched = await publish(client, ed, mgr, title="Watched", speaker_id=spk)
    unwatched = await publish(client, ed, mgr, title="Unwatched, same speaker", speaker_id=spk)
    unrelated = await publish(client, ed, mgr, title="Unrelated speaker")

    v = await make_viewer(client)
    await play(client, watched, v)

    rows = (await client.get("/api/v1/me/recommended", headers=v)).json()
    titles = [r["title"] for r in rows]
    assert "Watched" not in titles
    # The affinity match leads; the unrelated sermon only tops the shelf up after it.
    assert titles.index("Unwatched, same speaker") < titles.index("Unrelated speaker")
    assert unwatched and unrelated  # ids created, not unused


async def test_recommended_ranks_a_played_category_above_a_speaker_only_match(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    spk = await speaker(client, ed, "Prophet")
    cat = (await client.post("/api/v1/categories", json={"name": "Faith", "slug": "faith"}, headers=ed)).json()["id"]
    watched = await publish(client, ed, mgr, title="Watched", speaker_id=spk, category_id=cat)
    await publish(client, ed, mgr, title="Same category", speaker_id=spk, category_id=cat)
    await publish(client, ed, mgr, title="Same speaker only", speaker_id=spk)

    v = await make_viewer(client)
    await play(client, watched, v)

    titles = [r["title"] for r in (await client.get("/api/v1/me/recommended", headers=v)).json()]
    assert titles.index("Same category") < titles.index("Same speaker only")


async def test_recommended_fills_the_shelf_beyond_affinity_matches(client, engine):
    """Nii's phone test showed a one-card shelf: the old version stopped at the
    affinity matches. It now tops up with trending, then the newest unplayed."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    spk = await speaker(client, ed, "Pastor A")
    watched = await publish(client, ed, mgr, title="Watched", speaker_id=spk)
    await publish(client, ed, mgr, title="Match", speaker_id=spk)
    for i in range(4):
        await publish(client, ed, mgr, title=f"Other {i}")

    v = await make_viewer(client)
    await play(client, watched, v)

    rows = (await client.get("/api/v1/me/recommended", headers=v)).json()
    assert rows[0]["title"] == "Match"
    assert len(rows) == 5


async def test_recommended_falls_back_to_trending_with_no_watch_history(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    trending_sid = await publish(client, ed, mgr, title="Trending sermon")
    someone = await make_viewer(client, "someone@example.com")
    await play(client, trending_sid, someone)

    fresh_viewer = await make_viewer(client, "fresh@example.com")
    rows = (await client.get("/api/v1/me/recommended", headers=fresh_viewer)).json()

    assert any(r["title"] == "Trending sermon" for r in rows)


async def test_recommended_falls_back_to_trending_when_affinity_has_nothing_left(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    spk = await speaker(client, ed, "Only Speaker")
    only_sermon = await publish(client, ed, mgr, title="Only one, same speaker", speaker_id=spk)
    trending_sid = await publish(client, ed, mgr, title="Trending fallback")

    v = await make_viewer(client)
    await play(client, only_sermon, v)  # watched everything by this speaker
    other = await make_viewer(client, "other@example.com")
    await play(client, trending_sid, other)

    rows = (await client.get("/api/v1/me/recommended", headers=v)).json()
    assert any(r["title"] == "Trending fallback" for r in rows)
    assert not any(r["title"] == "Only one, same speaker" for r in rows)


async def test_recommended_requires_auth(client, engine):
    r = await client.get("/api/v1/me/recommended")
    assert r.status_code in (401, 403)


async def test_recommended_affinity_order_is_stable_across_repeat_calls(client, engine):
    """`list_recommended_sermons`'s affinity branch is deliberately shuffled
    (`_daily_shuffle`) rather than `published_at desc`, so two different shelves
    sharing a candidate pool don't render as literal duplicates. The shuffle is
    seeded by the day + user id specifically so it does NOT reshuffle on every
    refetch — this is the regression that guards that."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    spk = await speaker(client, ed, "Pastor A")
    watched = await publish(client, ed, mgr, title="Watched", speaker_id=spk)
    for i in range(6):
        await publish(client, ed, mgr, title=f"Candidate {i}", speaker_id=spk)

    v = await make_viewer(client)
    await play(client, watched, v)

    first = (await client.get("/api/v1/me/recommended", headers=v)).json()
    second = (await client.get("/api/v1/me/recommended", headers=v)).json()
    assert [r["id"] for r in first] == [r["id"] for r in second]


# ── new releases ────────────────────────────────────────────────────────────
async def test_new_releases_orders_newest_first(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    older = await publish(client, ed, mgr, title="Older release")
    newer = await publish(client, ed, mgr, title="Newer release")

    rows = (await client.get("/api/v1/catalog/sermons/new-releases")).json()
    ids = [r["id"] for r in rows]
    assert ids.index(newer) < ids.index(older)


async def test_new_releases_requires_no_auth(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await publish(client, ed, mgr, title="Public new release")

    r = await client.get("/api/v1/catalog/sermons/new-releases")
    assert r.status_code == 200
    assert len(r.json()) == 1


# ── prophet's catalog ─────────────────────────────────────────────────────────
async def test_prophets_catalog_only_returns_flagged_sermons(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    flagged = await publish(client, ed, mgr, title="Flagged", is_prophets_catalog=True)
    unflagged = await publish(client, ed, mgr, title="Unflagged")

    rows = (await client.get("/api/v1/catalog/sermons/prophets-catalog")).json()
    ids = {r["id"] for r in rows}
    assert flagged in ids
    assert unflagged not in ids


async def test_prophets_catalog_requires_no_auth(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await publish(client, ed, mgr, title="Public catalog pick", is_prophets_catalog=True)

    r = await client.get("/api/v1/catalog/sermons/prophets-catalog")
    assert r.status_code == 200
    assert len(r.json()) == 1


async def test_prophets_catalog_order_is_stable_across_repeat_calls(client, engine):
    """Same rationale/regression guard as the recommended-affinity stability test
    above — `_daily_shuffle` must not reshuffle Prophet's Catalog on every refetch."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    for i in range(6):
        await publish(client, ed, mgr, title=f"Flagged {i}", is_prophets_catalog=True)

    first = (await client.get("/api/v1/catalog/sermons/prophets-catalog")).json()
    second = (await client.get("/api/v1/catalog/sermons/prophets-catalog")).json()
    assert [r["id"] for r in first] == [r["id"] for r in second]


async def test_prophets_catalog_caps_one_episode_per_series(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post("/api/v1/series", json={"title": "A Series"}, headers=ed)).json()
    await publish(
        client, ed, mgr, title="Ep1", series_id=series["id"], episode_number=1, is_prophets_catalog=True,
    )
    await publish(
        client, ed, mgr, title="Ep2", series_id=series["id"], episode_number=2, is_prophets_catalog=True,
    )
    await publish(client, ed, mgr, title="Standalone", is_prophets_catalog=True)

    rows = (await client.get("/api/v1/catalog/sermons/prophets-catalog")).json()
    series_titles = {r["title"] for r in rows if r["title"] in ("Ep1", "Ep2")}
    assert len(series_titles) == 1
    assert any(r["title"] == "Standalone" for r in rows)


# ── hero ────────────────────────────────────────────────────────────────────
async def test_hero_orders_newest_first_and_caps_at_limit(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    older = await publish(client, ed, mgr, title="Older")
    middle = await publish(client, ed, mgr, title="Middle")
    newest = await publish(client, ed, mgr, title="Newest")

    rows = (await client.get("/api/v1/catalog/sermons/hero?limit=3")).json()
    assert [r["id"] for r in rows] == [newest, middle, older]


async def test_hero_requires_no_auth(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    await publish(client, ed, mgr, title="Public hero item")

    r = await client.get("/api/v1/catalog/sermons/hero")
    assert r.status_code == 200
    assert len(r.json()) == 1


async def test_hero_caps_one_episode_per_series(client, engine):
    """The regression this shelf exists to avoid: three hero slots should not be
    spent on two episodes of the same series — Isaac's ask, session 2026-09-30."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post("/api/v1/series", json={"title": "A Series"}, headers=ed)).json()
    await publish(client, ed, mgr, title="Ep1", series_id=series["id"], episode_number=1)
    await publish(client, ed, mgr, title="Ep2", series_id=series["id"], episode_number=2)
    await publish(client, ed, mgr, title="Standalone")

    rows = (await client.get("/api/v1/catalog/sermons/hero?limit=3")).json()
    series_titles = {r["title"] for r in rows if r["title"] in ("Ep1", "Ep2")}
    assert len(series_titles) == 1
    assert len(rows) == 2  # one series episode + the standalone — no third to fill with


async def test_new_releases_allows_multiple_episodes_of_the_same_series(client, engine):
    """The explicit exemption (Isaac's ask: "except new releases") — unlike the hero,
    Trending, Recommended, and Prophet's Catalog, this shelf is NOT capped to one
    episode per series."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post("/api/v1/series", json={"title": "A Series"}, headers=ed)).json()
    await publish(client, ed, mgr, title="Ep1", series_id=series["id"], episode_number=1)
    await publish(client, ed, mgr, title="Ep2", series_id=series["id"], episode_number=2)

    rows = (await client.get("/api/v1/catalog/sermons/new-releases")).json()
    assert {r["title"] for r in rows} == {"Ep1", "Ep2"}


async def test_trending_caps_one_episode_per_series(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post("/api/v1/series", json={"title": "A Series"}, headers=ed)).json()
    ep1 = await publish(client, ed, mgr, title="Ep1", series_id=series["id"], episode_number=1)
    ep2 = await publish(client, ed, mgr, title="Ep2", series_id=series["id"], episode_number=2)

    v = await make_viewer(client)
    await play(client, ep1, v)
    other = await make_viewer(client, "other@example.com")
    await play(client, ep2, other)

    rows = (await client.get("/api/v1/catalog/sermons/trending")).json()
    series_titles = {r["title"] for r in rows if r["title"] in ("Ep1", "Ep2")}
    assert len(series_titles) == 1


async def test_recommended_affinity_caps_one_episode_per_series(client, engine):
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    spk = await speaker(client, ed, "Pastor A")
    series = (await client.post("/api/v1/series", json={"title": "A Series"}, headers=ed)).json()
    watched = await publish(client, ed, mgr, title="Watched", speaker_id=spk)
    await publish(client, ed, mgr, title="Ep1", series_id=series["id"], episode_number=1, speaker_id=spk)
    await publish(client, ed, mgr, title="Ep2", series_id=series["id"], episode_number=2, speaker_id=spk)

    v = await make_viewer(client)
    await play(client, watched, v)

    rows = (await client.get("/api/v1/me/recommended", headers=v)).json()
    series_titles = {r["title"] for r in rows if r["title"] in ("Ep1", "Ep2")}
    assert len(series_titles) == 1
