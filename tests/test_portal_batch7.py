"""GATE 3 Batch 7 — Users & roles scoping, role-count aggregate, author-scoped
sermons, the global in-flight uploads feed, and the weekly new-listeners series.

Covers (plan §W15, §A.6, §A.2):
  #1  GET /users is hard-scoped to staff roles for every actor; `role` narrows
      within staff; `role=viewer` is rejected — never a viewer page.
  #2  GET /users/role-counts is a full-table GROUP BY role, viewer bucket real,
      deliberately NOT scoped like #1.
  #3  GET /sermons?created_by=me returns only the caller's own sermons.
  #4  GET /uploads/in-flight returns only in-flight jobs on visible sermons.
  #5  GET /admin/analytics/new-listeners — exactly 8 Monday-anchored ISO-week
      buckets, oldest first, zero-filled; boundaries computed in Python.
"""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.models import (
    MediaType,
    PlaybackSession,
    UploadJob,
    UploadStatus,
    User,
)
from app.services import analytics_service

# asyncio_mode = "auto" — async tests need no marker.

PW = "correct-horse-battery"


def _sf(engine):
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


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


async def db_user(engine, email):
    async with _sf(engine)() as s:
        return (await s.execute(
            select(User).where(User.email == email)
        )).scalar_one()


# ── #1 — GET /users staff scoping + role filter ──────────────────────────────
async def test_users_list_excludes_viewers_for_every_actor(client, engine):
    admin = await register(client, "admin@example.com", "admin", engine)
    manager = await register(client, "mgr@example.com", "manager", engine)
    await register(client, "editor@example.com", "editor", engine)
    await register(client, "viewer1@example.com")  # defaults to viewer
    await register(client, "viewer2@example.com")

    for actor in (admin, manager):
        body = (await client.get("/api/v1/users", headers=actor)).json()
        emails = {u["email"] for u in body["items"]}
        roles = {u["role"] for u in body["items"]}
        assert "viewer" not in roles
        assert emails.isdisjoint({"viewer1@example.com", "viewer2@example.com"})
        assert {"admin@example.com", "mgr@example.com", "editor@example.com"} <= emails
        assert body["total"] == 3


async def test_users_list_role_filter_narrows_within_staff(client, engine):
    admin = await register(client, "admin@example.com", "admin", engine)
    await register(client, "e1@example.com", "editor", engine)
    await register(client, "e2@example.com", "editor", engine)
    await register(client, "m1@example.com", "manager", engine)
    await register(client, "v@example.com")

    body = (await client.get("/api/v1/users?role=editor", headers=admin)).json()
    assert {u["email"] for u in body["items"]} == {"e1@example.com", "e2@example.com"}
    assert body["total"] == 2
    assert all(u["role"] == "editor" for u in body["items"])


async def test_users_list_rejects_viewer_filter(client, engine):
    admin = await register(client, "admin@example.com", "admin", engine)
    await register(client, "v@example.com")

    r = await client.get("/api/v1/users?role=viewer", headers=admin)
    assert r.status_code == 400
    # And never a viewer page under any casing / repetition.
    assert "v@example.com" not in r.text


# ── #2 — role-count aggregate (full-table, viewer bucket real) ───────────────
async def test_role_counts_is_full_table_group_by_role(client, engine):
    admin = await register(client, "admin@example.com", "admin", engine)
    await register(client, "e1@example.com", "editor", engine)
    await register(client, "e2@example.com", "editor", engine)
    await register(client, "m1@example.com", "manager", engine)
    await register(client, "v1@example.com")
    await register(client, "v2@example.com")
    await register(client, "v3@example.com")

    counts = (await client.get("/api/v1/users/role-counts", headers=admin)).json()

    # Hand-run GROUP BY: 3 viewers, 2 editors, 1 manager, 1 admin.
    assert counts["viewer"] == 3  # the criterion that stops "fixing" #2 to match #1
    assert counts["editor"] == 2
    assert counts["manager"] == 1
    assert counts["admin"] == 1
    assert counts["total"] == 7 == sum(
        counts[k] for k in ("viewer", "editor", "manager", "admin")
    )


async def test_role_counts_requires_manager_plus(client, engine):
    viewer = await register(client, "v@example.com")
    r = await client.get("/api/v1/users/role-counts", headers=viewer)
    assert r.status_code == 403


# ── #3 — author-scoped GET /sermons ─────────────────────────────────────────
async def test_sermons_created_by_me_scopes_to_caller(client, engine):
    mgr = await register(client, "mgr@example.com", "manager", engine)
    ed = await register(client, "ed@example.com", "editor", engine)

    mine = (await client.post(
        "/api/v1/sermons", json={"title": "Manager draft"}, headers=mgr
    )).json()["id"]
    (await client.post(
        "/api/v1/sermons", json={"title": "Editor draft"}, headers=ed
    )).json()

    # Manager, unfiltered: sees both. Filtered to me: only their own.
    all_titles = {
        s["title"] for s in
        (await client.get("/api/v1/sermons", headers=mgr)).json()["items"]
    }
    assert {"Manager draft", "Editor draft"} <= all_titles

    body = (await client.get(
        "/api/v1/sermons?created_by=me", headers=mgr
    )).json()
    assert [s["id"] for s in body["items"]] == [mine]
    assert body["total"] == 1

    # Editor is already own-scoped; created_by=me is a consistent no-op.
    ed_body = (await client.get(
        "/api/v1/sermons?created_by=me", headers=ed
    )).json()
    assert {s["title"] for s in ed_body["items"]} == {"Editor draft"}


async def test_sermons_created_by_rejects_non_me_value(client, engine):
    mgr = await register(client, "mgr@example.com", "manager", engine)
    r = await client.get("/api/v1/sermons?created_by=someone-else", headers=mgr)
    assert r.status_code == 422


# ── #4 — global in-flight uploads feed ─────────────────────────────────────
async def _sermon(client, headers, title):
    return (await client.post(
        "/api/v1/sermons", json={"title": title}, headers=headers
    )).json()["id"]


async def _job(engine, sermon_id, creator_id, status):
    async with _sf(engine)() as s:
        job = UploadJob(
            sermon_id=uuid.UUID(str(sermon_id)),
            raw_key=f"raw/{sermon_id}.mp4",
            media_type=MediaType.VIDEO,
            status=status,
            created_by=creator_id,
        )
        s.add(job)
        await s.commit()
        return str(job.id)


async def test_in_flight_feed_scopes_to_visible_sermons_and_active_states(
    client, engine
):
    ed1 = await register(client, "ed1@example.com", "editor", engine)
    ed2 = await register(client, "ed2@example.com", "editor", engine)
    mgr = await register(client, "mgr@example.com", "manager", engine)
    ed1_id = (await db_user(engine, "ed1@example.com")).id
    ed2_id = (await db_user(engine, "ed2@example.com")).id

    s1 = await _sermon(client, ed1, "One")
    s2 = await _sermon(client, ed2, "Two")

    j1 = await _job(engine, s1, ed1_id, UploadStatus.PROCESSING)
    await _job(engine, s2, ed2_id, UploadStatus.AWAITING_UPLOAD)
    # A finished job on ed1's own sermon must NOT show — terminal state.
    await _job(engine, s1, ed1_id, UploadStatus.READY)

    ed1_feed = (await client.get("/api/v1/uploads/in-flight", headers=ed1)).json()
    assert {j["id"] for j in ed1_feed} == {j1}
    assert all(j["status"] in ("awaiting_upload", "uploaded", "processing")
               for j in ed1_feed)

    # Editor 2 sees only their own sermon's job, not ed1's.
    ed2_feed = (await client.get("/api/v1/uploads/in-flight", headers=ed2)).json()
    assert {j["sermon_id"] for j in ed2_feed} == {s2}

    # Manager sees every in-flight job across all sermons (still not the READY).
    mgr_feed = (await client.get("/api/v1/uploads/in-flight", headers=mgr)).json()
    assert {j["sermon_id"] for j in mgr_feed} == {s1, s2}
    assert len(mgr_feed) == 2


# ── #5 — new-listeners weekly series ───────────────────────────────────────
async def _play(engine, user_id, sermon_id, first_played_at):
    async with _sf(engine)() as s:
        s.add(PlaybackSession(
            user_id=uuid.UUID(str(user_id)),
            sermon_id=uuid.UUID(str(sermon_id)),
            position_seconds=60,
            watched_seconds=60,
            play_count=1,
            first_played_at=first_played_at,
            last_played_at=first_played_at,
        ))
        await s.commit()


async def _published_sermon(client, ed, mgr, title):
    sid = (await client.post(
        "/api/v1/sermons", json={"title": title}, headers=ed
    )).json()["id"]
    await client.post(f"/api/v1/sermons/{sid}/submit", headers=ed)
    await client.post(f"/api/v1/approvals/sermons/{sid}/approve", headers=mgr)
    await client.post(f"/api/v1/approvals/sermons/{sid}/publish", headers=mgr)
    return sid


async def test_new_listeners_requires_manager_plus(client, engine):
    ed = await register(client, "ed@example.com", "editor", engine)
    r = await client.get("/api/v1/admin/analytics/new-listeners", headers=ed)
    assert r.status_code == 403


async def test_new_listeners_eight_zero_filled_buckets_oldest_first(client, engine):
    ed = await register(client, "ed@example.com", "editor", engine)
    mgr = await register(client, "mgr@example.com", "manager", engine)
    sid = await _published_sermon(client, ed, mgr, "S")

    now = datetime.now(timezone.utc)
    edges = analytics_service.week_start_boundaries(now)  # 9 edges
    assert len(edges) == 9

    # One brand-new listener in bucket 0 (oldest) and two in bucket 6; buckets
    # 1..5 and 7 stay empty. A pre-window debut (10 weeks ago) must not count.
    async with _sf(engine)() as s:
        viewers = []
        for i in range(4):
            u = User(email=f"L{i}@example.com", password_hash="x" * 20)
            s.add(u)
            viewers.append(u)
        await s.flush()
        vids = [u.id for u in viewers]
        await s.commit()

    def inside(i):
        return edges[i] + timedelta(days=2, hours=1)

    await _play(engine, vids[0], sid, inside(0))
    await _play(engine, vids[1], sid, inside(6))
    await _play(engine, vids[2], sid, inside(6))
    await _play(engine, vids[3], sid, edges[0] - timedelta(weeks=3))  # pre-window

    rows = (await client.get(
        "/api/v1/admin/analytics/new-listeners", headers=mgr
    )).json()

    assert len(rows) == 8
    starts = [r["week_start"] for r in rows]
    assert starts == sorted(starts)  # oldest first
    assert starts == [edges[i].date().isoformat() for i in range(8)]
    counts = [r["count"] for r in rows]
    assert counts == [1, 0, 0, 0, 0, 0, 2, 0]
    # Union of distinct users across the 8 buckets = a hand-run query: the three
    # in-window debuts, not the pre-window one.
    assert sum(counts) == 3


async def test_new_listeners_counts_each_user_once_by_earliest_play(client, engine):
    """M1 buckets a user by their *earliest* first_played_at across all sermons
    — a later play on another sermon must not move or double-count them."""
    ed = await register(client, "ed@example.com", "editor", engine)
    mgr = await register(client, "mgr@example.com", "manager", engine)
    s_a = await _published_sermon(client, ed, mgr, "A")
    s_b = await _published_sermon(client, ed, mgr, "B")

    now = datetime.now(timezone.utc)
    edges = analytics_service.week_start_boundaries(now)

    async with _sf(engine)() as s:
        u = User(email="repeat@example.com", password_hash="x" * 20)
        s.add(u)
        await s.flush()
        uid = u.id
        await s.commit()

    await _play(engine, uid, s_a, edges[1] + timedelta(days=1))  # debut, bucket 1
    await _play(engine, uid, s_b, edges[5] + timedelta(days=1))  # later, bucket 5

    rows = (await client.get(
        "/api/v1/admin/analytics/new-listeners", headers=mgr
    )).json()
    counts = [r["count"] for r in rows]
    assert counts[1] == 1
    assert counts[5] == 0
    assert sum(counts) == 1


# ── #5 — Python week-boundary helper, unit-tested directly ─────────────────
def _all_mondays_utc(edges):
    return all(
        e.tzinfo == timezone.utc and e.weekday() == 0
        and (e.hour, e.minute, e.second, e.microsecond) == (0, 0, 0, 0)
        for e in edges
    )


def test_week_boundaries_are_contiguous_mondays_newest_is_next_monday():
    now = datetime(2026, 9, 7, 14, 30, tzinfo=timezone.utc)  # a Monday
    edges = analytics_service.week_start_boundaries(now)

    assert len(edges) == 9
    assert _all_mondays_utc(edges)
    # Exactly 7 days apart, ascending, half-open: bucket i is [edges[i], edges[i+1]).
    for a, b in zip(edges, edges[1:]):
        assert b - a == timedelta(days=7)
    # `now` is itself a Monday: it opens the newest bucket (index 7); edges[8]
    # is next Monday, the exclusive upper bound.
    assert edges[7].date() == now.date()
    assert edges[8].date() == (now.date() + timedelta(days=7))


def test_week_boundaries_midweek_now_anchors_to_current_monday():
    now = datetime(2026, 9, 9, 23, 59, tzinfo=timezone.utc)  # Wednesday
    edges = analytics_service.week_start_boundaries(now)
    assert edges[7].date() == datetime(2026, 9, 7, tzinfo=timezone.utc).date()
    assert _all_mondays_utc(edges)


def test_week_boundaries_cross_iso_year_boundary_cleanly():
    # 2027-01-01 is a Friday; ISO week 53 of 2026 runs Mon 2026-12-28..Sun
    # 2027-01-03. A date_trunc / EXTRACT(isoyear) mistake shows up right here.
    now = datetime(2027, 1, 1, 9, 0, tzinfo=timezone.utc)
    edges = analytics_service.week_start_boundaries(now)

    assert _all_mondays_utc(edges)
    assert edges[7].date() == datetime(2026, 12, 28, tzinfo=timezone.utc).date()
    assert edges[8].date() == datetime(2027, 1, 4, tzinfo=timezone.utc).date()
    # The window straddles the year: oldest edge is in November 2026.
    assert edges[0].date() == datetime(2026, 11, 9, tzinfo=timezone.utc).date()
    for a, b in zip(edges, edges[1:]):
        assert b - a == timedelta(days=7)


def test_week_boundaries_respects_weeks_argument():
    now = datetime(2026, 9, 9, tzinfo=timezone.utc)
    edges = analytics_service.week_start_boundaries(now, weeks=4)
    assert len(edges) == 5
    assert _all_mondays_utc(edges)
