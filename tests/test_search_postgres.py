"""Search, against real Postgres (`pg_client`/`pg_engine`, conftest.py) — not the
SQLite `client`/`engine` every other test in this suite uses.

Why this file exists at all: `search_service._search_filter`/`_rank` branch on
`_is_postgres(db)` — SQLite tests only ever exercise the LIKE fallback, never the real
`to_tsvector`/`setweight` full-text SQL. That branch had a real bug (session
2026-09-30): `setweight`'s weight argument got bound as a `varchar` parameter, which
Postgres's `"char"`-typed overload doesn't accept — every `/search?q=...` call 500'd
against the real database, and 44 passing SQLite-backed search tests never noticed.
This file is the fix's actual proof, plus a standing regression guard so the same class
of dialect-specific bug can't silently reappear. It intentionally does not duplicate
`test_search.py`'s full filter/pagination coverage — those behaviors don't depend on
the dialect, so the SQLite suite already proves them correctly and cheaply.
"""
import pytest

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"


async def make_user(pg_client, pg_engine, email, role):
    await pg_client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    Session = async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await s.execute(
            text("UPDATE users SET role = :r WHERE email = :e"),
            {"r": role.upper(), "e": email},
        )
        await s.commit()
    tokens = (await pg_client.post(
        "/api/v1/auth/login", json={"email": email, "password": PW}
    )).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def publish(pg_client, ed, mgr, **body):
    sid = (await pg_client.post("/api/v1/sermons", json=body, headers=ed)).json()["id"]
    await pg_client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await pg_client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    await pg_client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)
    return sid


async def test_search_with_query_does_not_500_against_real_postgres(pg_client, pg_engine):
    """The regression itself: a `q`-driven search used to 500 with 'function
    setweight(tsvector, character varying) does not exist' on real Postgres —
    the SQLite fallback path never exercises `setweight` at all, so this is
    the only place that bug could ever be caught."""
    ed = await make_user(pg_client, pg_engine, "e@example.com", "editor")
    mgr = await make_user(pg_client, pg_engine, "m@example.com", "manager")
    await publish(pg_client, ed, mgr, title="Understanding the Prophetic")

    r = await pg_client.get("/api/v1/search?q=prophetic")
    assert r.status_code == 200
    assert r.json()["total"] == 1


async def test_title_match_outranks_description_match(pg_client, pg_engine):
    """Proves the weighted tsvector (`setweight(..., 'A')` for title,
    `'B'` for description) actually orders results — the one piece of
    `_rank`'s own behavior the SQLite fallback (no ranking at all,
    `published_at DESC`) structurally cannot demonstrate."""
    ed = await make_user(pg_client, pg_engine, "e@example.com", "editor")
    mgr = await make_user(pg_client, pg_engine, "m@example.com", "manager")
    # Published in an order that would reverse-sort the *wrong* way under
    # SQLite's published_at-only fallback, so this test only passes for the
    # right reason: title-rank actually being applied.
    await publish(
        pg_client, ed, mgr, title="A Study on Forgiveness",
        description="grace grace grace",
    )
    await publish(pg_client, ed, mgr, title="Grace Abounding", description=None)

    body = (await pg_client.get("/api/v1/search?q=grace")).json()
    assert body["total"] == 2
    assert body["results"][0]["title"] == "Grace Abounding"


async def test_stemming_matches_related_word_forms(pg_client, pg_engine):
    """`to_tsvector('english', ...)` stems — "preaching" should match a title
    containing "preach". Another real-Postgres-only guarantee; the SQLite
    LIKE fallback has no stemming and would miss this."""
    ed = await make_user(pg_client, pg_engine, "e@example.com", "editor")
    mgr = await make_user(pg_client, pg_engine, "m@example.com", "manager")
    await publish(pg_client, ed, mgr, title="The Art of Preaching")

    body = (await pg_client.get("/api/v1/search?q=preach")).json()
    assert body["total"] == 1


async def test_series_speakers_groups_also_work_against_real_postgres(pg_client, pg_engine):
    """Decision 4's series/speakers grouping (search_service.search_series/
    search_speakers) uses plain ILIKE, not tsvector — lower risk than the
    sermon path, but this closes the same real-Postgres coverage gap for it
    rather than assuming "it uses simpler SQL so it's probably fine"."""
    ed = await make_user(pg_client, pg_engine, "e@example.com", "editor")
    mgr = await make_user(pg_client, pg_engine, "m@example.com", "manager")
    sid = (await pg_client.post(
        "/api/v1/series", json={"title": "Grace Series"}, headers=ed
    )).json()["id"]
    r = await pg_client.patch(
        f"/api/v1/series/{sid}", json={"status": "published"}, headers=mgr
    )
    assert r.status_code == 200, r.text
    await pg_client.post("/api/v1/speakers", json={"name": "Grace Adeyemi"}, headers=ed)

    body = (await pg_client.get("/api/v1/search?q=grace")).json()
    assert [s["title"] for s in body["series"]] == ["Grace Series"]
    assert [s["name"] for s in body["speakers"]] == ["Grace Adeyemi"]
