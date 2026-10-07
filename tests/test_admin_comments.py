"""Moderation admin API (plan S7, §A.4 admin rows, §A.5, §A.6), real Postgres.

Every §A.6 admin cell (rows R5 list, R6 hide/restore, R7 hard delete) has a
test here, each also asserting "no state change on denial".
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, update

from app.models.models import (
    CommentModerationLog,
    CommentReportReason,
    CommentStatus,
    ModerationAction,
    Sermon,
    SermonComment,
    SermonCommentReport,
    User,
    UserRole,
)
from main import app
from tests.comments_pg import (  # noqa: F401
    break_moderation_log,
    capture_logs,
    db_rows,
    make_user,
    pg_client,
    pg_engine,
    pg_migrated_db,
    pg_server,
    published_sermon,
    redis_server,
    seed_comment,
    sessions,
)

API = "/api/v1"
ADMIN = f"{API}/admin/comments"
ROLES = ["viewer", "editor", "manager", "admin"]


# ── World ────────────────────────────────────────────────────────────────────
class World:
    pass


@pytest.fixture
async def world(make_user, published_sermon, seed_comment):
    w = World()
    w.editor_a = await make_user(role="editor", full_name="Edith Alpha")
    w.editor_b = await make_user(role="editor", full_name="Ed Bravo")
    w.manager = await make_user(role="manager", full_name="Mary Manager")
    w.admin = await make_user(role="admin", full_name="Adam Admin")
    w.viewer = await make_user(role="viewer", full_name="Vera Viewer")
    w.author = await make_user(role="viewer", full_name="Casey Author", email="casey@example.com")
    w.sermon_a = await published_sermon(owner=w.editor_a, title="Sermon A")
    w.sermon_b = await published_sermon(owner=w.editor_b, title="Sermon B")
    w.on_a = await seed_comment(w.sermon_a, w.author.id, "on a")
    w.on_b = await seed_comment(w.sermon_b, w.author.id, "on b")
    return w


def by_role(w: World, role: str):
    return {"viewer": w.viewer, "editor": w.editor_a, "manager": w.manager, "admin": w.admin}[role]


async def row(db_rows, cid) -> SermonComment | None:
    found = await db_rows(SermonComment, id=cid)
    return found[0] if found else None


async def logs(db_rows, cid=None, action: ModerationAction | None = None):
    filters = {}
    if cid is not None:
        filters["comment_id"] = cid
    if action is not None:
        filters["action"] = action
    return await db_rows(CommentModerationLog, **filters)


async def hide(client, user, cid, reason="Off topic", **kw):
    return await client.post(
        f"{ADMIN}/{cid}/hide", json={"reason": reason}, headers=user.headers, **kw
    )


async def restore(client, user, cid):
    return await client.post(f"{ADMIN}/{cid}/restore", headers=user.headers)


async def dismiss(client, user, cid, **kw):
    kw.setdefault("json", {"reason": "Reviewed, no action"})  # the reason is required (SF-4)
    return await client.post(f"{ADMIN}/{cid}/dismiss-reports", headers=user.headers, **kw)


async def report_via_api(client, user, cid):
    return await client.post(f"{API}/comments/{cid}/report", json={"reason": "spam"}, headers=user.headers)


async def delete_(client, user, cid, reason="Abusive"):
    return await client.request("DELETE", f"{ADMIN}/{cid}", json={"reason": reason}, headers=user.headers)


async def add_reports(sessions, make_user, cid, n: int) -> None:
    users = [await make_user() for _ in range(n)]
    async with sessions() as s:
        for u in users:
            s.add(SermonCommentReport(comment_id=cid, reporter_id=u.id, reason=CommentReportReason.SPAM))
        await s.execute(update(SermonComment).where(SermonComment.id == cid).values(report_count=n))
        await s.commit()


# ── §A.6 R5: admin list ──────────────────────────────────────────────────────
async def test_m_r5_anonymous_is_401(pg_client, world):
    assert (await pg_client.get(ADMIN)).status_code == 401


async def test_m_r5_viewer_is_403(pg_client, world):
    assert (await pg_client.get(ADMIN, headers=world.viewer.headers)).status_code == 403


async def test_m_r5_editor_sees_own_sermons_only(pg_client, world):
    page = (await pg_client.get(ADMIN, headers=world.editor_a.headers)).json()
    assert [i["id"] for i in page["items"]] == [str(world.on_a)]
    assert page["total"] == 1
    page_b = (await pg_client.get(ADMIN, headers=world.editor_b.headers)).json()
    assert [i["id"] for i in page_b["items"]] == [str(world.on_b)]


@pytest.mark.parametrize("role", ["manager", "admin"])
async def test_m_r5_manager_and_admin_see_all(pg_client, world, role):
    page = (await pg_client.get(ADMIN, headers=by_role(world, role).headers)).json()
    assert {i["id"] for i in page["items"]} == {str(world.on_a), str(world.on_b)}
    assert page["total"] == 2


async def test_adm_list_02_editor_scope_ignores_sermons_with_no_owner_match(pg_client, world, make_user):
    stranger = await make_user(role="editor")
    page = (await pg_client.get(ADMIN, headers=stranger.headers)).json()
    assert page["items"] == [] and page["total"] == 0


async def test_adm_list_03_editor_cannot_bypass_scope_with_filters(pg_client, world, sessions, make_user):
    await add_reports(sessions, make_user, world.on_b, 2)
    foreign = (await pg_client.get(f"{ADMIN}?sermon_id={world.sermon_b}", headers=world.editor_a.headers)).json()
    unknown = (await pg_client.get(f"{ADMIN}?sermon_id={uuid.uuid4()}", headers=world.editor_a.headers)).json()
    assert foreign == unknown  # no existence oracle (A10)
    assert foreign["items"] == [] and foreign["total"] == 0
    for qs in (
        "status=VISIBLE",
        "status=HIDDEN",
        "reported_only=true",
        "needs_review=true",
        "sort=most_reported",
        f"sermon_id={world.sermon_b}&reported_only=true&sort=most_reported&status=VISIBLE",
    ):
        page = (await pg_client.get(f"{ADMIN}?{qs}", headers=world.editor_a.headers)).json()
        assert str(world.on_b) not in {i["id"] for i in page["items"]}, qs
        assert page["total"] == len(page["items"]), qs


async def test_adm_list_04_editor_denied_every_write_by_role_before_lookup(pg_client, world, db_rows):
    for cid in (world.on_a, world.on_b, uuid.uuid4()):  # own, foreign, unknown: identical 403
        assert (await hide(pg_client, world.editor_a, cid)).status_code == 403
        assert (await restore(pg_client, world.editor_a, cid)).status_code == 403
        assert (await delete_(pg_client, world.editor_a, cid)).status_code == 403
    assert (await row(db_rows, world.on_a)).status == CommentStatus.VISIBLE
    assert await logs(db_rows) == []


async def test_adm_list_05_filters_and_validation(pg_client, world, sessions, make_user, seed_comment, db_rows):
    hidden = await seed_comment(world.sermon_a, world.author.id, "hidden", status=CommentStatus.HIDDEN)
    await add_reports(sessions, make_user, world.on_a, 1)
    h = world.manager.headers

    async def ids(qs):
        page = (await pg_client.get(f"{ADMIN}?{qs}", headers=h)).json()
        return {i["id"] for i in page["items"]}, page["total"]

    assert await ids("status=HIDDEN") == ({str(hidden)}, 1)
    assert await ids("status=VISIBLE") == ({str(world.on_a), str(world.on_b)}, 2)
    assert await ids("reported_only=true") == ({str(world.on_a)}, 1)
    assert await ids(f"sermon_id={world.sermon_b}") == ({str(world.on_b)}, 1)
    assert await ids(f"sermon_id={world.sermon_a}&status=HIDDEN") == ({str(hidden)}, 1)
    assert await ids(f"sermon_id={world.sermon_b}&reported_only=true") == (set(), 0)
    for bad in ("status=BOGUS", "sort=oldest", "sermon_id=not-a-uuid", "limit=0", "limit=101", "offset=-1"):
        assert (await pg_client.get(f"{ADMIN}?{bad}", headers=h)).status_code == 422, bad


async def test_adm_list_06_sorts_and_hidden_auto_first(pg_client, world, sessions, make_user, seed_comment):
    t = datetime(2026, 5, 1, tzinfo=timezone.utc)
    old_reported = await seed_comment(world.sermon_a, world.author.id, "old", created_at=t)
    new_plain = await seed_comment(world.sermon_a, world.author.id, "new", created_at=t + timedelta(days=9))
    auto = await seed_comment(
        world.sermon_a, world.author.id, "auto", status=CommentStatus.HIDDEN, hidden_auto=True,
        created_at=t - timedelta(days=30),
    )
    manual = await seed_comment(
        world.sermon_a, world.author.id, "manual", status=CommentStatus.HIDDEN, created_at=t + timedelta(days=5)
    )
    await add_reports(sessions, make_user, old_reported, 2)
    await add_reports(sessions, make_user, auto, 3)
    h = world.admin.headers

    async def order(qs):
        page = (await pg_client.get(f"{ADMIN}?sermon_id={world.sermon_a}&{qs}", headers=h)).json()
        return [i["id"] for i in page["items"]]

    recent = await order("sort=recent")
    assert recent[0] == str(auto)
    page = (await pg_client.get(f"{ADMIN}?sermon_id={world.sermon_a}&sort=recent", headers=h)).json()
    created = [i["created_at"] for i in page["items"][1:]]
    assert created == sorted(created, reverse=True)  # recent: created_at DESC within the non-auto group
    most = await order("sort=most_reported")
    assert most[0] == str(auto)  # auto-hidden leads under both sorts
    assert most[1] == str(old_reported)  # then by report_count DESC
    assert set(most) == set(recent)
    # reported_only: auto-hidden first, unreported rows gone
    reported = await order("reported_only=true&sort=most_reported")
    assert reported == [str(auto), str(old_reported)]
    # paging is stable and total is the full filtered count
    p1 = (await pg_client.get(f"{ADMIN}?sermon_id={world.sermon_a}&limit=2&offset=0", headers=h)).json()
    p2 = (await pg_client.get(f"{ADMIN}?sermon_id={world.sermon_a}&limit=2&offset=2", headers=h)).json()
    p3 = (await pg_client.get(f"{ADMIN}?sermon_id={world.sermon_a}&limit=2&offset=4", headers=h)).json()
    beyond = (await pg_client.get(f"{ADMIN}?sermon_id={world.sermon_a}&limit=2&offset=50", headers=h)).json()
    assert [i["id"] for p in (p1, p2, p3) for i in p["items"]] == recent
    assert {p["total"] for p in (p1, p2, p3, beyond)} == {5}
    assert beyond["items"] == [] and (beyond["limit"], beyond["offset"]) == (2, 50)


async def test_adm_list_07_needs_review_mechanism(pg_client, world, sessions, make_user, seed_comment):
    """needs_review = hidden_auto OR (VISIBLE AND report_count > 0), as a
    filter whose `total` is the nav badge count."""
    reported = await seed_comment(world.sermon_a, world.author.id, "reported")
    auto = await seed_comment(world.sermon_a, world.author.id, "auto", status=CommentStatus.HIDDEN, hidden_auto=True)
    manual = await seed_comment(world.sermon_a, world.author.id, "manual", status=CommentStatus.HIDDEN)
    await add_reports(sessions, make_user, reported, 1)
    await add_reports(sessions, make_user, auto, 3)
    await add_reports(sessions, make_user, manual, 2)  # manually hidden: already actioned
    badge = (await pg_client.get(f"{ADMIN}?needs_review=true&limit=1", headers=world.manager.headers)).json()
    assert badge["total"] == 2
    page = (await pg_client.get(f"{ADMIN}?needs_review=true", headers=world.manager.headers)).json()
    assert [i["id"] for i in page["items"]] == [str(auto), str(reported)]
    # clears on restore (count reset) ...
    assert (await restore(pg_client, world.manager, auto)).status_code == 200
    assert (await pg_client.get(f"{ADMIN}?needs_review=true&limit=1", headers=world.manager.headers)).json()["total"] == 1
    # ... or on a manual hide
    assert (await hide(pg_client, world.manager, reported)).status_code == 200
    assert (await pg_client.get(f"{ADMIN}?needs_review=true&limit=1", headers=world.manager.headers)).json()["total"] == 0
    # an editor's badge is scoped to their own sermons
    await add_reports(sessions, make_user, world.on_b, 1)
    own = (await pg_client.get(f"{ADMIN}?needs_review=true&limit=1", headers=world.editor_a.headers)).json()
    assert own["total"] == 0
    mgr = (await pg_client.get(f"{ADMIN}?needs_review=true&limit=1", headers=world.manager.headers)).json()
    assert mgr["total"] == 1


# ── DTO shape ────────────────────────────────────────────────────────────────
COMMON = {
    "id", "sermon_id", "author_display_name", "body", "created_at", "is_mine", "status", "hidden_label",
    "hidden_at", "hidden_reason", "hidden_auto", "report_count", "sermon_title",
}


async def test_adm_list_08_editor_dto_omits_author_email_and_id(pg_client, world):
    (item,) = (await pg_client.get(ADMIN, headers=world.editor_a.headers)).json()["items"]
    assert set(item) == COMMON
    assert "author_email" not in item and "author_id" not in item
    assert "casey@example.com" not in (await pg_client.get(ADMIN, headers=world.editor_a.headers)).text
    assert item["sermon_title"] == "Sermon A" and item["author_display_name"] == "Casey A."


@pytest.mark.parametrize("role", ["manager", "admin"])
async def test_adm_list_08_manager_and_admin_dto_has_email_and_id(pg_client, world, role):
    page = (await pg_client.get(f"{ADMIN}?sermon_id={world.sermon_a}", headers=by_role(world, role).headers)).json()
    (item,) = page["items"]
    assert set(item) == COMMON | {"hidden_by_id", "author_id", "author_email"}
    assert item["author_email"] == "casey@example.com" and item["author_id"] == str(world.author.id)
    assert item["is_mine"] is False and item["status"] == "VISIBLE"


async def test_adm_list_08_hide_and_restore_responses_follow_the_same_dto(pg_client, world):
    resp = await hide(pg_client, world.manager, world.on_a)
    assert set(resp.json()) == COMMON | {"hidden_by_id", "author_id", "author_email"}
    assert resp.json()["status"] == "HIDDEN"


async def test_adm_list_11_includes_hidden_and_deactivated_authors(pg_client, world, sessions, seed_comment):
    gone = await seed_comment(world.sermon_a, world.author.id, "hidden", status=CommentStatus.HIDDEN)
    async with sessions() as s:
        await s.execute(update(User).where(User.id == world.author.id).values(is_active=False))
        await s.commit()
    page = (await pg_client.get(f"{ADMIN}?sermon_id={world.sermon_a}", headers=world.manager.headers)).json()
    assert str(gone) in {i["id"] for i in page["items"]} and page["total"] == 2


async def test_adm_del_07_openapi_never_exposes_body_snapshot(pg_client):
    schemas = app.openapi()["components"]["schemas"]
    assert "CommentAdmin" in schemas and "CommentAdminForEditor" in schemas
    assert "author_email" not in schemas["CommentAdminForEditor"]["properties"]
    assert "author_id" not in schemas["CommentAdminForEditor"]["properties"]
    assert "body_snapshot" not in repr(app.openapi())


# ── §A.6 R6: hide ────────────────────────────────────────────────────────────
@pytest.mark.parametrize("role", ["manager", "admin"])
async def test_m_r6_hide_allowed_for_manager_and_admin(pg_client, world, db_rows, role):
    actor = by_role(world, role)
    resp = await hide(pg_client, actor, world.on_a, reason="Targeted insult")
    assert resp.status_code == 200
    c = await row(db_rows, world.on_a)
    assert (c.status, c.hidden_auto, c.hidden_by_id, c.hidden_reason) == (
        CommentStatus.HIDDEN, False, actor.id, "Targeted insult",
    )
    assert c.hidden_at is not None
    (entry,) = await logs(db_rows, world.on_a)
    assert (entry.action, entry.actor_id, entry.reason, entry.body_snapshot) == (
        ModerationAction.HIDE, actor.id, "Targeted insult", None,
    )
    assert (entry.sermon_id, entry.author_id) == (uuid.UUID(world.sermon_a), world.author.id)


@pytest.mark.parametrize("role", ["viewer", "editor"])
async def test_m_r6_hide_and_restore_denied(pg_client, world, db_rows, seed_comment, role):
    actor = by_role(world, role)
    hidden = await seed_comment(world.sermon_a, world.author.id, "h", status=CommentStatus.HIDDEN)
    assert (await hide(pg_client, actor, world.on_a)).status_code == 403
    assert (await restore(pg_client, actor, hidden)).status_code == 403
    assert (await row(db_rows, world.on_a)).status == CommentStatus.VISIBLE
    assert (await row(db_rows, hidden)).status == CommentStatus.HIDDEN
    assert await logs(db_rows) == []


async def test_m_r6_anonymous_is_401(pg_client, world, db_rows):
    assert (await pg_client.post(f"{ADMIN}/{world.on_a}/hide", json={"reason": "x"})).status_code == 401
    assert (await pg_client.post(f"{ADMIN}/{world.on_a}/restore")).status_code == 401
    assert await logs(db_rows) == []


async def test_adm_hide_04_the_author_cannot_hide_their_own_comment(pg_client, world, db_rows):
    assert (await hide(pg_client, world.author, world.on_a)).status_code == 403
    assert (await row(db_rows, world.on_a)).status == CommentStatus.VISIBLE


@pytest.mark.parametrize(
    "payload",
    [{}, {"reason": ""}, {"reason": "   \n\t "}, {"reason": "x" * 301}, {"reason": None}, {"reason": "ok", "extra": 1}],
)
async def test_adm_hide_02_reason_required_and_capped(pg_client, world, db_rows, payload):
    resp = await pg_client.post(f"{ADMIN}/{world.on_a}/hide", json=payload, headers=world.manager.headers)
    assert resp.status_code == 422
    assert (await row(db_rows, world.on_a)).status == CommentStatus.VISIBLE
    assert await logs(db_rows) == []


async def test_adm_hide_02_reason_boundary_and_normalisation(pg_client, world, db_rows):
    resp = await hide(pg_client, world.manager, world.on_a, reason="  " + "r" * 300 + "‮ ")
    assert resp.status_code == 200
    assert (await row(db_rows, world.on_a)).hidden_reason == "r" * 300  # trimmed, bidi control stripped


async def test_adm_hide_02_missing_body_is_422(pg_client, world):
    assert (await pg_client.post(f"{ADMIN}/{world.on_a}/hide", headers=world.manager.headers)).status_code == 422


async def test_adm_hide_03_idempotent_no_second_log_no_hidden_at_bump(pg_client, world, db_rows):
    assert (await hide(pg_client, world.manager, world.on_a, reason="first")).status_code == 200
    first = await row(db_rows, world.on_a)
    again = await hide(pg_client, world.admin, world.on_a, reason="second")
    assert again.status_code == 200 and again.json()["status"] == "HIDDEN"
    second = await row(db_rows, world.on_a)
    assert (second.hidden_at, second.hidden_by_id, second.hidden_reason) == (
        first.hidden_at, world.manager.id, "first",
    )
    assert len(await logs(db_rows, world.on_a, ModerationAction.HIDE)) == 1


async def test_adm_hide_05_unknown_is_404_malformed_is_422(pg_client, world):
    assert (await hide(pg_client, world.manager, uuid.uuid4())).status_code == 404
    assert (await restore(pg_client, world.manager, uuid.uuid4())).status_code == 404
    assert (await pg_client.post(f"{ADMIN}/nope/hide", json={"reason": "x"}, headers=world.manager.headers)).status_code == 422
    assert (await pg_client.post(f"{ADMIN}/nope/restore", headers=world.manager.headers)).status_code == 422


async def test_mod_19_manual_hide_on_auto_hidden_converts_it(pg_client, world, make_user, db_rows, seed_comment):
    """A9: hidden_auto flips to false, the author's label flips to
    removed_by_moderator, one `hide` log row; a repeat adds nothing."""
    cid = await seed_comment(world.sermon_a, world.author.id, "auto", status=CommentStatus.HIDDEN, hidden_auto=True)
    mine = await pg_client.get(f"{API}/sermons/{world.sermon_a}/comments", headers=world.author.headers)
    label = next(i for i in mine.json()["items"] if i["id"] == str(cid))["hidden_label"]
    assert label == "under_review"
    assert (await hide(pg_client, world.manager, cid, reason="Confirmed abuse")).status_code == 200
    c = await row(db_rows, cid)
    assert (c.status, c.hidden_auto, c.hidden_by_id, c.hidden_reason) == (
        CommentStatus.HIDDEN, False, world.manager.id, "Confirmed abuse",
    )
    mine = await pg_client.get(f"{API}/sermons/{world.sermon_a}/comments", headers=world.author.headers)
    assert next(i for i in mine.json()["items"] if i["id"] == str(cid))["hidden_label"] == "removed_by_moderator"
    assert (await hide(pg_client, world.manager, cid, reason="again")).status_code == 200
    assert len(await logs(db_rows, cid, ModerationAction.HIDE)) == 1


async def test_mod_18_manual_hide_of_visible_is_not_auto(pg_client, world, db_rows):
    await hide(pg_client, world.manager, world.on_a)
    c = await row(db_rows, world.on_a)
    assert c.hidden_auto is False


async def test_hidden_comment_leaves_the_viewer_list_and_blocks_self_delete(pg_client, world):
    await hide(pg_client, world.manager, world.on_a)
    listing = await pg_client.get(f"{API}/sermons/{world.sermon_a}/comments", headers=world.viewer.headers)
    assert listing.json()["items"] == []
    assert (await pg_client.delete(f"{API}/comments/{world.on_a}", headers=world.author.headers)).status_code == 409


# ── §A.6 R6: restore ─────────────────────────────────────────────────────────
@pytest.mark.parametrize("role", ["manager", "admin"])
async def test_m_r6_restore_allowed_for_manager_and_admin(pg_client, world, db_rows, sessions, make_user, role):
    actor = by_role(world, role)
    await add_reports(sessions, make_user, world.on_a, 3)
    await hide(pg_client, world.manager, world.on_a)
    resp = await restore(pg_client, actor, world.on_a)
    assert resp.status_code == 200 and resp.json()["status"] == "VISIBLE"
    c = await row(db_rows, world.on_a)
    assert (c.status, c.hidden_auto, c.hidden_at, c.hidden_by_id, c.hidden_reason, c.report_count) == (
        CommentStatus.VISIBLE, False, None, None, None, 0,
    )
    (entry,) = await logs(db_rows, world.on_a, ModerationAction.RESTORE)
    assert (entry.actor_id, entry.reason, entry.body_snapshot) == (actor.id, None, None)


async def test_adm_rest_02_idempotent_no_log_no_baseline_bump(pg_client, world, db_rows):
    assert (await restore(pg_client, world.manager, world.on_a)).status_code == 200  # already VISIBLE
    assert await logs(db_rows, world.on_a) == []
    await hide(pg_client, world.manager, world.on_a)
    await restore(pg_client, world.manager, world.on_a)
    first = (await logs(db_rows, world.on_a, ModerationAction.RESTORE))[0].created_at
    assert (await restore(pg_client, world.admin, world.on_a)).status_code == 200
    (only,) = await logs(db_rows, world.on_a, ModerationAction.RESTORE)
    assert only.created_at == first


async def test_restore_of_auto_hidden_clears_the_auto_marker(pg_client, world, seed_comment, db_rows, sessions, make_user):
    cid = await seed_comment(world.sermon_a, world.author.id, "auto", status=CommentStatus.HIDDEN, hidden_auto=True)
    await add_reports(sessions, make_user, cid, 3)
    assert (await restore(pg_client, world.manager, cid)).status_code == 200
    c = await row(db_rows, cid)
    assert (c.status, c.hidden_auto, c.report_count) == (CommentStatus.VISIBLE, False, 0)


async def test_restore_log_row_is_stamped_after_the_prior_reports(pg_client, world, sessions, make_user, db_rows):
    await add_reports(sessions, make_user, world.on_a, 2)
    await hide(pg_client, world.manager, world.on_a)
    await restore(pg_client, world.manager, world.on_a)
    (entry,) = await logs(db_rows, world.on_a, ModerationAction.RESTORE)
    reports = await db_rows(SermonCommentReport, comment_id=world.on_a)
    assert all(r.created_at < entry.created_at for r in reports)


# ── §A.6 R7: hard delete ─────────────────────────────────────────────────────
async def test_m_r7_admin_hard_delete_writes_snapshot(pg_client, world, db_rows, sessions, make_user):
    await add_reports(sessions, make_user, world.on_a, 2)
    resp = await delete_(pg_client, world.admin, world.on_a, reason="Harassment of a member")
    assert resp.status_code == 204 and resp.content == b""
    assert await row(db_rows, world.on_a) is None
    assert await db_rows(SermonCommentReport, comment_id=world.on_a) == []  # reports cascade
    (entry,) = await logs(db_rows, world.on_a)
    assert (entry.action, entry.actor_id, entry.reason, entry.body_snapshot) == (
        ModerationAction.HARD_DELETE, world.admin.id, "Harassment of a member", "on a",
    )
    assert (entry.sermon_id, entry.author_id) == (uuid.UUID(world.sermon_a), world.author.id)
    other = await row(db_rows, world.on_b)
    assert other is not None  # nothing else touched


@pytest.mark.parametrize("role", ["viewer", "editor", "manager"])
async def test_m_r7_hard_delete_denied(pg_client, world, db_rows, role):
    resp = await delete_(pg_client, by_role(world, role), world.on_a)
    assert resp.status_code == 403
    assert (await row(db_rows, world.on_a)).status == CommentStatus.VISIBLE
    assert await logs(db_rows) == []


async def test_m_r7_anonymous_is_401(pg_client, world, db_rows):
    resp = await pg_client.request("DELETE", f"{ADMIN}/{world.on_a}", json={"reason": "x"})
    assert resp.status_code == 401
    assert await row(db_rows, world.on_a) is not None and await logs(db_rows) == []


@pytest.mark.parametrize("payload", [{}, {"reason": ""}, {"reason": "  "}, {"reason": "x" * 301}])
async def test_adm_del_03_reason_required_no_partial_delete(pg_client, world, db_rows, payload):
    resp = await pg_client.request("DELETE", f"{ADMIN}/{world.on_a}", json=payload, headers=world.admin.headers)
    assert resp.status_code == 422
    assert await row(db_rows, world.on_a) is not None and await logs(db_rows) == []


async def test_adm_del_03_missing_body_is_422(pg_client, world, db_rows):
    resp = await pg_client.delete(f"{ADMIN}/{world.on_a}", headers=world.admin.headers)
    assert resp.status_code == 422
    assert await row(db_rows, world.on_a) is not None


async def test_adm_del_04_works_on_hidden_auto_and_manual(pg_client, world, db_rows, seed_comment):
    auto = await seed_comment(world.sermon_a, world.author.id, "auto body", status=CommentStatus.HIDDEN, hidden_auto=True)
    manual = await seed_comment(world.sermon_a, world.author.id, "manual body", status=CommentStatus.HIDDEN)
    for cid in (auto, manual):
        assert (await delete_(pg_client, world.admin, cid)).status_code == 204
        assert await row(db_rows, cid) is None
    snaps = {e.comment_id: e.body_snapshot for e in await logs(db_rows, action=ModerationAction.HARD_DELETE)}
    assert snaps == {auto: "auto body", manual: "manual body"}


async def test_adm_del_05_second_delete_is_404_with_no_duplicate_log(pg_client, world, db_rows):
    assert (await delete_(pg_client, world.admin, world.on_a)).status_code == 204
    assert (await delete_(pg_client, world.admin, world.on_a)).status_code == 404
    assert len(await logs(db_rows, world.on_a)) == 1


async def test_adm_del_06_log_survives_sermon_and_author_deletion(pg_client, world, db_rows, sessions):
    await delete_(pg_client, world.admin, world.on_a)
    async with sessions() as s:
        await s.execute(delete(SermonComment).where(SermonComment.sermon_id == uuid.UUID(world.sermon_a)))
        await s.execute(delete(Sermon).where(Sermon.id == uuid.UUID(world.sermon_a)))
        await s.execute(delete(User).where(User.id == world.author.id))
        await s.commit()
    (entry,) = await logs(db_rows, world.on_a)
    assert entry.body_snapshot == "on a" and entry.author_id == world.author.id


async def test_adm_del_08_self_delete_never_snapshots_admin_delete_does(pg_client, world, db_rows, seed_comment):
    mine = await seed_comment(world.sermon_a, world.author.id, "mine")
    assert (await pg_client.delete(f"{API}/comments/{mine}", headers=world.author.headers)).status_code == 204
    assert (await delete_(pg_client, world.admin, world.on_a)).status_code == 204
    (self_row,) = await logs(db_rows, mine)
    (admin_row,) = await logs(db_rows, world.on_a)
    assert (self_row.action, self_row.body_snapshot) == (ModerationAction.SELF_DELETE, None)
    assert (admin_row.action, admin_row.body_snapshot) == (ModerationAction.HARD_DELETE, "on a")


async def test_adm_auth_01_admin_as_author_uses_the_viewer_route_for_own_comment(pg_client, world, seed_comment):
    own = await seed_comment(world.sermon_a, world.admin.id, "admin's own")
    assert (await pg_client.delete(f"{API}/comments/{world.on_a}", headers=world.admin.headers)).status_code == 404
    assert (await pg_client.delete(f"{API}/comments/{own}", headers=world.admin.headers)).status_code == 204


# ── Auth state ───────────────────────────────────────────────────────────────
async def test_adm_auth_02_demoted_admin_loses_access_on_the_next_request(pg_client, world, sessions, db_rows):
    assert (await pg_client.get(ADMIN, headers=world.admin.headers)).status_code == 200
    async with sessions() as s:
        await s.execute(update(User).where(User.id == world.admin.id).values(role=UserRole.VIEWER))
        await s.commit()
    assert (await pg_client.get(ADMIN, headers=world.admin.headers)).status_code == 403
    assert (await delete_(pg_client, world.admin, world.on_a)).status_code == 403
    assert await row(db_rows, world.on_a) is not None


async def test_adm_list_09_moderator_id_is_for_manager_and_admin_only(pg_client, world):
    """C-1: hidden_by_id is absent from the EDITOR schema, present for MANAGER/ADMIN."""
    hidden = await hide(pg_client, world.manager, world.on_a)
    assert hidden.status_code == 200 and hidden.json()["hidden_by_id"] == str(world.manager.id)
    editor = await pg_client.get(ADMIN, headers=world.editor_a.headers)
    (item,) = editor.json()["items"]
    assert "hidden_by_id" not in item and item["hidden_reason"] == "Off topic"
    assert str(world.manager.id) not in editor.text
    for actor in (world.manager, world.admin):
        items = (await pg_client.get(f"{ADMIN}?status=HIDDEN", headers=actor.headers)).json()["items"]
        assert items and all(i["hidden_by_id"] == str(world.manager.id) for i in items)


async def test_adm_auth_03_inactive_staff_are_rejected(pg_client, world, sessions):
    async with sessions() as s:
        await s.execute(update(User).where(User.id == world.manager.id).values(is_active=False))
        await s.commit()
    assert (await pg_client.get(ADMIN, headers=world.manager.headers)).status_code == 401
    assert (await hide(pg_client, world.manager, world.on_a)).status_code == 401


# ── Dismiss reports (C3 contract addition) ───────────────────────────────────
@pytest.mark.parametrize("role", ["manager", "admin"])
async def test_dr_allowed_for_manager_and_admin(pg_client, world, db_rows, sessions, make_user, role):
    actor = by_role(world, role)
    await add_reports(sessions, make_user, world.on_a, 2)
    resp = await dismiss(pg_client, actor, world.on_a)
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == str(world.on_a) and body["report_count"] == 0 and body["status"] == "VISIBLE"
    assert "author_email" in body  # the CommentAdmin row, like hide and restore
    (entry,) = await logs(db_rows, world.on_a)
    assert (entry.action, entry.actor_id, entry.reason, entry.body_snapshot) == (
        ModerationAction.DISMISS_REPORTS, actor.id, "Reviewed, no action", None,
    )
    assert entry.cleared_report_count == 2
    assert (entry.sermon_id, entry.author_id) == (uuid.UUID(world.sermon_a), world.author.id)


@pytest.mark.parametrize("role", ["viewer", "editor"])
async def test_dr_denied_by_role_no_state_change(pg_client, world, db_rows, sessions, make_user, role):
    await add_reports(sessions, make_user, world.on_a, 2)
    assert (await dismiss(pg_client, by_role(world, role), world.on_a)).status_code == 403
    # role is checked before the lookup: an unknown id is still 403, not 404
    assert (await dismiss(pg_client, by_role(world, role), uuid.uuid4())).status_code == 403
    assert (await row(db_rows, world.on_a)).report_count == 2
    assert await logs(db_rows) == []


async def test_dr_anonymous_is_401(pg_client, world, db_rows, sessions, make_user):
    await add_reports(sessions, make_user, world.on_a, 1)
    assert (await pg_client.post(f"{ADMIN}/{world.on_a}/dismiss-reports")).status_code == 401
    assert (await row(db_rows, world.on_a)).report_count == 1
    assert await logs(db_rows) == []


async def test_dr_leaves_status_and_hide_fields_alone_and_the_author_label_unchanged(
    pg_client, world, db_rows, sessions, make_user
):
    await add_reports(sessions, make_user, world.on_a, 2)
    before = await row(db_rows, world.on_a)
    resp = await dismiss(pg_client, world.manager, world.on_a)
    assert resp.status_code == 200
    after = await row(db_rows, world.on_a)
    assert after.report_count == 0
    assert (after.status, after.hidden_at, after.hidden_by_id, after.hidden_reason, after.hidden_auto) == (
        before.status, before.hidden_at, before.hidden_by_id, before.hidden_reason, before.hidden_auto,
    )
    assert resp.json()["hidden_label"] is None
    mine = await pg_client.get(f"{API}/sermons/{world.sermon_a}/comments", headers=world.author.headers)
    item = next(i for i in mine.json()["items"] if i["id"] == str(world.on_a))
    assert item["hidden_label"] is None


async def test_dr_reason_is_stored_trimmed(pg_client, world, db_rows, sessions, make_user):
    await add_reports(sessions, make_user, world.on_a, 1)
    resp = await dismiss(pg_client, world.manager, world.on_a, json={"reason": "  Reviewed, fine  "})
    assert resp.status_code == 200
    (entry,) = await logs(db_rows, world.on_a, ModerationAction.DISMISS_REPORTS)
    assert entry.reason == "Reviewed, fine"


@pytest.mark.parametrize("payload,ok", [
    ({"reason": "x"}, True), ({"reason": "x" * 300}, True),
    ({}, False), ({"reason": None}, False), ({"reason": ""}, False), ({"reason": "   "}, False),
    ({"reason": "\u200b\u202e "}, False), ({"reason": "x" * 301}, False),
    ({"reason": "x" * 100_000}, False), ({"reason": "ok", "other": "y"}, False),
])
async def test_dr_reason_is_required_and_capped(pg_client, world, db_rows, sessions, make_user, payload, ok):
    await add_reports(sessions, make_user, world.on_a, 1)
    resp = await dismiss(pg_client, world.manager, world.on_a, json=payload)
    assert resp.status_code == (200 if ok else 422)
    c = await row(db_rows, world.on_a)
    assert c.report_count == (0 if ok else 1)
    assert len(await logs(db_rows, world.on_a)) == (1 if ok else 0)


async def test_dr_missing_body_is_422_no_change(pg_client, world, db_rows, sessions, make_user):
    await add_reports(sessions, make_user, world.on_a, 2)
    resp = await pg_client.post(f"{ADMIN}/{world.on_a}/dismiss-reports", headers=world.manager.headers)
    assert resp.status_code == 422
    assert (await row(db_rows, world.on_a)).report_count == 2
    assert await logs(db_rows) == []


async def test_dr_records_the_cleared_count_per_dismissal(pg_client, world, db_rows, sessions, make_user):
    await add_reports(sessions, make_user, world.on_a, 2)
    await dismiss(pg_client, world.manager, world.on_a, json={"reason": "first"})
    await add_reports(sessions, make_user, world.on_a, 1)
    await dismiss(pg_client, world.manager, world.on_a, json={"reason": "second"})
    entries = sorted(await logs(db_rows, world.on_a, ModerationAction.DISMISS_REPORTS), key=lambda e: e.created_at)
    assert [(e.reason, e.cleared_report_count) for e in entries] == [("first", 2), ("second", 1)]


async def test_dr_zero_reports_is_an_idempotent_no_op_but_still_needs_a_valid_reason(pg_client, world, db_rows):
    assert (await dismiss(pg_client, world.manager, world.on_a)).status_code == 200
    assert (await row(db_rows, world.on_a)).report_count == 0
    assert await logs(db_rows) == []
    for bad in ({}, {"reason": "  "}, {"reason": "x" * 301}):
        assert (await dismiss(pg_client, world.manager, world.on_a, json=bad)).status_code == 422
    no_body = await pg_client.post(f"{ADMIN}/{world.on_a}/dismiss-reports", headers=world.manager.headers)
    assert no_body.status_code == 422
    assert await logs(db_rows) == []


async def test_dr_second_dismissal_writes_no_second_row(pg_client, world, db_rows, sessions, make_user):
    await add_reports(sessions, make_user, world.on_a, 2)
    await dismiss(pg_client, world.manager, world.on_a)
    first = (await logs(db_rows, world.on_a))[0].created_at
    assert (await dismiss(pg_client, world.admin, world.on_a)).status_code == 200
    (only,) = await logs(db_rows, world.on_a)
    assert only.created_at == first


@pytest.mark.parametrize("auto", [False, True])
async def test_dr_hidden_comment_is_409_no_change(pg_client, world, db_rows, sessions, make_user, seed_comment, auto):
    cid = await seed_comment(world.sermon_a, world.author.id, "h", status=CommentStatus.HIDDEN, hidden_auto=auto)
    await add_reports(sessions, make_user, cid, 3)
    resp = await dismiss(pg_client, world.manager, cid)
    assert resp.status_code == 409
    c = await row(db_rows, cid)
    assert (c.status, c.hidden_auto, c.report_count) == (CommentStatus.HIDDEN, auto, 3)
    assert await logs(db_rows, cid) == []


async def test_dr_unknown_is_404_malformed_is_422(pg_client, world):
    assert (await dismiss(pg_client, world.manager, uuid.uuid4())).status_code == 404
    bad = await pg_client.post(
        f"{ADMIN}/nope/dismiss-reports", headers=world.manager.headers, json={"reason": "r"}
    )
    assert bad.status_code == 422


async def test_dr_clears_needs_review(pg_client, world, sessions, make_user):
    await add_reports(sessions, make_user, world.on_a, 2)
    url = f"{ADMIN}?needs_review=true&limit=1"
    assert (await pg_client.get(url, headers=world.manager.headers)).json()["total"] == 1
    await dismiss(pg_client, world.manager, world.on_a)
    assert (await pg_client.get(url, headers=world.manager.headers)).json()["total"] == 0


async def test_dr_rearm_three_new_reporters_hide_again_old_reports_do_not_count(
    pg_client, world, db_rows, make_user
):
    old = [await make_user() for _ in range(2)]
    fresh = [await make_user() for _ in range(3)]
    for u in old:
        assert (await report_via_api(pg_client, u, world.on_a)).status_code == 204
    assert (await row(db_rows, world.on_a)).report_count == 2
    assert (await dismiss(pg_client, world.manager, world.on_a)).status_code == 200
    # the two pre-dismissal reporters report again: idempotent, nothing counts
    for u in old:
        await report_via_api(pg_client, u, world.on_a)
    c = await row(db_rows, world.on_a)
    assert (c.status, c.report_count) == (CommentStatus.VISIBLE, 0)
    # two fresh reporters: 2 < 3, still visible; the old reports must not tip it
    for u in fresh[:2]:
        await report_via_api(pg_client, u, world.on_a)
    c = await row(db_rows, world.on_a)
    assert (c.status, c.report_count) == (CommentStatus.VISIBLE, 2)
    assert await logs(db_rows, world.on_a, ModerationAction.AUTO_HIDE) == []
    # the third new distinct reporter auto-hides again
    await report_via_api(pg_client, fresh[2], world.on_a)
    c = await row(db_rows, world.on_a)
    assert (c.status, c.hidden_auto, c.report_count) == (CommentStatus.HIDDEN, True, 3)
    assert len(await logs(db_rows, world.on_a, ModerationAction.AUTO_HIDE)) == 1


async def test_dr_rearm_old_reports_below_threshold_never_hide_after_dismissal(
    pg_client, world, db_rows, make_user
):
    """Two reports, a dismissal, then ONE new reporter: total reports on file
    is 3 but only 1 is after the baseline, so the comment stays VISIBLE."""
    for u in [await make_user() for _ in range(2)]:
        await report_via_api(pg_client, u, world.on_a)
    await dismiss(pg_client, world.manager, world.on_a)
    await report_via_api(pg_client, await make_user(), world.on_a)
    c = await row(db_rows, world.on_a)
    assert (c.status, c.report_count) == (CommentStatus.VISIBLE, 1)


async def test_dr_row_is_stamped_after_the_prior_reports(pg_client, world, sessions, make_user, db_rows):
    await add_reports(sessions, make_user, world.on_a, 2)
    await dismiss(pg_client, world.manager, world.on_a)
    (entry,) = await logs(db_rows, world.on_a, ModerationAction.DISMISS_REPORTS)
    assert all(r.created_at < entry.created_at for r in await db_rows(SermonCommentReport, comment_id=world.on_a))


async def test_dr_race_with_a_reporter_leaves_a_consistent_row(pg_client, world, db_rows, make_user):
    first, second = await make_user(), await make_user()
    await report_via_api(pg_client, first, world.on_a)
    rs = await asyncio.gather(
        dismiss(pg_client, world.manager, world.on_a), report_via_api(pg_client, second, world.on_a)
    )
    assert [r.status_code for r in rs] == [200, 204]
    c = await row(db_rows, world.on_a)
    # the report either landed before the dismissal (count 0) or after it (count 1)
    assert c.status == CommentStatus.VISIBLE and c.report_count in (0, 1)
    assert len(await logs(db_rows, world.on_a, ModerationAction.DISMISS_REPORTS)) == 1


# ── Atomicity ────────────────────────────────────────────────────────────────
async def test_adm_tx_01_hide_rolls_back_when_the_log_insert_fails(pg_client, world, break_moderation_log, db_rows):
    resp = await hide(pg_client, world.manager, world.on_a)
    assert resp.status_code == 500
    c = await row(db_rows, world.on_a)
    assert (c.status, c.hidden_at, c.hidden_by_id, c.hidden_reason) == (CommentStatus.VISIBLE, None, None, None)


async def test_adm_tx_01_restore_rolls_back_when_the_log_insert_fails(
    pg_client, world, break_moderation_log, db_rows, seed_comment, sessions, make_user
):
    cid = await seed_comment(world.sermon_a, world.author.id, "h", status=CommentStatus.HIDDEN, hidden_auto=True)
    await add_reports(sessions, make_user, cid, 3)
    assert (await restore(pg_client, world.manager, cid)).status_code == 500
    c = await row(db_rows, cid)
    assert (c.status, c.hidden_auto, c.report_count) == (CommentStatus.HIDDEN, True, 3)


async def test_adm_tx_01_dismiss_reports_rolls_back_when_the_log_insert_fails(
    pg_client, world, break_moderation_log, db_rows, sessions, make_user
):
    await add_reports(sessions, make_user, world.on_a, 2)
    assert (await dismiss(pg_client, world.manager, world.on_a)).status_code == 500
    c = await row(db_rows, world.on_a)
    assert (c.status, c.report_count) == (CommentStatus.VISIBLE, 2)
    assert await logs(db_rows) == []


async def test_adm_tx_01_hard_delete_rolls_back_when_the_log_insert_fails(pg_client, world, break_moderation_log, db_rows):
    assert (await delete_(pg_client, world.admin, world.on_a)).status_code == 500
    assert await row(db_rows, world.on_a) is not None


# ── Races ────────────────────────────────────────────────────────────────────
async def test_race_08_concurrent_hides_write_one_log_row(pg_client, world, db_rows, seed_comment):
    for i in range(5):
        cid = await seed_comment(world.sermon_a, world.author.id, f"h{i}")
        rs = await asyncio.gather(
            hide(pg_client, world.manager, cid), hide(pg_client, world.admin, cid), hide(pg_client, world.manager, cid)
        )
        assert [r.status_code for r in rs] == [200, 200, 200]
        assert len(await logs(db_rows, cid, ModerationAction.HIDE)) == 1


async def test_race_05_report_vs_hard_delete(pg_client, world, make_user, seed_comment, db_rows):
    for i in range(6):
        cid = await seed_comment(world.sermon_a, world.author.id, f"race {i}")
        reporter = await make_user()
        rep, dele = await asyncio.gather(
            pg_client.post(f"{API}/comments/{cid}/report", json={"reason": "spam"}, headers=reporter.headers),
            delete_(pg_client, world.admin, cid),
        )
        assert dele.status_code == 204
        assert rep.status_code in (204, 404)
        assert await row(db_rows, cid) is None
        assert await db_rows(SermonCommentReport, comment_id=cid) == []
        (entry,) = await logs(db_rows, cid, ModerationAction.HARD_DELETE)
        assert entry.body_snapshot == f"race {i}"


async def test_race_hide_vs_restore_never_errors_and_leaves_a_consistent_row(pg_client, world, db_rows):
    for _ in range(6):
        await hide(pg_client, world.manager, world.on_a)
        rs = await asyncio.gather(restore(pg_client, world.admin, world.on_a), hide(pg_client, world.manager, world.on_a))
        assert all(r.status_code == 200 for r in rs)
        c = await row(db_rows, world.on_a)
        if c.status == CommentStatus.VISIBLE:
            assert (c.hidden_at, c.hidden_by_id, c.hidden_reason, c.hidden_auto) == (None, None, None, False)
        else:
            assert (c.hidden_by_id, c.hidden_reason) == (world.manager.id, "Off topic") and c.hidden_at is not None
        await restore(pg_client, world.admin, world.on_a)


# ── Logging ──────────────────────────────────────────────────────────────────
async def test_bodies_and_reasons_never_reach_logs(pg_client, world, capture_logs, seed_comment):
    secret = await seed_comment(world.sermon_a, world.author.id, "SENTINEL-BODY-9f31")
    await hide(pg_client, world.manager, secret, reason="SENTINEL-REASON-77c2")
    await restore(pg_client, world.manager, secret)
    await delete_(pg_client, world.admin, secret, reason="SENTINEL-REASON-88d3")
    text = capture_logs.text()
    assert "SENTINEL-BODY" not in text and "SENTINEL-REASON" not in text
    assert any(r["event"] == "comment_hard_deleted" for r in capture_logs.records)
