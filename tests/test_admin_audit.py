"""`GET /api/v1/admin/audit` — the unified audit feed (plan-admin-settings
§A.5, D9, step S10).

One fixed fixture of ten rows across all four sources, at known timestamps,
then each filter is asserted to return exactly the expected rows on real
Postgres (`pg_client`). The admin's own sign-in rows are cleared before
seeding so every count below is the fixture's alone. One SQLite smoke case
proves the UNION stays dialect-neutral, since the default suite runs there.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.models import (
    Announcement,
    AnnouncementApprovalLog,
    ApprovalLog,
    AuditAction,
    AuditLog,
    AuditOutcome,
    CommentModerationLog,
    ModerationAction,
    Sermon,
    User,
    UserRole,
)

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"
T0 = datetime(2026, 10, 1, tzinfo=UTC)


def _h(hours: int) -> datetime:
    return T0 + timedelta(hours=hours)


@pytest.fixture
def sessions(pg_engine):
    return async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)


async def _headers(client, Session, email: str, role: str) -> dict:
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
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


async def _seed(Session) -> dict:
    """Ten rows, one hour apart. Returns the ids a test needs to refer to."""
    ids: dict = {}
    async with Session() as s:
        await s.execute(delete(AuditLog))  # the requester's own sign-in rows
        users = {
            name: User(email=f"{name}@example.com", role=role, password_hash=None)
            for name, role in (
                ("viewer", UserRole.VIEWER),
                ("editor", UserRole.EDITOR),
                ("manager", UserRole.MANAGER),
                ("boss", UserRole.ADMIN),
            )
        }
        s.add_all(users.values())
        await s.flush()
        sermon = Sermon(title="Grace Abounds", created_by=users["editor"].id)
        ann = Announcement(title="Harvest Sunday", body="b", created_by=users["manager"].id)
        s.add_all([sermon, ann])
        await s.flush()
        comment_id = uuid.uuid4()

        def own(action, hours, actor, *, outcome=AuditOutcome.SUCCESS, target=None, details=None):
            return AuditLog(
                action=action, outcome=outcome, created_at=_h(hours),
                actor_id=actor.id, actor_email=actor.email, actor_role=actor.role.value.lower(),
                target_type="user" if target else None,
                target_id=target.id if target else None,
                target_label=target.email if target else None,
                ip="203.0.113.7", user_agent="UA", details=details or {},
            )

        def mod(action, hours, actor, reason=None):
            return CommentModerationLog(
                comment_id=comment_id, actor_id=actor.id if actor else None,
                action=action, reason=reason, sermon_id=sermon.id,
                author_id=users["viewer"].id,
                # Snapshots exist only on hard deletes (CHECK constraint).
                body_snapshot="the moderated body" if action == ModerationAction.HARD_DELETE else None,
                created_at=_h(hours),
            )

        rows = {
            "A1": own(AuditAction.LOGIN, 1, users["viewer"], details={"method": "password"}),
            "A2": own(AuditAction.LOGIN, 2, users["boss"], details={"method": "google"}),
            "A3": own(
                AuditAction.LOGIN_FAILED, 3, users["boss"], outcome=AuditOutcome.FAILURE,
                details={"method": "password", "reason": "bad_password"},
            ),
            "A4": own(
                AuditAction.ROLE_CHANGED, 4, users["boss"], target=users["editor"],
                details={"from": "viewer", "to": "editor"},
            ),
            "L1": ApprovalLog(
                sermon_id=sermon.id, from_status="draft", to_status="pending_review",
                actor_id=users["editor"].id, created_at=_h(5),
            ),
            "L2": AnnouncementApprovalLog(
                announcement_id=ann.id, from_status="pending_review", to_status="published",
                actor_id=users["manager"].id, note="lgtm", created_at=_h(6),
            ),
            "L3": mod(ModerationAction.HIDE, 7, users["manager"], reason="spam"),
            "L4": mod(ModerationAction.SELF_DELETE, 8, users["viewer"]),
            "L5": mod(ModerationAction.AUTO_HIDE, 9, None),
            # Actor erased since (FK SET NULL) — not the system.
            "L6": mod(ModerationAction.HARD_DELETE, 10, None, reason="abuse"),
        }
        s.add_all(rows.values())
        await s.commit()
        ids.update({k: v.id for k, v in rows.items()})
        ids.update({f"user:{k}": v.id for k, v in users.items()})
        ids["sermon"] = sermon.id
    return ids


async def _get(client, headers, **params):
    r = await client.get("/api/v1/admin/audit", params=params, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _ids(body, ids) -> list[str]:
    by_id = {str(v): k for k, v in ids.items() if not str(k).startswith(("user:", "sermon"))}
    return [by_id[item["id"]] for item in body["items"]]


@pytest.fixture
async def feed(pg_client, sessions):
    admin = await _headers(pg_client, sessions, "admin@example.com", "admin")
    ids = await _seed(sessions)
    return pg_client, admin, ids


# ── defaults, staff_only, paging ────────────────────────────────────────────


async def test_default_is_staff_only_newest_first(feed):
    client, admin, ids = feed
    body = await _get(client, admin)
    assert _ids(body, ids) == ["L6", "L5", "L3", "L2", "L1", "A4", "A3", "A2"]
    assert body["total"] == 8


async def test_staff_only_false_includes_viewer_actions(feed):
    client, admin, ids = feed
    body = await _get(client, admin, staff_only="false")
    assert body["total"] == 10
    assert {"A1", "L4"} <= set(_ids(body, ids))


async def test_paging_slices_and_total_is_the_filtered_count(feed):
    client, admin, ids = feed
    body = await _get(client, admin, limit=3, offset=3)
    assert _ids(body, ids) == ["L2", "L1", "A4"]
    assert (body["total"], body["limit"], body["offset"]) == (8, 3, 3)


# ── filters ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("category", "expected"),
    [
        ("auth", ["A3", "A2"]),
        ("users", ["A4"]),
        ("sermons", ["L1"]),
        ("announcements", ["L2"]),
        ("moderation", ["L6", "L5", "L3"]),
        ("settings", []),
        ("reports", []),
    ],
)
async def test_category_filter(feed, category, expected):
    client, admin, ids = feed
    body = await _get(client, admin, category=category)
    assert _ids(body, ids) == expected
    assert body["total"] == len(expected)


async def test_actor_filter_spans_sources(feed):
    client, admin, ids = feed
    body = await _get(client, admin, actor_id=str(ids["user:manager"]))
    assert _ids(body, ids) == ["L3", "L2"]


async def test_target_filters(feed):
    client, admin, ids = feed
    sermon = await _get(client, admin, target_type="sermon", target_id=str(ids["sermon"]))
    assert _ids(sermon, ids) == ["L1"]
    user = await _get(client, admin, target_type="user", target_id=str(ids["user:editor"]))
    assert _ids(user, ids) == ["A4"]


async def test_outcome_filter(feed):
    client, admin, ids = feed
    assert _ids(await _get(client, admin, outcome="failure"), ids) == ["A3"]
    success = _ids(await _get(client, admin, outcome="success"), ids)
    assert "A3" not in success and len(success) == 7


async def test_date_range_is_half_open(feed):
    client, admin, ids = feed
    body = await _get(client, admin, **{"from": _h(3).isoformat(), "to": _h(5).isoformat()})
    assert _ids(body, ids) == ["A4", "A3"]  # L1 sits exactly on `to`


async def test_action_filter_is_repeatable(feed):
    client, admin, ids = feed
    r = await client.get(
        "/api/v1/admin/audit?action=auth.login&action=comment.hide", headers=admin
    )
    assert _ids(r.json(), ids) == ["L3", "A2"]


async def test_unknown_category_is_422(feed):
    client, admin, _ = feed
    r = await client.get("/api/v1/admin/audit?category=billing", headers=admin)
    assert r.status_code == 422


# ── row shape ───────────────────────────────────────────────────────────────


async def test_legacy_rows_are_normalised(feed):
    client, admin, ids = feed
    items = {i["id"]: i for i in (await _get(client, admin, staff_only="false"))["items"]}

    l1 = items[str(ids["L1"])]
    assert l1["source"] == "approval_log"
    assert l1["action"] == "sermon.status_changed"
    assert l1["outcome"] == "success"
    assert l1["actor_label"] == "editor@example.com"
    assert l1["actor_role"] == "editor"
    assert l1["target_label"] == "Grace Abounds"
    assert l1["details"] == {"from": "draft", "to": "pending_review"}
    assert l1["ip"] is None and l1["user_agent"] is None
    assert l1["summary"] == (
        'editor@example.com moved sermon "Grace Abounds" from draft to pending_review'
    )

    l2 = items[str(ids["L2"])]
    assert l2["details"] == {"from": "pending_review", "to": "published", "note": "lgtm"}

    l3 = items[str(ids["L3"])]
    assert l3["action"] == "comment.hide"
    assert l3["details"] == {"sermon_id": str(ids["sermon"]), "reason": "spam"}
    assert l3["summary"] == "manager@example.com hid a comment"

    l6 = items[str(ids["L6"])]
    assert l6["action"] == "comment.hard_delete"
    # The moderated body is never copied into the feed.
    assert "the moderated body" not in str(l6)

    assert items[str(ids["L5"])]["actor_label"] == "System"
    assert items[str(ids["L6"])]["actor_label"] == "Deleted account"


async def test_audit_log_rows_keep_their_snapshot_and_network_fields(feed):
    client, admin, ids = feed
    items = {i["id"]: i for i in (await _get(client, admin))["items"]}
    a4 = items[str(ids["A4"])]
    assert a4["source"] == "audit_log"
    assert a4["actor_label"] == "boss@example.com"
    assert a4["actor_role"] == "admin"
    assert a4["ip"] == "203.0.113.7"
    assert a4["details"] == {"from": "viewer", "to": "editor"}
    assert a4["summary"] == (
        "boss@example.com changed editor@example.com's role from viewer to editor"
    )
    assert items[str(ids["A3"])]["summary"] == (
        "Failed sign-in for boss@example.com (wrong password)"
    )


# ── authz ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("role", ["manager", "editor", "viewer"])
async def test_non_admin_is_forbidden(pg_client, sessions, role):
    headers = await _headers(pg_client, sessions, f"{role}.caller@example.com", role)
    r = await pg_client.get("/api/v1/admin/audit", headers=headers)
    assert r.status_code == 403


async def test_anonymous_is_unauthorised(pg_client):
    r = await pg_client.get("/api/v1/admin/audit")
    assert r.status_code == 401


# ── SQLite smoke ────────────────────────────────────────────────────────────


async def test_feed_runs_on_sqlite(client, engine):
    """The default suite's dialect: the UNION, casts and filters must all
    compile and run there too."""
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    admin = await _headers(client, Session, "admin@example.com", "admin")
    ids = await _seed(Session)
    r = await client.get(
        "/api/v1/admin/audit",
        params={"category": "moderation", "staff_only": "false"},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    assert _ids(r.json(), ids) == ["L6", "L5", "L4", "L3"]
