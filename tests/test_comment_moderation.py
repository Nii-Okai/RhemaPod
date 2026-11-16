"""Auto-hide, the re-arm rule and report races (plan S6, §A.5), real Postgres.

The re-arm tests (MOD-10 .. MOD-17) drive the real moderation routes
(`POST /admin/comments/{id}/hide` and `/restore`, S7) as a MANAGER.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import get_settings
from app.models.models import (
    CommentModerationLog,
    CommentReportReason,
    CommentStatus,
    ModerationAction,
    SermonComment,
    SermonCommentReport,
    User,
    UserBlock,
)
from app.services import comments_service
from app.services.content_service import ContentError
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


async def report(client, user, cid, reason="spam"):
    return await client.post(
        f"{API}/comments/{cid}/report", json={"reason": reason}, headers=user.headers
    )


async def comment_row(db_rows, cid) -> SermonComment:
    return (await db_rows(SermonComment, id=cid))[0]


async def logs(db_rows, action: ModerationAction):
    return await db_rows(CommentModerationLog, action=action)


@pytest.fixture
async def moderator(make_user):
    return await make_user(role="manager", full_name="Mod Erator")


@pytest.fixture
def moderator_restore(pg_client, moderator):
    async def _restore(cid) -> None:
        resp = await pg_client.post(f"{API}/admin/comments/{cid}/restore", headers=moderator.headers)
        assert resp.status_code == 200, resp.text

    return _restore


@pytest.fixture
def moderator_hide(pg_client, moderator):
    async def _hide(cid, reason="Off topic") -> None:
        resp = await pg_client.post(
            f"{API}/admin/comments/{cid}/hide", json={"reason": reason}, headers=moderator.headers
        )
        assert resp.status_code == 200, resp.text

    return _hide


@pytest.fixture
def fresh_reporters(make_user):
    async def _many(n: int, **kw):
        return [await make_user(**kw) for _ in range(n)]

    return _many


@pytest.fixture
async def target(published_sermon, make_user, seed_comment):
    """(sermon id, author, comment id) for a VISIBLE comment."""
    sid = await published_sermon()
    author = await make_user(full_name="Target Author")
    return sid, author, await seed_comment(sid, author.id, "a comment")


# ── Auto-hide ────────────────────────────────────────────────────────────────
async def test_mod_01_02_default_threshold_is_three(target, pg_client, fresh_reporters, db_rows):
    assert get_settings().comments_auto_hide_threshold == 3
    sid, author, cid = target
    a, b, c = await fresh_reporters(3)
    for who in (a, b):
        assert (await report(pg_client, who, cid)).status_code == 204
    row = await comment_row(db_rows, cid)
    assert (row.status, row.report_count) == (CommentStatus.VISIBLE, 2)
    assert await logs(db_rows, ModerationAction.AUTO_HIDE) == []

    assert (await report(pg_client, c, cid)).status_code == 204
    row = await comment_row(db_rows, cid)
    assert row.status == CommentStatus.HIDDEN and row.hidden_auto is True
    assert row.hidden_at is not None and row.hidden_by_id is None and row.hidden_reason is None
    assert row.report_count == 3
    (entry,) = await logs(db_rows, ModerationAction.AUTO_HIDE)
    assert entry.actor_id is None and entry.reason is None and entry.body_snapshot is None
    assert (entry.comment_id, entry.sermon_id, entry.author_id) == (cid, uuid.UUID(sid), author.id)


@pytest.mark.parametrize("threshold", [1, 2, 3, 5])
async def test_mod_03_threshold_off_by_one(
    monkeypatch, pg_client, published_sermon, make_user, seed_comment, db_rows, threshold
):
    monkeypatch.setattr(get_settings(), "comments_auto_hide_threshold", threshold)
    sid = await published_sermon()
    cid = await seed_comment(sid, (await make_user()).id)
    for i in range(threshold - 1):
        assert (await report(pg_client, await make_user(), cid)).status_code == 204
        assert (await comment_row(db_rows, cid)).status == CommentStatus.VISIBLE, i
    assert (await report(pg_client, await make_user(), cid)).status_code == 204
    assert (await comment_row(db_rows, cid)).status == CommentStatus.HIDDEN


async def test_mod_04_distinct_reporters_only(target, pg_client, fresh_reporters, db_rows):
    sid, author, cid = target
    (repeat,) = await fresh_reporters(1)
    for _ in range(3):
        assert (await report(pg_client, repeat, cid)).status_code == 204
    for _ in range(3):
        assert (await report(pg_client, author, cid)).status_code == 204  # self-reports never count
    row = await comment_row(db_rows, cid)
    assert (row.status, row.report_count) == (CommentStatus.VISIBLE, 1)


async def test_mod_05_reasons_count_together(target, pg_client, fresh_reporters, db_rows):
    _, _, cid = target
    reasons = ["spam", "hate", "self_harm"]
    for who, reason in zip(await fresh_reporters(3), reasons):
        await report(pg_client, who, cid, reason)
    assert (await comment_row(db_rows, cid)).status == CommentStatus.HIDDEN
    assert {r.reason for r in await db_rows(SermonCommentReport)} == {CommentReportReason(r) for r in reasons}


async def test_mod_06_staff_blocked_and_later_inactive_reporters_still_count(
    target, pg_client, make_user, sessions, db_rows
):
    sid, author, cid = target
    staff = await make_user(role="manager")
    blocked_by_author = await make_user()
    inactive_later = await make_user()
    async with sessions() as s:
        s.add(UserBlock(blocker_id=author.id, blocked_id=blocked_by_author.id))
        await s.commit()
    await report(pg_client, staff, cid)
    await report(pg_client, blocked_by_author, cid)
    await report(pg_client, inactive_later, cid)
    async with sessions() as s:
        (await s.get(User, inactive_later.id)).is_active = False
        await s.commit()
    assert (await comment_row(db_rows, cid)).status == CommentStatus.HIDDEN


async def test_mod_07_effects_on_lists_and_author(target, pg_client, fresh_reporters, make_user, db_rows):
    sid, author, cid = target
    bystander = await make_user()
    before = (await pg_client.get(f"{API}/sermons/{sid}/comments", headers=bystander.headers)).json()["total"]
    for who in await fresh_reporters(3):
        await report(pg_client, who, cid)
    after = (await pg_client.get(f"{API}/sermons/{sid}/comments", headers=bystander.headers)).json()
    assert (before, after["total"], after["items"]) == (1, 0, [])
    own = (await pg_client.get(f"{API}/sermons/{sid}/comments", headers=author.headers)).json()["items"]
    assert [(i["status"], i["hidden_label"], i["is_mine"]) for i in own] == [("HIDDEN", "under_review", True)]
    assert (await pg_client.delete(f"{API}/comments/{cid}", headers=author.headers)).status_code == 409
    # Others now get a uniform 404 on it, so no further report can reach it.
    assert (await report(pg_client, bystander, cid)).status_code == 404


async def test_mod_08_service_never_writes_a_second_auto_hide(target, sessions, fresh_reporters, pg_client, db_rows):
    _, _, cid = target
    for who in await fresh_reporters(3):
        await report(pg_client, who, cid)
    (late,) = await fresh_reporters(1)
    async with sessions() as s:
        actor = await s.get(User, late.id)
        with pytest.raises(ContentError) as caught:
            await comments_service.report_comment(
                s, actor, cid, comments_service.CommentReportCreate(reason=CommentReportReason.SPAM)
            )
    assert caught.value.status_code == 404
    assert len(await logs(db_rows, ModerationAction.AUTO_HIDE)) == 1


async def test_mod_20_one_account_is_one_vote(target, pg_client, fresh_reporters, db_rows):
    _, _, cid = target
    (one,) = await fresh_reporters(1)
    for reason in ("spam", "hate", "other", "spam"):
        await report(pg_client, one, cid, reason)
    assert (await comment_row(db_rows, cid)).report_count == 1


# ── Re-arm (A.5.3) ───────────────────────────────────────────────────────────
async def _auto_hide(pg_client, cid, reporters):
    for who in reporters:
        assert (await report(pg_client, who, cid)).status_code == 204


async def test_mod_10_16_brigade_cannot_rehide_with_the_same_reports(
    target, pg_client, fresh_reporters, moderator_restore, db_rows
):
    _, _, cid = target
    old = await fresh_reporters(3)
    fresh = await fresh_reporters(2)
    await _auto_hide(pg_client, cid, old)
    assert (await comment_row(db_rows, cid)).status == CommentStatus.HIDDEN
    await moderator_restore(cid)
    restored = await comment_row(db_rows, cid)
    assert (restored.status, restored.hidden_auto, restored.report_count) == (CommentStatus.VISIBLE, False, 0)

    for who in old:  # same three again: idempotent, nothing new
        assert (await report(pg_client, who, cid)).status_code == 204
    assert (await comment_row(db_rows, cid)).status == CommentStatus.VISIBLE
    for who in fresh:  # two NEW reporters: 2 < 3
        await report(pg_client, who, cid)
    row = await comment_row(db_rows, cid)
    assert (row.status, row.report_count) == (CommentStatus.VISIBLE, 2)
    assert len(await logs(db_rows, ModerationAction.AUTO_HIDE)) == 1


async def test_mod_11_third_new_reporter_hides_again(
    target, pg_client, fresh_reporters, moderator_restore, db_rows
):
    _, _, cid = target
    await _auto_hide(pg_client, cid, await fresh_reporters(3))
    await moderator_restore(cid)
    await _auto_hide(pg_client, cid, await fresh_reporters(3))
    row = await comment_row(db_rows, cid)
    assert (row.status, row.hidden_auto, row.report_count) == (CommentStatus.HIDDEN, True, 3)
    assert len(await logs(db_rows, ModerationAction.AUTO_HIDE)) == 2


async def test_mod_12_baseline_is_the_most_recent_restore(
    target, pg_client, fresh_reporters, moderator_restore, moderator_hide, db_rows
):
    _, _, cid = target
    a, b, c, d, e, f = await fresh_reporters(6)
    await _auto_hide(pg_client, cid, [a, b, c])
    await moderator_restore(cid)
    await _auto_hide(pg_client, cid, [d, e])  # two since restore #1: visible
    assert (await comment_row(db_rows, cid)).status == CommentStatus.VISIBLE
    await moderator_hide(cid)  # a moderator hides it by hand
    await moderator_restore(cid)  # restore #2
    await report(pg_client, f, cid)  # D, E pre-date restore #2: only F counts
    row = await comment_row(db_rows, cid)
    assert (row.status, row.report_count) == (CommentStatus.VISIBLE, 1)
    assert len(await logs(db_rows, ModerationAction.RESTORE)) == 2


async def test_mod_14_manual_hide_then_restore_also_rearms(
    target, pg_client, fresh_reporters, moderator_restore, moderator_hide, db_rows
):
    _, _, cid = target
    a, b, c = await fresh_reporters(3)
    await _auto_hide(pg_client, cid, [a, b])
    await moderator_hide(cid)
    await moderator_restore(cid)
    await report(pg_client, c, cid)  # would be the third report without the baseline
    assert (await comment_row(db_rows, cid)).status == CommentStatus.VISIBLE


async def test_mod_15_mixed_pre_and_post_restore_reporters(
    target, pg_client, fresh_reporters, moderator_restore, db_rows
):
    _, _, cid = target
    a, b, x, c = await fresh_reporters(4)
    await _auto_hide(pg_client, cid, [a, b, x])  # restore is a no-op unless the comment is HIDDEN
    await moderator_restore(cid)
    await report(pg_client, c, cid)
    for who in (a, b):  # their old rows are not new reports
        await report(pg_client, who, cid)
    assert (await comment_row(db_rows, cid)).status == CommentStatus.VISIBLE


async def test_mod_13_boundary_is_strictly_after_the_restore(
    published_sermon, make_user, seed_comment, pg_client, sessions, db_rows, fresh_reporters
):
    """A report stamped exactly at the restore does not count; one microsecond
    later does. Explicit timestamps on real Postgres."""
    sid = await published_sermon()
    author = await make_user()
    t0 = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)

    async def scenario(report_offset: timedelta) -> CommentStatus:
        cid = await seed_comment(sid, author.id, f"c {report_offset}")
        old_a, old_b, newcomer = await fresh_reporters(3)
        async with sessions() as s:
            s.add(CommentModerationLog(
                comment_id=cid, action=ModerationAction.RESTORE, sermon_id=uuid.UUID(sid),
                author_id=author.id, created_at=t0,
            ))
            for who in (old_a, old_b):
                s.add(SermonCommentReport(
                    comment_id=cid, reporter_id=who.id, reason=CommentReportReason.SPAM,
                    created_at=t0 + report_offset,
                ))
            await s.commit()
        await report(pg_client, newcomer, cid)  # stamped "now", long after t0
        return (await comment_row(db_rows, cid)).status

    assert await scenario(timedelta(0)) == CommentStatus.VISIBLE            # equal: not counted
    assert await scenario(timedelta(microseconds=-1)) == CommentStatus.VISIBLE
    assert await scenario(timedelta(microseconds=1)) == CommentStatus.HIDDEN  # 2 + newcomer = 3


# ── Races ────────────────────────────────────────────────────────────────────
async def test_race_02_three_reporters_land_together(
    pg_client, published_sermon, make_user, seed_comment, db_rows, fresh_reporters
):
    sid = await published_sermon()
    author = await make_user()
    for i in range(6):
        cid = await seed_comment(sid, author.id, f"c{i}")
        rs = await asyncio.gather(*[report(pg_client, who, cid) for who in await fresh_reporters(3)])
        assert [r.status_code for r in rs] == [204, 204, 204]
        row = await comment_row(db_rows, cid)
        assert (row.status, row.hidden_auto, row.report_count) == (CommentStatus.HIDDEN, True, 3)
        assert len(await db_rows(CommentModerationLog, comment_id=cid, action=ModerationAction.AUTO_HIDE)) == 1


async def test_race_02_more_reporters_than_threshold(
    pg_client, published_sermon, make_user, seed_comment, db_rows, fresh_reporters
):
    sid = await published_sermon()
    author = await make_user()
    for i in range(4):
        cid = await seed_comment(sid, author.id, f"c{i}")
        rs = await asyncio.gather(*[report(pg_client, who, cid) for who in await fresh_reporters(5)])
        accepted = sum(r.status_code == 204 for r in rs)
        assert accepted >= 3 and all(r.status_code in (204, 404) for r in rs)
        row = await comment_row(db_rows, cid)
        assert row.status == CommentStatus.HIDDEN
        assert row.report_count == accepted == len(await db_rows(SermonCommentReport, comment_id=cid))
        assert len(await db_rows(CommentModerationLog, comment_id=cid, action=ModerationAction.AUTO_HIDE)) == 1


async def test_race_03_report_vs_restore(
    pg_client, published_sermon, make_user, seed_comment, moderator_restore, db_rows, fresh_reporters
):
    """A fourth reporter races the restore of an auto-hidden comment. Before the
    restore the comment is HIDDEN, so the report 404s; after it the report
    counts once. Either way: no 500, one restore row, VISIBLE, not hidden_auto,
    and no second auto_hide."""
    sid = await published_sermon()
    author = await make_user()
    for i in range(8):
        cid = await seed_comment(sid, author.id, f"c{i}")
        a, b, c, d = await fresh_reporters(4)
        await _auto_hide(pg_client, cid, [a, b, c])
        rep, _ = await asyncio.gather(report(pg_client, d, cid), moderator_restore(cid))
        assert rep.status_code in (204, 404)
        row = await comment_row(db_rows, cid)
        assert row.status == CommentStatus.VISIBLE and row.hidden_auto is False, i
        assert len(await db_rows(CommentModerationLog, comment_id=cid, action=ModerationAction.RESTORE)) == 1
        assert len(await db_rows(CommentModerationLog, comment_id=cid, action=ModerationAction.AUTO_HIDE)) == 1
        assert row.report_count == (1 if rep.status_code == 204 else 0)


async def _auto_hide_two(pg_client, cid, a, b):
    for who in (a, b):
        assert (await report(pg_client, who, cid)).status_code == 204


# ── Atomicity ────────────────────────────────────────────────────────────────
async def test_adm_tx_01_auto_hide_rolls_back_when_the_log_insert_fails(
    target, break_moderation_log, pg_client, fresh_reporters, db_rows
):
    _, _, cid = target
    a, b, c = await fresh_reporters(3)
    await _auto_hide_two(pg_client, cid, a, b)
    r = await report(pg_client, c, cid)  # crosses the threshold, so it must write a log row
    assert r.status_code == 500
    row = await comment_row(db_rows, cid)
    assert (row.status, row.report_count, row.hidden_auto) == (CommentStatus.VISIBLE, 2, False)
    assert len(await db_rows(SermonCommentReport)) == 2  # the third report rolled back with it
    assert await logs(db_rows, ModerationAction.AUTO_HIDE) == []
