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


async def publish_series(client, mgr, series_id):
    r = await client.patch(
        f"/api/v1/series/{series_id}", json={"status": "published"}, headers=mgr
    )
    assert r.status_code == 200, r.text


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


async def publish_episode_with_null_number(client, ed, mgr, series_id, title):
    """Publish an episode that keeps a genuinely NULL `episode_number`.

    `POST /sermons` auto-assigns the next number whenever `episode_number`
    is omitted and the sermon joins a series, so the only way to end up with
    a real NULL is to explicitly clear it via PATCH while the sermon is
    still a DRAFT (PATCH refuses edits once it's under review/approved/
    published) — `update_sermon`'s auto-assign only fires when the field is
    left unset or the sermon has never had a number, not when the editor
    explicitly nulls an existing one.
    """
    sid = (await client.post(
        "/api/v1/sermons",
        json={"title": title, "series_id": series_id},
        headers=ed,
    )).json()["id"]
    resp = await client.patch(
        f"/api/v1/sermons/{sid}", json={"episode_number": None}, headers=ed
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["episode_number"] is None
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)
    return sid


async def activate_subscription(client, engine, email):
    """Register + entitle a viewer, return auth headers.

    Entitlement is written directly onto the account's `Subscription` row
    through the ORM (no checkout, no webhook, no provider involved) and the
    entitlement cache is busted the same way a live activation would bust it.
    Every account gets a FREE `Subscription` row the moment it registers
    (`auth_service.register_user`), so this mutates that row in place rather
    than inserting a second one — `user_id` is unique on the table.
    """
    import uuid as _uuid

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import Subscription, SubscriptionStatus, SubscriptionTier
    from app.services import subscription_service

    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    uid = await user_id_for(engine, email)
    period_end = datetime.now(timezone.utc) + timedelta(days=30)

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        sub = (await s.execute(
            select(Subscription).where(Subscription.user_id == _uuid.UUID(uid))
        )).scalar_one()
        sub.tier = SubscriptionTier.MONTHLY
        sub.status = SubscriptionStatus.ACTIVE
        sub.valid_until = period_end
        await s.commit()
        # Invalidate via the ORM-loaded `sub.user_id`, not the raw `uid`
        # string: `user_id_for()` reads it back through a raw `text()`
        # SELECT, which skips the UUID type's result processor and can come
        # back as an undashed hex string on SQLite — a different cache key
        # than `is_entitled()` builds from the properly-typed ORM attribute,
        # so the delete would silently miss.
        await subscription_service.invalidate_entitlement(sub.user_id)

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
    await publish_series(client, mgr, series["id"])
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
    await publish_series(client, mgr, series["id"])
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
    await publish_series(client, mgr, series["id"])
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
    await publish_series(client, mgr, series["id"])
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


async def test_series_episodes_leaves_unnumbered_episode_null(client, engine):
    """Conductor follow-up to W2.3 (should-fix from reviewer-gilfoyle): an
    episode an editor never assigned a number to must not get one assigned
    on its behalf by the renumbering. It stays `episode_number: null` on the
    public read and does not consume a slot — visible real numbers 1, None,
    4 read as 1, None, 2 (only the numbered items are folded into 1..N).
    """
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post(
        "/api/v1/series", json={"title": "Unnumbered Series"}, headers=ed
    )).json()
    await publish_series(client, mgr, series["id"])
    await publish_episode(client, ed, mgr, series["id"], episode_number=1, title="One")
    await publish_episode_with_null_number(client, ed, mgr, series["id"], title="Bonus")
    await publish_episode(client, ed, mgr, series["id"], episode_number=4, title="Four")

    public = (await client.get(f"/api/v1/series/{series['id']}/episodes")).json()
    # Order matches what the endpoint returns (real episode_number asc,
    # nulls last) — assert on that, not an assumed order.
    assert [e["title"] for e in public] == ["One", "Four", "Bonus"]
    assert [e["episode_number"] for e in public] == [1, 2, None]

    # Admin read and the DB are unchanged — real numbers verbatim.
    admin = (await client.get(
        f"/api/v1/sermons?series_id={series['id']}", headers=mgr
    )).json()["items"]
    admin_by_title = {item["title"]: item["episode_number"] for item in admin}
    assert admin_by_title == {"One": 1, "Bonus": None, "Four": 4}
async def test_series_episodes_resolves_speaker_category_and_series_names(client, engine):
    """Isaac's report, session 2026-09-30: "speaker name is not showing on episode
    items" — the route called `to_list_item` with no `names` argument at all, so it
    silently fell back to an all-empty `RefNames()` and every episode's
    `speaker_name`/`category_name`/`series_title` came back `None` regardless of
    what was actually assigned."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    speaker = (await client.post(
        "/api/v1/speakers", json={"name": "Pastor Grace"}, headers=ed
    )).json()
    category = (await client.post(
        "/api/v1/categories", json={"name": "Faith", "slug": "faith"}, headers=ed
    )).json()
    series = (await client.post(
        "/api/v1/series", json={"title": "Anchored", "category_id": category["id"]}, headers=ed,
    )).json()
    await publish_series(client, mgr, series["id"])
    sid = (await client.post(
        "/api/v1/sermons",
        json={
            "title": "Part One",
            "series_id": series["id"],
            "episode_number": 1,
            "speaker_id": speaker["id"],
            "category_id": category["id"],
        },
        headers=ed,
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)

    episodes = (await client.get(f"/api/v1/series/{series['id']}/episodes")).json()

    assert len(episodes) == 1
    assert episodes[0]["speaker_name"] == "Pastor Grace"
    assert episodes[0]["category_name"] == "Faith"
    assert episodes[0]["series_title"] == "Anchored"


async def test_series_episodes_media_type_reflects_each_episodes_own_rendition(client, engine):
    """Offline downloads need to know a episode's rendition (audio or video)
    without a second request per row — `media_type` is resolved per episode
    from its own `media_refs`, not inherited from a sibling or the series."""
    ed = await make_user(client, engine, "e@example.com", "editor")
    mgr = await make_user(client, engine, "m@example.com", "manager")
    series = (await client.post("/api/v1/series", json={"title": "Mixed"}, headers=ed)).json()
    await publish_series(client, mgr, series["id"])

    video_sid = (await client.post(
        "/api/v1/sermons",
        json={"title": "Video Ep", "series_id": series["id"], "episode_number": 1},
        headers=ed,
    )).json()["id"]
    video_ticket = (await client.post(
        f"/api/v1/sermons/{video_sid}/upload-url",
        json={"filename": "sermon.mp4", "content_type": "video/mp4", "media_type": "video"},
        headers=ed,
    )).json()
    await client.post(f"/api/v1/uploads/{video_ticket['job_id']}/confirm", headers=ed)
    await client.post(f"/api/v1/sermons/{video_sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{video_sid}/approve", headers=mgr)
    await client.post(f"/api/v1/approvals/sermons/{video_sid}/publish", headers=mgr)

    audio_sid = (await client.post(
        "/api/v1/sermons",
        json={"title": "Audio Ep", "series_id": series["id"], "episode_number": 2},
        headers=ed,
    )).json()["id"]
    audio_ticket = (await client.post(
        f"/api/v1/sermons/{audio_sid}/upload-url",
        json={"filename": "sermon.mp3", "content_type": "audio/mpeg", "media_type": "audio"},
        headers=ed,
    )).json()
    await client.post(f"/api/v1/uploads/{audio_ticket['job_id']}/confirm", headers=ed)
    await client.post(f"/api/v1/sermons/{audio_sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{audio_sid}/approve", headers=mgr)
    await client.post(f"/api/v1/approvals/sermons/{audio_sid}/publish", headers=mgr)

    episodes = (await client.get(f"/api/v1/series/{series['id']}/episodes")).json()
    by_title = {e["title"]: e["media_type"] for e in episodes}
    assert by_title == {"Video Ep": "video", "Audio Ep": "audio"}


# Draft-series visibility: viewers/anon see published series only; a draft is
# indistinguishable from a nonexistent id (no existence oracle). Staff still see it.
async def _draft_and_published_series(client, engine):
    ed = await make_user(client, engine, "dsed@example.com", "editor")
    mgr = await make_user(client, engine, "dsmgr@example.com", "manager")
    viewer = await make_user(client, engine, "dsviewer@example.com", "viewer")
    draft = (await client.post("/api/v1/series", json={"title": "Draft S"}, headers=ed)).json()
    pub = (await client.post("/api/v1/series", json={"title": "Pub S"}, headers=ed)).json()
    r = await client.patch(
        f"/api/v1/series/{pub['id']}", json={"status": "published"}, headers=mgr
    )
    assert r.status_code == 200, r.text
    return ed, mgr, viewer, draft, pub


async def test_draft_series_detail_404s_for_signed_in_viewer(client, engine):
    _, _, viewer, draft, _ = await _draft_and_published_series(client, engine)
    missing = await client.get(
        "/api/v1/series/00000000-0000-0000-0000-000000000000", headers=viewer
    )
    for headers in (viewer, {}):
        r = await client.get(f"/api/v1/series/{draft['id']}", headers=headers)
        assert r.status_code == 404
        assert r.json()["detail"] == missing.json()["detail"]
    liked = await client.put(f"/api/v1/series/{draft['id']}/like", headers=viewer)
    assert liked.status_code == 404


async def test_series_list_and_search_exclude_drafts_for_viewer(client, engine):
    _, _, viewer, draft, pub = await _draft_and_published_series(client, engine)
    ids = {s["id"] for s in (await client.get("/api/v1/series", headers=viewer)).json()}
    assert ids == {pub["id"]}
    anon_ids = {s["id"] for s in (await client.get("/api/v1/series")).json()}
    assert anon_ids == {pub["id"]}
    r = await client.get("/api/v1/search", params={"q": "S"}, headers=viewer)
    assert r.status_code == 200, r.text
    body = r.json()
    group = body.get("series")
    if isinstance(group, dict):
        group = group.get("items", [])
    assert draft["id"] not in {s["id"] for s in (group or [])}


async def test_staff_still_see_draft_series(client, engine):
    ed, mgr, _, draft, pub = await _draft_and_published_series(client, engine)
    for headers in (ed, mgr):
        assert (await client.get(
            f"/api/v1/series/{draft['id']}", headers=headers
        )).status_code == 200
        ids = {s["id"] for s in (await client.get("/api/v1/series", headers=headers)).json()}
        assert ids == {draft["id"], pub["id"]}


async def test_published_series_detail_200_for_viewer(client, engine):
    _, _, viewer, _, pub = await _draft_and_published_series(client, engine)
    assert (await client.get(f"/api/v1/series/{pub['id']}", headers=viewer)).status_code == 200
    assert (await client.get(f"/api/v1/series/{pub['id']}/episodes")).status_code == 200


async def test_draft_series_episodes_404_for_viewer_and_anon(client, engine):
    ed, mgr, viewer, draft, _ = await _draft_and_published_series(client, engine)
    await publish_episode(client, ed, mgr, draft["id"])
    missing = await client.get(
        "/api/v1/series/00000000-0000-0000-0000-000000000000/episodes", headers=viewer
    )
    assert missing.status_code == 404
    for headers in (viewer, {}):
        r = await client.get(f"/api/v1/series/{draft['id']}/episodes", headers=headers)
        assert r.status_code == 404
        assert r.json()["detail"] == missing.json()["detail"]


async def test_draft_series_episodes_200_for_staff(client, engine):
    ed, mgr, _, draft, _ = await _draft_and_published_series(client, engine)
    sid = await publish_episode(client, ed, mgr, draft["id"])
    for headers in (ed, mgr):
        r = await client.get(f"/api/v1/series/{draft['id']}/episodes", headers=headers)
        assert r.status_code == 200, r.text
        item = r.json()[0]
        assert item["id"] == sid
        assert item["series_title"] == "Draft S"
        assert item["series_id"] == draft["id"]


async def test_published_series_episodes_200_for_viewer(client, engine):
    ed, mgr, viewer, _, pub = await _draft_and_published_series(client, engine)
    await publish_episode(client, ed, mgr, pub["id"])
    r = await client.get(f"/api/v1/series/{pub['id']}/episodes", headers=viewer)
    assert r.status_code == 200, r.text
    assert r.json()[0]["series_title"] == "Pub S"


async def test_sermon_series_reference_hidden_for_viewer_when_series_draft(client, engine):
    ed, mgr, viewer, draft, pub = await _draft_and_published_series(client, engine)
    in_draft = await publish_episode(client, ed, mgr, draft["id"], title="InDraft")
    in_pub = await publish_episode(client, ed, mgr, pub["id"], title="InPub")

    def by_id(rows):
        return {r["id"]: r for r in rows}

    for headers in (viewer, {}):
        cat = by_id((await client.get("/api/v1/catalog/sermons", headers=headers)).json())
        assert cat[in_draft]["series_title"] is None
        assert cat[in_draft]["series_id"] is None
        assert cat[in_pub]["series_title"] == "Pub S"
        assert cat[in_pub]["series_id"] == pub["id"]

        d = (await client.get(f"/api/v1/catalog/sermons/{in_draft}", headers=headers)).json()
        assert d["series_title"] is None and d["series_id"] is None
        d = (await client.get(f"/api/v1/catalog/sermons/{in_pub}", headers=headers)).json()
        assert d["series_title"] == "Pub S"

    s = await client.get("/api/v1/search", params={"q": "InDraft"}, headers=viewer)
    assert s.status_code == 200, s.text
    assert "Draft S" not in s.text and draft["id"] not in s.text


async def test_sermon_series_reference_visible_to_staff_when_series_draft(client, engine):
    ed, mgr, _, draft, _ = await _draft_and_published_series(client, engine)
    sid = await publish_episode(client, ed, mgr, draft["id"], title="InDraft")
    for headers in (ed, mgr):
        d = (await client.get(f"/api/v1/catalog/sermons/{sid}", headers=headers)).json()
        assert d["series_title"] == "Draft S"
        assert d["series_id"] == draft["id"]
        lst = (await client.get("/api/v1/sermons", headers=headers)).json()
        rows = lst["items"] if isinstance(lst, dict) else lst
        row = next(r for r in rows if r["id"] == sid)
        assert row["series_title"] == "Draft S"
