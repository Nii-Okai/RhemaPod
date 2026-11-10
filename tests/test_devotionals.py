"""Daily devotional API (plans/plan-daily-devotional.md, Phase 1)."""
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.models import ChurchSettings
from app.services import devotional_service

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"
API = "/api/v1"


def today() -> date:
    return datetime.now(timezone.utc).date()


async def make_user(client, engine, email, role):
    await client.post(f"{API}/auth/register", json={"email": email, "password": PW})
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await s.execute(
            text("UPDATE users SET role = :r WHERE email = :e"),
            {"r": role.upper(), "e": email},
        )
        await s.commit()
    tokens = (await client.post(
        f"{API}/auth/login", json={"email": email, "password": PW}
    )).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest.fixture
async def church(engine):
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        s.add(ChurchSettings(id=1, contact_email="c@example.com"))
        await s.commit()


@pytest.fixture
async def staff(client, engine, church):
    return {
        "editor": await make_user(client, engine, "ed@example.com", "editor"),
        "manager": await make_user(client, engine, "mgr@example.com", "manager"),
        "manager2": await make_user(client, engine, "mgr2@example.com", "manager"),
        "admin": await make_user(client, engine, "admin@example.com", "admin"),
    }


PASSAGE = (
    "1 God is our refuge and strength, a very present help in trouble.\n"
    "10 Be still, and know that I am God."
)


def body(**overrides):
    base = {
        "date": today().isoformat(),
        "title": "Be still, and know",
        "still_breath_in": "Be still…",
        "still_breath_out": "…and know",
        "passage_ref": "Psalm 46:1, 10",
        "passage_translation": "kjv",
        "passage_text": PASSAGE,
        "suggested_word": "still",
        "reflection_md": "Notice where this verse sits.",
        "pray_question": "What is making noise in you today?",
        "pray_text": "Lord, let me be still. Amen.",
    }
    base.update(overrides)
    return base


async def create(client, headers, **overrides):
    r = await client.post(f"{API}/devotionals", json=body(**overrides), headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


async def approve(client, staff, dev_id, author="manager"):
    reviewer = "manager2" if author == "manager" else "manager"
    r = await client.post(f"{API}/devotionals/{dev_id}/submit", headers=staff[author])
    assert r.status_code == 200, r.text
    r = await client.post(
        f"{API}/approvals/devotionals/{dev_id}/approve", headers=staff[reviewer]
    )
    assert r.status_code == 200, r.text


# ── public reads ──────────────────────────────────────────────────────────────
async def test_draft_is_not_public(client, staff):
    await create(client, staff["manager"])
    r = await client.get(f"{API}/devotionals/day/{today().isoformat()}")
    assert r.status_code == 404


async def test_approved_devotional_is_public_and_shaped(client, staff):
    dev = await create(client, staff["manager"])
    await approve(client, staff, dev["id"])
    r = await client.get(f"{API}/devotionals/day/{today().isoformat()}")
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["source"] == "dated"
    assert got["title"] == "Be still, and know"
    assert got["still"] == {"breath_in": "Be still…", "breath_out": "…and know", "seconds": 60}
    assert got["passage"]["verses"] == [
        {"number": 1, "text": "God is our refuge and strength, a very present help in trouble."},
        {"number": 10, "text": "Be still, and know that I am God."},
    ]
    assert got["reading"] is None
    assert got["reading_fallback"] == "text"
    assert got["tts"] is None
    assert got["carry_verse_ref"] == "Psalm 46:1, 10"
    assert got["publish_hour"] == 5


async def test_evergreen_fills_empty_days_deterministically(client, staff):
    ids = set()
    for i in range(3):
        dev = await create(client, staff["manager"], date=None, title=f"Pool {i}")
        await approve(client, staff, dev["id"])
        ids.add(dev["id"])
    day = (today() + timedelta(days=2)).isoformat()
    first = (await client.get(f"{API}/devotionals/day/{day}")).json()
    second = (await client.get(f"{API}/devotionals/day/{day}")).json()
    assert first["source"] == "evergreen"
    assert first["id"] in ids
    assert first["id"] == second["id"]
    assert first["date"] == day


async def test_dated_beats_evergreen(client, staff):
    pool = await create(client, staff["manager"], date=None, title="Pool")
    await approve(client, staff, pool["id"])
    dated = await create(client, staff["manager"])
    await approve(client, staff, dated["id"])
    got = (await client.get(f"{API}/devotionals/day/{today().isoformat()}")).json()
    assert got["id"] == dated["id"]


async def test_window_rejects_far_dates(client, staff):
    far = (today() + timedelta(days=30)).isoformat()
    past = (today() - timedelta(days=5)).isoformat()
    assert (await client.get(f"{API}/devotionals/day/{far}")).status_code == 422
    assert (await client.get(f"{API}/devotionals/day/{past}")).status_code == 422
    # Yesterday and a week ahead are both inside the window.
    for d in (today() - timedelta(days=1), today() + timedelta(days=7)):
        assert (await client.get(f"{API}/devotionals/day/{d.isoformat()}")).status_code == 404


async def test_days_prefetch(client, staff):
    for offset in (0, 2):
        dev = await create(
            client, staff["manager"],
            date=(today() + timedelta(days=offset)).isoformat(), title=f"Day {offset}",
        )
        await approve(client, staff, dev["id"])
    r = await client.get(
        f"{API}/devotionals/days", params={"from": today().isoformat(), "count": 3}
    )
    assert r.status_code == 200
    assert [d["title"] for d in r.json()] == ["Day 0", "Day 2"]


async def test_tts_fallback_from_settings_and_override(client, staff):
    s = (await client.get(f"{API}/admin/settings/devotionals", headers=staff["manager"])).json()
    r = await client.patch(
        f"{API}/admin/settings/devotionals",
        json={"version": s["version"], "reading_fallback": "tts", "tts_voice": "en-GB-x"},
        headers=staff["manager"],
    )
    assert r.status_code == 200, r.text
    assert r.json()["reading_fallback"] == "tts"

    dev = await create(client, staff["manager"])
    await approve(client, staff, dev["id"])
    got = (await client.get(f"{API}/devotionals/day/{today().isoformat()}")).json()
    assert got["reading_fallback"] == "tts"
    assert got["tts"] == {"voice": "en-GB-x", "rate": 0.9}

    other = await create(
        client, staff["manager"], date=(today() + timedelta(days=1)).isoformat(),
        reading_fallback="text",
    )
    await approve(client, staff, other["id"])
    day = (today() + timedelta(days=1)).isoformat()
    assert (await client.get(f"{API}/devotionals/day/{day}")).json()["reading_fallback"] == "text"

    # Overrides off: the church setting wins.
    s = (await client.get(f"{API}/admin/settings/devotionals", headers=staff["manager"])).json()
    await client.patch(
        f"{API}/admin/settings/devotionals",
        json={"version": s["version"], "allow_override": False},
        headers=staff["manager"],
    )
    assert (await client.get(f"{API}/devotionals/day/{day}")).json()["reading_fallback"] == "tts"


async def test_settings_stale_version_conflicts(client, staff):
    s = (await client.get(f"{API}/admin/settings/devotionals", headers=staff["manager"])).json()
    ok = await client.patch(
        f"{API}/admin/settings/devotionals",
        json={"version": s["version"], "publish_hour": 6}, headers=staff["manager"],
    )
    assert ok.status_code == 200
    stale = await client.patch(
        f"{API}/admin/settings/devotionals",
        json={"version": s["version"], "publish_hour": 7}, headers=staff["manager"],
    )
    assert stale.status_code == 409
    editor = await client.get(f"{API}/admin/settings/devotionals", headers=staff["editor"])
    assert editor.status_code == 403


# ── validation ────────────────────────────────────────────────────────────────
async def test_suggested_word_must_be_in_passage(client, staff):
    r = await client.post(
        f"{API}/devotionals", json=body(suggested_word="storm"), headers=staff["editor"]
    )
    assert r.status_code == 400
    assert "isn't in the passage" in r.json()["detail"]
    # Whole words only: "know" is in the text, "kno" is not.
    r = await client.post(
        f"{API}/devotionals", json=body(suggested_word="kno"), headers=staff["editor"]
    )
    assert r.status_code == 400


async def test_one_devotional_per_date(client, staff):
    await create(client, staff["editor"])
    r = await client.post(f"{API}/devotionals", json=body(), headers=staff["manager"])
    assert r.status_code == 409
    # Evergreen rows never clash.
    await create(client, staff["editor"], date=None)
    await create(client, staff["editor"], date=None)


async def test_moment_requires_both_bounds(client, staff):
    import uuid

    r = await client.post(
        f"{API}/devotionals",
        json=body(moment_sermon_id=str(uuid.uuid4()), moment_start_s=10),
        headers=staff["editor"],
    )
    assert r.status_code == 400


# ── workflow ──────────────────────────────────────────────────────────────────
async def test_editor_flow_and_permissions(client, staff):
    dev = await create(client, staff["editor"])
    did = dev["id"]
    assert dev["status"] == "draft"
    assert dev["display_status"] == "draft"

    # Editors can't approve.
    await client.post(f"{API}/devotionals/{did}/submit", headers=staff["editor"])
    r = await client.post(f"{API}/approvals/devotionals/{did}/approve", headers=staff["editor"])
    assert r.status_code == 403

    # Submitted work is locked for the editor.
    r = await client.patch(f"{API}/devotionals/{did}", json={"title": "x"}, headers=staff["editor"])
    assert r.status_code == 409

    # Reject needs a note, then the editor can fix and resubmit.
    r = await client.post(
        f"{API}/approvals/devotionals/{did}/reject", json={"note": "Shorter please"},
        headers=staff["manager"],
    )
    assert r.json()["status"] == "rejected"
    r = await client.patch(f"{API}/devotionals/{did}", json={"title": "Shorter"}, headers=staff["editor"])
    assert r.status_code == 200
    await client.post(f"{API}/devotionals/{did}/submit", headers=staff["editor"])
    r = await client.post(f"{API}/approvals/devotionals/{did}/approve", headers=staff["manager"])
    assert r.json()["status"] == "approved"

    got = (await client.get(f"{API}/devotionals/admin/{did}", headers=staff["editor"])).json()
    assert got["display_status"] == "published"
    history = (await client.get(f"{API}/devotionals/admin/{did}/history", headers=staff["editor"])).json()
    assert [h["to_status"] for h in history] == [
        "pending_review", "rejected", "pending_review", "approved"
    ]


async def test_manager_cannot_self_approve(client, staff):
    dev = await create(client, staff["manager"])
    await client.post(f"{API}/devotionals/{dev['id']}/submit", headers=staff["manager"])
    r = await client.post(
        f"{API}/approvals/devotionals/{dev['id']}/approve", headers=staff["manager"]
    )
    assert r.status_code == 403


async def test_approved_is_read_only_until_changes_requested(client, staff):
    dev = await create(client, staff["manager"])
    await approve(client, staff, dev["id"])
    url = f"{API}/devotionals/{dev['id']}"
    r = await client.patch(url, json={"title": "Edited"}, headers=staff["admin"])
    assert r.status_code == 409
    r = await client.post(
        f"{API}/approvals/devotionals/{dev['id']}/reject",
        json={"note": "Tighten the reflection"}, headers=staff["manager2"],
    )
    assert r.status_code == 200
    r = await client.patch(url, json={"title": "Edited"}, headers=staff["manager"])
    assert r.status_code == 200 and r.json()["title"] == "Edited"


async def test_editor_cannot_see_others_drafts(client, staff, engine):
    other = await make_user(client, engine, "ed2@example.com", "editor")
    dev = await create(client, other)
    r = await client.get(f"{API}/devotionals/admin/{dev['id']}", headers=staff["editor"])
    assert r.status_code == 404


async def test_approved_cannot_be_deleted_until_archived(client, staff):
    dev = await create(client, staff["manager"])
    await approve(client, staff, dev["id"])
    assert (await client.delete(f"{API}/devotionals/{dev['id']}", headers=staff["admin"])).status_code == 409
    await client.post(f"{API}/approvals/devotionals/{dev['id']}/archive", headers=staff["admin"])
    assert (await client.delete(f"{API}/devotionals/{dev['id']}", headers=staff["admin"])).status_code == 204


async def test_calendar_and_ready_days(client, staff):
    for offset in (0, 1, 3):
        dev = await create(
            client, staff["manager"], date=(today() + timedelta(days=offset)).isoformat(),
            title=f"D{offset}",
        )
        await approve(client, staff, dev["id"])
    await create(client, staff["editor"], date=(today() + timedelta(days=2)).isoformat())
    pool = await create(client, staff["manager"], date=None)
    await approve(client, staff, pool["id"])

    r = await client.get(
        f"{API}/devotionals/admin/calendar",
        params={"from": today().isoformat(), "to": (today() + timedelta(days=4)).isoformat()},
        headers=staff["manager"],
    )
    assert r.status_code == 200, r.text
    cal = r.json()
    assert cal["ready_days_ahead"] == 2
    assert cal["gap_alert_days"] == 14
    assert cal["evergreen_ready"] == 1
    statuses = [d["devotional"] and d["devotional"]["display_status"] for d in cal["days"]]
    assert statuses == ["published", "scheduled", "draft", "scheduled", None]


# ── import ────────────────────────────────────────────────────────────────────
def csv_body(rows):
    header = "date,title,passage_ref,translation,passage_text,suggested_word,reflection,pray_question,pray_text"
    return (header + "\n" + "\n".join(rows) + "\n").encode()


async def test_import_dry_run_then_commit(client, staff):
    existing = await create(client, staff["manager"], date=(today() + timedelta(days=3)).isoformat())
    d = lambda n: (today() + timedelta(days=n)).isoformat()  # noqa: E731
    raw = csv_body([
        f'{d(1)},Enough for today,Matthew 6:34,kjv,"34 Take therefore no thought for the morrow",morrow,r,q,p',
        f'{d(2)},A lamp,Psalm 119:105,kjv,"105 Thy word is a lamp unto my feet",,r,q,p',
        f'{d(3)},Clash,John 15:5,kjv,"5 I am the vine",vine,r,q,p',
        f'{d(4)},Bad word,Philippians 4:4,kjv,"4 Rejoice in the Lord alway",storm,r,q,p',
        f'not-a-date,Broken,Ps 1,kjv,"1 Blessed",,r,q,p',
        f',Pool one,Ps 23,kjv,"1 The LORD is my shepherd",shepherd,r,q,p',
    ])
    r = await client.post(
        f"{API}/devotionals/admin/import", content=raw,
        headers={**staff["manager"], "Content-Type": "text/csv"},
    )
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["dry_run"] is True
    assert [row["status"] for row in res["rows"]] == [
        "ready", "warning", "clash", "error", "error", "ready"
    ]
    assert res["rows"][2]["clash_with"] == existing["title"]
    assert res["created"] == 0

    r = await client.post(
        f"{API}/devotionals/admin/import",
        params={"dry_run": "false", "as": "approved", "on_clash": "to_pool"},
        content=raw, headers={**staff["manager"], "Content-Type": "text/csv"},
    )
    res = r.json()
    assert (res["created"], res["pooled"], res["skipped"]) == (4, 1, 0)
    got = (await client.get(f"{API}/devotionals/day/{d(1)}")).json()
    assert got["title"] == "Enough for today"


async def test_editor_cannot_import_as_approved(client, staff):
    r = await client.post(
        f"{API}/devotionals/admin/import", params={"dry_run": "false", "as": "approved"},
        content=csv_body([]), headers={**staff["editor"], "Content-Type": "text/csv"},
    )
    assert r.status_code == 403


async def test_import_rejects_missing_columns(client, staff):
    r = await client.post(
        f"{API}/devotionals/admin/import", content=b"date,title\n2026-01-01,x\n",
        headers={**staff["editor"], "Content-Type": "text/csv"},
    )
    assert r.status_code == 400
    assert "Missing column" in r.json()["detail"]


# ── pure helpers ──────────────────────────────────────────────────────────────
async def test_split_verses_handles_numbers_and_plain_lines():
    assert devotional_service.split_verses("3 The voice\n\nNo number here\n4. Every valley") == [
        {"number": 3, "text": "The voice"},
        {"number": None, "text": "No number here"},
        {"number": 4, "text": "Every valley"},
    ]


async def test_parse_clock():
    assert devotional_service._parse_clock("18:42") == 1122
    assert devotional_service._parse_clock("1:00:05") == 3605
    assert devotional_service._parse_clock("90") == 90
