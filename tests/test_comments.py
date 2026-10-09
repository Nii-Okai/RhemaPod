"""Viewer comments API (plan S6): rules, DTO safety, gates, limits, logs, races.

Real Postgres (alembic-built schema) and, where behaviour depends on it, real
Redis, both via Testcontainers (`tests/comments_pg.py`). No ORM or session
mocking: `monkeypatch` is used only for settings, Redis wiring and fault
injection at service seams.

Case ids (U-*, C-*, AU-*, RL-*, NL-*, RACE-*, PAR-*) follow the S1 matrix in
status.md. Auto-hide and re-arm cases live in `test_comment_moderation.py`.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event, select, text

from app.core import text_safety
from app.core.text_safety import (
    BLOCKED_TERMS,
    contains_blocked_term,
    contains_url,
    has_visible_text,
    normalise_text,
)
from app.models.models import (
    CommentModerationLog,
    CommentStatus,
    ModerationAction,
    SermonComment,
    SermonCommentReport,
    SermonStatus,
    Subscription,
    SubscriptionStatus,
    SubscriptionTier,
    User,
    UserBlock,
)
from app.services import comments_service
from app.services.content_service import display_name, public_display_name
from tests.comments_pg import (  # noqa: F401
    break_moderation_log,
    capture_logs,
    db_rows,
    make_user,
    pg_client,
    pg_client_primary_only,
    pg_engine,
    pg_migrated_db,
    pg_server,
    published_sermon,
    real_redis,
    redis_server,
    seed_comment,
    sessions,
)

API = "/api/v1"
ALLOWED_KEYS = {
    "id", "sermon_id", "author_display_name", "body", "created_at",
    "is_mine", "status", "hidden_label",
}
FORBIDDEN_KEY_PARTS = (
    "user_id", "email", "role", "author_id", "reporter", "hidden_by",
    "report_count", "hidden_reason", "hidden_auto",
)


# ── helpers ──────────────────────────────────────────────────────────────────
async def post(client, user, sid, body):
    return await client.post(f"{API}/sermons/{sid}/comments", json={"body": body}, headers=user.headers)


async def listing(client, user, sid, **params):
    return await client.get(f"{API}/sermons/{sid}/comments", params=params, headers=user.headers)


async def report(client, user, cid, reason="spam", **extra):
    return await client.post(
        f"{API}/comments/{cid}/report", json={"reason": reason, **extra}, headers=user.headers
    )


async def block(client, user, cid):
    return await client.post(f"{API}/comments/{cid}/block", headers=user.headers)


def shape(resp):
    """Status + body minus the per-request correlation id: what "identical"
    means for the uniform-404 cases."""
    body = resp.json() if resp.content else None
    if isinstance(body, dict):
        body = {k: v for k, v in body.items() if k != "correlation_id"}
    return resp.status_code, body


def all_keys(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from all_keys(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from all_keys(v)


def assert_no_leak_keys(payload):
    for key in all_keys(payload):
        assert not any(part in key.lower() for part in FORBIDDEN_KEY_PARTS), key


async def subscribe(sessions, user, valid_until=None, status=SubscriptionStatus.ACTIVE):
    async with sessions() as s:
        s.add(Subscription(
            user_id=user.id, tier=SubscriptionTier.MONTHLY, status=status,
            valid_until=valid_until or datetime.now(timezone.utc) + timedelta(days=30),
        ))
        await s.commit()


def _sentinel() -> str:
    """Unique marker with no digits: a digit-bearing uuid in a comment body can
    legitimately trip the phone-number rule (SF-1) and flake the test."""
    return "SENTINEL-" + uuid.uuid4().hex.translate(str.maketrans("0123456789", "ghijklmnop"))


# ═════════════════════════════════════════════════════════════════════════════
# Pure units
# ═════════════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize("ws", [" ", "\t", " ", " ", "　", "\n"])
def test_u_norm_01_trims_unicode_whitespace(ws):
    assert normalise_text(f"{ws}{ws}hello{ws}") == "hello"


def test_u_norm_02_strips_controls_and_bidi():
    dirty = "a\x00b\x07c\x7fd\x85e‮f⁦g‎h‏i؜j"
    assert normalise_text(dirty) == "abcdefghij"
    assert normalise_text("‮P‬astor") == "Pastor"


def test_u_norm_03_zero_width_policy():
    # ZWSP / word-joiner / BOM carry no text: stripped. ZWJ and ZWNJ are kept
    # (emoji sequences, Persian/Indic text) and neutralised only for matching.
    assert normalise_text("a​b⁠c﻿d") == "abcd"
    family = "\U0001f468‍\U0001f469‍\U0001f467"
    assert normalise_text(family) == family
    assert not has_visible_text("‍ ‌")


def test_u_norm_04_normalise_before_length():
    assert normalise_text("   " + "a" * 1000 + "  \n") == "a" * 1000
    for empty in ("   ", "‮‬", "\x00\x01", "​​"):
        assert normalise_text(empty) == ""


def test_u_norm_05_counts_code_points():
    assert len(normalise_text("\U0001f600" * 1000)) == 1000
    assert len(normalise_text("\U0001f600" * 1001)) == 1001
    assert len(normalise_text("é" * 3)) == 3  # NFC composes e + acute


def test_u_norm_06_idempotent():
    corpus = [
        "  hi\r\nthere\r\n\r\n\r\n\r\nfriend \t", "‮abc​", "a\n \n \n \nb",
        "é́", "x" * 50, "\n\n\nz\n\n\n", "tab\there",
    ]
    for text_in in corpus:
        once = normalise_text(text_in)
        assert normalise_text(once) == once
        single = normalise_text(text_in, multiline=False)
        assert normalise_text(single, multiline=False) == single


def test_u_norm_newlines_policy():
    assert normalise_text("a\r\nb") == "a\nb"
    assert normalise_text("a b") == "a\nb"
    assert normalise_text("a\n\n\n\n\nb") == "a\n\nb"
    assert normalise_text("a\n  b  \n", multiline=True) == "a\n  b"
    assert normalise_text("Nii \n  Okai", multiline=False) == "Nii Okai"


def test_u_norm_08_nfc_and_nfd_store_the_same():
    assert normalise_text("café") == normalise_text("café")


@pytest.mark.parametrize("candidate", [
    "http://x.com", "https://x.com/a?b=1", "HTTP://X.COM", "www.example.com",
    "example.com", "foo.co.uk", "bit.ly/abc", "visit example.com now",
    "end with example.org", "example.com starts", "a@b.com",
    "example。com", "example．com", "exam​ple.com",
    "ｅｘａｍｐｌｅ.com",
])
def test_u_url_01_rejected(candidate):
    assert contains_url(candidate)


@pytest.mark.parametrize("candidate", [
    "John 3.16", "Rom 8.28-39", "1 Cor. 13", "Ps. 23", "v.5", "3.5 hours",
    "e.g. this", "i.e. that", "wait...what", "...", "Amen.Thank you",
    "Mr.Smith said", "exampleDOTcom", "Great message!",
])
def test_u_url_03_scripture_and_prose_accepted(candidate):
    assert not contains_url(candidate)


def test_u_url_02_spaced_dot_host_is_rejected_since_s11c():
    # Was a pinned residual through S11b; S11c (R-1) closes it. Sentence-final
    # periods still pass (see tests/test_comment_hardening.py, R-1 prose cases).
    assert contains_url("example . com")
    assert not contains_url("Amen. Church is at nine.")


def test_u_bl_01_loaded_once_and_normalised():
    assert BLOCKED_TERMS and all(t == t.lower() and t == t.strip() for t in BLOCKED_TERMS)
    assert text_safety._load_blocklist() == BLOCKED_TERMS  # file content is the source


def test_u_bl_02_case_folded_whole_word():
    word = sorted(t for t in BLOCKED_TERMS if " " not in t and len(t) >= 4)[0]
    for variant in (word.upper(), word.title(), f"{word}!", f"({word})", f"hey {word} you"):
        assert contains_blocked_term(variant), variant
    # Scunthorpe: seeded words inside larger benign words never fire.
    assert not contains_blocked_term(f"un{word}able")
    assert not contains_blocked_term(f"{word}ology")
    assert not contains_blocked_term("Shitake mushrooms and the class assignment")
    assert contains_blocked_term("kill yourself")  # phrases supported


def test_u_bl_03_runs_on_normalised_text():
    word = sorted(t for t in BLOCKED_TERMS if " " not in t and len(t) >= 4)[0]
    spoofed = word[:2] + "​‮" + word[2:]
    assert contains_blocked_term(spoofed)
    assert contains_blocked_term(normalise_text(spoofed))


def test_u_bl_04_fold_variants_pinned():
    word = sorted(t for t in BLOCKED_TERMS if " " not in t and len(t) >= 4)[0]
    assert contains_blocked_term("".join(chr(ord(c) + 0xFEE0) for c in word))  # fullwidth: NFKC
    assert contains_blocked_term(word[0] + "́" + word[1:])  # stray accent stripped
    assert not contains_blocked_term(" ".join(word))  # spaced letters: residual
    assert not contains_blocked_term(word.replace(word[1], "1", 1))  # leetspeak: residual


@pytest.mark.parametrize("full,expected", [
    ("Nii Okai", "Nii O."),
    ("Nii Kwame Okai", "Nii O."),
    ("Nii", "Nii"),
    ("  Nii   Okai  ", "Nii O."),
    ("nii okai", "nii o."),
    ("Éloïse Ñoño", "Éloïse Ñ."),
    ("Mary-Jane O'Neil", "Mary-Jane O."),
    ("Li 王", "Li 王."),
    ("", None), ("   ", None), (None, None),
])
def test_u_name_01_public_name(full, expected):
    assert public_display_name(full) == expected


def test_u_name_02_display_name_unchanged_and_email_never_read():
    assert display_name("  Nii Okai ") == "Nii Okai"
    assert display_name("  ") is None
    assert public_display_name.__code__.co_varnames[:1] == ("full_name",)


# ═════════════════════════════════════════════════════════════════════════════
# Auth, DTO shape
# ═════════════════════════════════════════════════════════════════════════════
async def test_c_auth_01_every_route_requires_a_token(pg_client, published_sermon):
    sid, cid = await published_sermon(), uuid.uuid4()
    routes = [
        ("GET", f"/sermons/{sid}/comments", None),
        ("POST", f"/sermons/{sid}/comments", {"body": "x"}),
        ("DELETE", f"/comments/{cid}", None),
        ("POST", f"/comments/{cid}/report", {"reason": "spam"}),
        ("POST", f"/comments/{cid}/block", None),
        ("GET", "/me/blocks", None),
        ("DELETE", f"/me/blocks/{cid}", None),
        ("POST", "/me/comments-terms", None),
        ("PATCH", "/auth/me", {"full_name": "A B"}),
    ]
    for method, path, body in routes:
        r = await pg_client.request(method, API + path, json=body)
        assert r.status_code in (401, 403), (method, path, r.status_code)  # HTTPBearer: 401/403
        bad = await pg_client.request(
            method, API + path, json=body, headers={"Authorization": "Bearer not.a.jwt"}
        )
        assert bad.status_code == 401, (method, path)


async def test_c_auth_02_inactive_user_rejected(pg_client, make_user, published_sermon):
    sid = await published_sermon()
    ghost = await make_user(active=False)
    assert (await listing(pg_client, ghost, sid)).status_code == 401
    assert (await post(pg_client, ghost, sid, "hi")).status_code == 401
    assert (await pg_client.patch(f"{API}/auth/me", json={"full_name": "A B"}, headers=ghost.headers)).status_code == 401


async def test_c_dto_01_key_allow_list(pg_client, make_user, published_sermon, seed_comment):
    sid = await published_sermon()
    me, other = await make_user(full_name="Ada Lovelace"), await make_user(full_name="Bob Ross")
    await seed_comment(sid, other.id, "from bob")
    own_hidden = await seed_comment(sid, me.id, "mine hidden", status=CommentStatus.HIDDEN, hidden_auto=True)
    created = await post(pg_client, me, sid, "fresh one")
    assert created.status_code == 201

    page = (await listing(pg_client, me, sid)).json()
    assert page["total"] == 3
    for item in page["items"]:
        assert set(item) == ALLOWED_KEYS
    assert set(created.json()) == ALLOWED_KEYS
    for payload in (page, created.json()):
        assert_no_leak_keys(payload)
    hidden_row = next(i for i in page["items"] if i["id"] == str(own_hidden))
    assert set(hidden_row) == ALLOWED_KEYS


async def test_c_dto_02_no_value_leaks(pg_client, make_user, published_sermon, seed_comment):
    sid = await published_sermon()
    author = await make_user(role="editor", full_name="Grace Hopper")
    viewer = await make_user()
    cid = await seed_comment(sid, author.id, "an editor comment")
    await block(pg_client, viewer, cid)
    blob = json.dumps([
        (await listing(pg_client, viewer, sid)).json(),
        (await pg_client.get(f"{API}/me/blocks", headers=viewer.headers)).json(),
    ])
    assert author.email.split("@")[0] not in blob
    assert str(author.id) not in blob
    assert "EDITOR" not in blob.upper().replace("EDITOR COMMENT", "")


async def test_c_dto_03_block_public_keys(pg_client, make_user, published_sermon, seed_comment):
    sid = await published_sermon()
    author, viewer = await make_user(full_name="Ada Lovelace"), await make_user()
    cid = await seed_comment(sid, author.id)
    created = await block(pg_client, viewer, cid)
    rows = (await pg_client.get(f"{API}/me/blocks", headers=viewer.headers)).json()
    assert len(rows) == 1 and set(rows[0]) == {"id", "display_name", "created_at"}
    assert rows[0]["display_name"] == "Ada L."
    assert rows[0]["id"] != str(author.id)
    assert created.json()["id"] == rows[0]["id"]


async def test_c_dto_04_error_bodies_carry_no_identity(pg_client, make_user, published_sermon, seed_comment):
    sid = await published_sermon()
    author, viewer = await make_user(role="manager"), await make_user(terms=False)
    cid = await seed_comment(sid, author.id)
    responses = [
        await pg_client.delete(f"{API}/comments/{cid}", headers=viewer.headers),      # 404
        await post(pg_client, viewer, sid, "hi"),                                       # 403
        await post(pg_client, await make_user(), sid, "http://x.com"),                  # 422
        await listing(pg_client, viewer, str(uuid.uuid4())),                            # 404
    ]
    assert [r.status_code for r in responses] == [404, 403, 422, 404]
    blob = " ".join(r.text for r in responses)
    for needle in (author.email, str(author.id), "MANAGER", "manager"):
        assert needle not in blob


# ═════════════════════════════════════════════════════════════════════════════
# List
# ═════════════════════════════════════════════════════════════════════════════
async def test_c_list_01_recent_first_stable_pages(pg_client, make_user, published_sermon, seed_comment):
    sid = await published_sermon()
    u = await make_user()
    tie = datetime(2026, 1, 1, tzinfo=timezone.utc)
    ids = [await seed_comment(sid, u.id, f"c{i}", created_at=tie) for i in range(5)]
    newer = await seed_comment(sid, u.id, "newest", created_at=tie + timedelta(hours=1))
    seen = []
    for offset in (0, 2, 4):
        seen += [i["id"] for i in (await listing(pg_client, u, sid, limit=2, offset=offset)).json()["items"]]
    assert seen[0] == str(newer)
    assert len(seen) == len(set(seen)) == 6
    assert seen[1:] == [str(i) for i in sorted(ids)]  # identical timestamps: id tiebreak


async def test_c_list_02_pagination_envelope(pg_client, make_user, published_sermon, seed_comment):
    sid = await published_sermon()
    u = await make_user()
    for i in range(3):
        await seed_comment(sid, u.id, f"c{i}")
    page = (await listing(pg_client, u, sid, limit=2, offset=0)).json()
    assert (page["total"], page["limit"], page["offset"], len(page["items"])) == (3, 2, 0, 2)
    past = (await listing(pg_client, u, sid, limit=2, offset=10)).json()
    assert past["items"] == [] and past["total"] == 3
    assert (await listing(pg_client, u, sid, limit=0)).status_code == 422
    assert (await listing(pg_client, u, sid, limit=101)).status_code == 422
    assert (await listing(pg_client, u, sid, limit=100)).status_code == 200
    assert (await listing(pg_client, u, sid, offset=-1)).status_code == 422


async def test_c_list_03_new_post_between_pages_is_safe(pg_client, make_user, published_sermon, seed_comment):
    sid = await published_sermon()
    u = await make_user()
    for i in range(4):
        await seed_comment(sid, u.id, f"c{i}")
    first = (await listing(pg_client, u, sid, limit=2)).json()
    assert (await post(pg_client, u, sid, "arrives mid-scroll")).status_code == 201
    second = await listing(pg_client, u, sid, limit=2, offset=2)
    assert second.status_code == 200
    ids = {i["id"] for i in first["items"]} | {i["id"] for i in second.json()["items"]}
    assert len(ids) >= 3  # an item may repeat across pages (client dedupes by id), never errors


async def test_c_list_04_05_09_visibility_labels_and_is_mine(pg_client, make_user, published_sermon, seed_comment):
    sid = await published_sermon()
    me, other = await make_user(full_name="Ada Lovelace"), await make_user(full_name="Bob Ross")
    await seed_comment(sid, other.id, "visible other")
    await seed_comment(sid, other.id, "hidden other", status=CommentStatus.HIDDEN)
    auto = await seed_comment(sid, me.id, "auto hidden", status=CommentStatus.HIDDEN, hidden_auto=True)
    manual = await seed_comment(sid, me.id, "manual hidden", status=CommentStatus.HIDDEN)
    own = await seed_comment(sid, me.id, "own visible")
    page = (await listing(pg_client, me, sid)).json()
    by_id = {i["id"]: i for i in page["items"]}
    assert page["total"] == 4 and len(by_id) == 4  # others' HIDDEN excluded from items and total
    assert by_id[str(auto)]["status"] == "HIDDEN" and by_id[str(auto)]["hidden_label"] == "under_review"
    assert by_id[str(manual)]["hidden_label"] == "removed_by_moderator"
    assert by_id[str(own)]["hidden_label"] is None and by_id[str(own)]["status"] == "VISIBLE"
    for item in page["items"]:
        assert item["is_mine"] == (item["author_display_name"] == "Ada L.")
        if not item["is_mine"]:
            assert item["hidden_label"] is None and item["author_display_name"] == "Bob R."


async def test_c_list_06_07_08_block_filter_total_and_unblock(pg_client, make_user, published_sermon, seed_comment):
    sid = await published_sermon()
    me, pest, friend = await make_user(), await make_user(full_name="Pest One"), await make_user(full_name="Friend Two")
    other_viewer = await make_user()
    pest_c = await seed_comment(sid, pest.id, "pest says hi")
    await seed_comment(sid, pest.id, "pest again")
    await seed_comment(sid, friend.id, "friend")
    await seed_comment(sid, friend.id, "friend hidden", status=CommentStatus.HIDDEN)
    await seed_comment(sid, me.id, "mine")
    await seed_comment(sid, me.id, "mine hidden", status=CommentStatus.HIDDEN)

    blocked = await block(pg_client, me, pest_c)
    assert blocked.status_code == 200
    page = (await listing(pg_client, me, sid, limit=100)).json()
    bodies = {i["body"] for i in page["items"]}
    assert bodies == {"friend", "mine", "mine hidden"} and page["total"] == 3
    paged = []
    for off in (0, 2):
        paged += (await listing(pg_client, me, sid, limit=2, offset=off)).json()["items"]
    assert len(paged) == page["total"]
    # Per-viewer and one-way.
    assert (await listing(pg_client, other_viewer, sid)).json()["total"] == 4
    assert "mine" in {i["body"] for i in (await listing(pg_client, pest, sid)).json()["items"]}
    # Unblock restores them.
    assert (await pg_client.delete(f"{API}/me/blocks/{blocked.json()['id']}", headers=me.headers)).status_code == 204
    assert (await listing(pg_client, me, sid)).json()["total"] == 5


async def test_c_list_10_reads_from_primary(pg_client_primary_only, make_user, published_sermon):
    sid = await published_sermon()
    u = await make_user()
    assert (await listing(pg_client_primary_only, u, sid)).status_code == 200
    assert (await post(pg_client_primary_only, u, sid, "primary only")).status_code == 201


async def test_c_list_11_deactivated_author_stays_visible(pg_client, make_user, published_sermon, seed_comment, sessions):
    sid = await published_sermon()
    author, viewer = await make_user(full_name="Gone Away"), await make_user()
    await seed_comment(sid, author.id, "still here")
    async with sessions() as s:
        (await s.get(User, author.id)).is_active = False
        await s.commit()
    page = (await listing(pg_client, viewer, sid)).json()
    assert [i["body"] for i in page["items"]] == ["still here"]


async def test_c_list_12_query_count_is_constant(pg_client, pg_engine, make_user, published_sermon, seed_comment):
    sid = await published_sermon()
    viewer = await make_user()
    statements: list[str] = []

    def count(conn, cursor, statement, *a):
        statements.append(statement)

    event.listen(pg_engine.sync_engine, "before_cursor_execute", count)
    try:
        async def measure():
            statements.clear()
            r = await listing(pg_client, viewer, sid, limit=100)
            assert r.status_code == 200
            return len(statements), len(r.json()["items"])

        authors = [await make_user() for _ in range(5)]
        for a in authors:
            await seed_comment(sid, a.id)
        n_small, rows_small = await measure()
        for i in range(45):
            await seed_comment(sid, authors[i % 5].id, f"c{i}")
        n_big, rows_big = await measure()
    finally:
        event.remove(pg_engine.sync_engine, "before_cursor_execute", count)
    assert (rows_small, rows_big) == (5, 50)
    assert n_small == n_big


async def test_c_list_13_empty(pg_client, make_user, published_sermon):
    page = (await listing(pg_client, await make_user(), await published_sermon())).json()
    assert page["items"] == [] and page["total"] == 0


# ═════════════════════════════════════════════════════════════════════════════
# Sermon gate and entitlement
# ═════════════════════════════════════════════════════════════════════════════
async def test_c_gate_01_02_03_uniform_404(pg_client, make_user, published_sermon):
    u = await make_user()
    now = datetime.now(timezone.utc)
    missing = str(uuid.uuid4())
    cases = {
        "draft": await published_sermon(status=SermonStatus.DRAFT),
        "under_review": await published_sermon(status=SermonStatus.UNDER_REVIEW),
        "unpublished": await published_sermon(status=SermonStatus.UNPUBLISHED),
        "future": await published_sermon(publish_at=now + timedelta(hours=1)),
    }
    for name, sid in cases.items():
        for call in (lambda s=sid: listing(pg_client, u, s), lambda s=sid: post(pg_client, u, s, "hello")):
            r = await call()
            assert r.status_code == 404, name
            assert r.json()["detail"] == "Sermon not found"
    assert (await listing(pg_client, u, missing)).status_code == 404
    assert (await post(pg_client, u, missing, "hello")).status_code == 404
    # publish_at boundary: just passed is visible.
    just_past = await published_sermon(publish_at=now - timedelta(seconds=1))
    assert (await listing(pg_client, u, just_past)).status_code == 200


async def test_c_gate_05_paid_sermon_needs_playback_entitlement(
    pg_client, make_user, published_sermon, seed_comment, sessions
):
    sid = await published_sermon(paid=True)
    free, subscribed, staff = await make_user(), await make_user(), await make_user(role="editor")
    author = await make_user()
    cid = await seed_comment(sid, author.id, "paid comment")
    await subscribe(sessions, subscribed)

    playback = await pg_client.get(f"{API}/sermons/{sid}/stream", headers=free.headers)
    assert playback.status_code == 403
    # List and post on the sermon keep 403 upgrade_required (its existence is public).
    for denied in (
        await listing(pg_client, free, sid),
        await post(pg_client, free, sid, "hello"),
    ):
        assert (denied.status_code, denied.json()["detail"]) == (403, playback.json()["detail"])
    # SF-6: by-comment-id paths answer exactly like an unknown id.
    unknown = uuid.uuid4()
    for denied, probe in (
        (await report(pg_client, free, cid), await report(pg_client, free, unknown)),
        (await block(pg_client, free, cid), await block(pg_client, free, unknown)),
    ):
        assert (denied.status_code, denied.json()["detail"]) == (404, "Comment not found")
        assert (probe.status_code, probe.json()["detail"]) == (denied.status_code, denied.json()["detail"])
    assert (await listing(pg_client, subscribed, sid)).status_code == 200
    assert (await post(pg_client, subscribed, sid, "thanks")).status_code == 201
    assert (await listing(pg_client, staff, sid)).status_code == 200  # staff exemption, as playback


async def test_c_gate_06_lapsed_entitlement_denies_but_keeps_comments(
    pg_client, make_user, published_sermon, sessions, db_rows
):
    from tests.conftest import _fake

    sid = await published_sermon(paid=True)
    u = await make_user()
    await subscribe(sessions, u)
    assert (await post(pg_client, u, sid, "while subscribed")).status_code == 201
    async with sessions() as s:
        sub = (await s.execute(select(Subscription).where(Subscription.user_id == u.id))).scalar_one()
        sub.status = SubscriptionStatus.EXPIRED
        await s.commit()
    _fake.store.clear()  # entitlement cache
    assert (await listing(pg_client, u, sid)).status_code == 403
    assert len(await db_rows(SermonComment, user_id=u.id)) == 1


async def test_c_gate_07_unpublished_hides_reads_but_author_can_still_delete(
    pg_client, make_user, published_sermon, sessions, db_rows
):
    sid = await published_sermon()
    u = await make_user()
    cid = (await post(pg_client, u, sid, "I said this")).json()["id"]
    async with sessions() as s:
        from app.models.models import Sermon
        (await s.get(Sermon, uuid.UUID(sid))).status = SermonStatus.UNPUBLISHED
        await s.commit()
    assert (await listing(pg_client, u, sid)).status_code == 404
    assert (await pg_client.delete(f"{API}/comments/{cid}", headers=u.headers)).status_code == 204
    assert await db_rows(SermonComment, user_id=u.id) == []


# ═════════════════════════════════════════════════════════════════════════════
# Post
# ═════════════════════════════════════════════════════════════════════════════
async def test_c_post_01_happy_path(pg_client, make_user, published_sermon, db_rows):
    sid = await published_sermon()
    u = await make_user(full_name="Nii Kwame Okai")
    r = await post(pg_client, u, sid, "  Great word today.  ")
    assert r.status_code == 201
    body = r.json()
    assert body["is_mine"] is True and body["status"] == "VISIBLE" and body["hidden_label"] is None
    assert body["author_display_name"] == "Nii O." and body["body"] == "Great word today."
    (row,) = await db_rows(SermonComment, user_id=u.id)
    assert (row.body, row.report_count, row.hidden_auto, str(row.sermon_id)) == ("Great word today.", 0, False, sid)


@pytest.mark.parametrize("extra", [
    {"sermon_id": str(uuid.uuid4())}, {"user_id": str(uuid.uuid4())},
    {"status": "HIDDEN"}, {"author_display_name": "Pastor"},
])
async def test_c_post_02_only_body_is_accepted(pg_client, make_user, published_sermon, db_rows, extra):
    sid = await published_sermon()
    u = await make_user()
    r = await pg_client.post(
        f"{API}/sermons/{sid}/comments", json={"body": "hi", **extra}, headers=u.headers
    )
    assert r.status_code == 422
    assert await db_rows(SermonComment) == []


@pytest.mark.parametrize("name", [None, "", "   "])
async def test_c_post_03_name_required(pg_client, make_user, published_sermon, db_rows, name):
    sid = await published_sermon()
    u = await make_user(full_name=name)
    r = await post(pg_client, u, sid, "hello")
    assert r.status_code == 403
    assert await db_rows(SermonComment) == []


async def test_c_post_04_terms_gate_then_accept(pg_client, make_user, published_sermon):
    sid = await published_sermon()
    u = await make_user(terms=False)
    assert (await post(pg_client, u, sid, "hello")).status_code == 403
    assert (await pg_client.post(f"{API}/me/comments-terms", headers=u.headers)).status_code == 204
    assert (await post(pg_client, u, sid, "hello")).status_code == 201
    both_missing = await make_user(terms=False, full_name=None)
    assert (await post(pg_client, both_missing, sid, "hello")).status_code == 403


async def test_c_post_05_precedence(pg_client, make_user, published_sermon):
    """401 > 404 (sermon) > 403 (prerequisites) > 422 (content)."""
    sid = await published_sermon()
    unready = await make_user(full_name=None, terms=False)
    ready = await make_user()
    assert (await pg_client.post(f"{API}/sermons/{sid}/comments", json={"body": "hi"})).status_code in (401, 403)
    assert (await post(pg_client, unready, str(uuid.uuid4()), "http://bad.com")).status_code == 404
    assert (await post(pg_client, unready, sid, "http://bad.com")).status_code == 403
    assert (await post(pg_client, ready, sid, "http://bad.com")).status_code == 422


@pytest.mark.parametrize("body", [
    "", "   ", "‮‬", "x" * 1001, "see https://example.com", "see www.example.com",
    "see example.com", "fuck this", "\U0001f600" * 1001,
])
async def test_c_post_06_07_rejected_bodies_not_echoed(pg_client, make_user, published_sermon, db_rows, body):
    sid = await published_sermon()
    u = await make_user()
    r = await post(pg_client, u, sid, body)
    assert r.status_code == 422
    if len(body) < 60 and body.strip():
        assert body not in r.text  # URL / blocklist hits are never echoed back
    assert await db_rows(SermonComment) == []


@pytest.mark.parametrize("payload", [{"body": 5}, {}, {"body": None}])
async def test_c_post_06_structural_422(pg_client, make_user, published_sermon, payload):
    sid = await published_sermon()
    r = await pg_client.post(f"{API}/sermons/{sid}/comments", json=payload, headers=(await make_user()).headers)
    assert r.status_code == 422


@pytest.mark.parametrize("body", [
    "a", "x" * 1000, "\U0001f600" * 1000, "مرحبا بكم",
    "John 3.16 changed me", "Rom 8.28-39!", "line one\nline two",
])
async def test_c_post_08_accepted_bodies(pg_client, make_user, published_sermon, body):
    sid = await published_sermon()
    r = await post(pg_client, await make_user(), sid, body)
    assert r.status_code == 201
    assert r.json()["body"] == body


async def test_c_post_09_bidi_stored_stripped(pg_client, make_user, published_sermon, db_rows):
    sid = await published_sermon()
    u = await make_user()
    r = await post(pg_client, u, sid, "‮evil‬ text")
    assert r.json()["body"] == "evil text"
    assert (await db_rows(SermonComment, user_id=u.id))[0].body == "evil text"


async def test_c_post_10_11_12_committed_staff_and_not_idempotent(pg_client, make_user, published_sermon, db_rows):
    sid = await published_sermon()
    for role in ("editor", "manager", "admin"):
        u = await make_user(role=role, full_name="Staff Person")
        r = await post(pg_client, u, sid, "staff comment")
        assert r.status_code == 201 and set(r.json()) == ALLOWED_KEYS
        assert len(await db_rows(SermonComment, user_id=u.id)) == 1  # committed before the response
    v = await make_user()
    await post(pg_client, v, sid, "same")
    await post(pg_client, v, sid, "same")
    assert len(await db_rows(SermonComment, user_id=v.id)) == 2  # pinned: not deduplicated


# ═════════════════════════════════════════════════════════════════════════════
# Self-delete
# ═════════════════════════════════════════════════════════════════════════════
async def test_c_del_01_06_self_delete_logs_without_body(pg_client, make_user, published_sermon, db_rows):
    sid = await published_sermon()
    u = await make_user()
    r = await post(pg_client, u, sid, "a secret SENTINEL-body")
    cid = r.json()["id"]
    assert (await pg_client.delete(f"{API}/comments/{cid}", headers=u.headers)).status_code == 204
    assert await db_rows(SermonComment, user_id=u.id) == []
    (log_row,) = await db_rows(CommentModerationLog)
    assert (log_row.action, log_row.actor_id, log_row.author_id, str(log_row.comment_id)) == (
        ModerationAction.SELF_DELETE, u.id, u.id, cid)
    assert str(log_row.sermon_id) == sid and log_row.body_snapshot is None
    assert "SENTINEL" not in repr([log_row.reason, log_row.body_snapshot])


async def test_c_del_02_hidden_is_409(pg_client, make_user, published_sermon, seed_comment, db_rows):
    sid = await published_sermon()
    u = await make_user()
    for auto in (True, False):
        cid = await seed_comment(sid, u.id, status=CommentStatus.HIDDEN, hidden_auto=auto)
        assert (await pg_client.delete(f"{API}/comments/{cid}", headers=u.headers)).status_code == 409
    assert len(await db_rows(SermonComment)) == 2 and await db_rows(CommentModerationLog) == []


async def test_c_del_03_05_07_uniform_404(pg_client, make_user, published_sermon, seed_comment, db_rows):
    sid = await published_sermon()
    owner, intruder = await make_user(), await make_user()
    cid = await seed_comment(sid, owner.id)
    nonexistent = await pg_client.delete(f"{API}/comments/{uuid.uuid4()}", headers=intruder.headers)
    foreign = await pg_client.delete(f"{API}/comments/{cid}", headers=intruder.headers)
    assert nonexistent.status_code == 404 and shape(foreign) == shape(nonexistent)
    assert (await pg_client.delete(f"{API}/comments/{cid}", headers=owner.headers)).status_code == 204
    again = await pg_client.delete(f"{API}/comments/{cid}", headers=owner.headers)
    assert shape(again) == shape(nonexistent)
    assert len(await db_rows(CommentModerationLog)) == 1  # no extra log row
    assert (await pg_client.delete(f"{API}/comments/not-a-uuid", headers=owner.headers)).status_code == 422


async def test_c_del_04_reports_cascade_log_survives(pg_client, make_user, published_sermon, db_rows):
    sid = await published_sermon()
    author, reporter = await make_user(), await make_user()
    cid = (await post(pg_client, author, sid, "reported then deleted")).json()["id"]
    assert (await report(pg_client, reporter, cid)).status_code == 204
    assert (await pg_client.delete(f"{API}/comments/{cid}", headers=author.headers)).status_code == 204
    assert await db_rows(SermonCommentReport) == []
    assert len(await db_rows(CommentModerationLog)) == 1


# ═════════════════════════════════════════════════════════════════════════════
# Report
# ═════════════════════════════════════════════════════════════════════════════
async def test_c_rep_01_09_10_happy_path(pg_client, make_user, published_sermon, seed_comment, db_rows):
    sid = await published_sermon()
    author, reporter = await make_user(), await make_user()
    cid = await seed_comment(sid, author.id)
    r = await report(pg_client, reporter, cid, "harassment", detail="  rude  ")
    assert r.status_code == 204 and r.content == b""
    (row,) = await db_rows(SermonCommentReport)
    assert (row.reason.value, row.detail, row.reporter_id) == ("harassment", "rude", reporter.id)
    assert (await db_rows(SermonComment, id=cid))[0].report_count == 1
    # Server-side the row stays in the reporter's list (the local hide is a client concern).
    assert cid and str(cid) in {i["id"] for i in (await listing(pg_client, reporter, sid)).json()["items"]}
    # The author's own list never exposes the report.
    assert_no_leak_keys((await listing(pg_client, author, sid)).json())


@pytest.mark.parametrize("reason", ["spam", "harassment", "hate", "sexual", "self_harm", "other"])
async def test_c_rep_02_reasons_accepted(pg_client, make_user, published_sermon, seed_comment, reason):
    sid = await published_sermon()
    cid = await seed_comment(sid, (await make_user()).id)
    assert (await report(pg_client, await make_user(), cid, reason)).status_code == 204


@pytest.mark.parametrize("reason", ["self-harm", "SPAM", "bogus", None])
async def test_c_rep_02_reasons_rejected(pg_client, make_user, published_sermon, seed_comment, reason):
    sid = await published_sermon()
    cid = await seed_comment(sid, (await make_user()).id)
    reporter = await make_user()
    body = {} if reason is None else {"reason": reason}
    r = await pg_client.post(f"{API}/comments/{cid}/report", json=body, headers=reporter.headers)
    assert r.status_code == 422


async def test_c_rep_03_detail_rules(pg_client, make_user, published_sermon, seed_comment, db_rows):
    sid = await published_sermon()
    cid = await seed_comment(sid, (await make_user()).id)
    ok = await make_user()
    assert (await report(pg_client, ok, cid, detail="d" * 500)).status_code == 204
    assert (await report(pg_client, await make_user(), cid, detail="d" * 501)).status_code == 422
    clean = await make_user()
    assert (await report(pg_client, clean, cid, detail="‮odd‬\x00 text")).status_code == 204
    details = {r.reporter_id: r.detail for r in await db_rows(SermonCommentReport)}
    assert details[clean.id] == "odd text"


async def test_c_rep_04_self_report_ignored(pg_client, make_user, published_sermon, seed_comment, db_rows):
    sid = await published_sermon()
    author = await make_user()
    cid = await seed_comment(sid, author.id)
    assert (await report(pg_client, author, cid)).status_code == 204
    assert await db_rows(SermonCommentReport) == []
    assert (await db_rows(SermonComment, id=cid))[0].report_count == 0


async def test_c_rep_05_duplicate_idempotent_first_reason_kept(pg_client, make_user, published_sermon, seed_comment, db_rows):
    sid = await published_sermon()
    cid = await seed_comment(sid, (await make_user()).id)
    reporter = await make_user()
    assert (await report(pg_client, reporter, cid, "spam")).status_code == 204
    assert (await report(pg_client, reporter, cid, "hate")).status_code == 204
    (row,) = await db_rows(SermonCommentReport)
    assert row.reason.value == "spam"
    assert (await db_rows(SermonComment, id=cid))[0].report_count == 1


async def test_c_rep_06_uniform_404(pg_client, make_user, published_sermon, seed_comment):
    reporter = await make_user()
    live = await published_sermon()
    gone = await published_sermon(status=SermonStatus.UNPUBLISHED)
    author = await make_user()
    hidden = await seed_comment(live, author.id, status=CommentStatus.HIDDEN)
    unpublished = await seed_comment(gone, author.id)
    base = await report(pg_client, reporter, uuid.uuid4())
    assert base.status_code == 404
    for cid in (hidden, unpublished):
        assert shape(await report(pg_client, reporter, cid)) == shape(base)
        assert shape(await block(pg_client, reporter, cid)) == shape(await block(pg_client, reporter, uuid.uuid4()))


async def test_c_rep_08_report_count_matches_rows(pg_client, make_user, published_sermon, seed_comment, db_rows):
    sid = await published_sermon()
    author = await make_user()
    cid = await seed_comment(sid, author.id)
    a, b = await make_user(), await make_user()
    for who in (a, a, b, author):
        await report(pg_client, who, cid)
    assert len(await db_rows(SermonCommentReport)) == (await db_rows(SermonComment, id=cid))[0].report_count == 2


async def test_c_rep_11_staff_report_like_anyone(pg_client, make_user, published_sermon, seed_comment, db_rows):
    sid = await published_sermon()
    cid = await seed_comment(sid, (await make_user()).id)
    for role in ("editor", "manager", "admin"):
        assert (await report(pg_client, await make_user(role=role), cid)).status_code == 204
    assert len(await db_rows(SermonCommentReport)) == 3


# ═════════════════════════════════════════════════════════════════════════════
# Block
# ═════════════════════════════════════════════════════════════════════════════
async def test_c_blk_01_02_idempotent_by_comment_id(pg_client, make_user, published_sermon, seed_comment, db_rows):
    sid = await published_sermon()
    author, viewer = await make_user(), await make_user()
    cid = await seed_comment(sid, author.id)
    first, second = await block(pg_client, viewer, cid), await block(pg_client, viewer, cid)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json() and first.json()["id"]
    (row,) = await db_rows(UserBlock)
    assert (row.blocker_id, row.blocked_id) == (viewer.id, author.id)
    assert set(first.json()) == {"id"}


async def test_c_blk_03_own_comment_ignored(pg_client, make_user, published_sermon, seed_comment, db_rows):
    sid = await published_sermon()
    u = await make_user()
    cid = await seed_comment(sid, u.id)
    r = await block(pg_client, u, cid)
    assert r.status_code == 200 and r.json() == {"id": None}
    assert await db_rows(UserBlock) == []


async def test_c_blk_05_06_list_order_and_unblock(pg_client, make_user, published_sermon, seed_comment, db_rows):
    sid = await published_sermon()
    viewer, other_viewer = await make_user(), await make_user()
    a, b = await make_user(full_name="Ann Able"), await make_user(full_name="Ben Baker")
    ca, cb = await seed_comment(sid, a.id), await seed_comment(sid, b.id)
    ida = (await block(pg_client, viewer, ca)).json()["id"]
    idb = (await block(pg_client, viewer, cb)).json()["id"]
    await block(pg_client, other_viewer, ca)
    names = [r["display_name"] for r in (await pg_client.get(f"{API}/me/blocks", headers=viewer.headers)).json()]
    assert names == ["Ben B.", "Ann A."]  # most recent first, only the caller's own
    # Someone else's block id and an unknown id are indistinguishable.
    foreign = await pg_client.delete(f"{API}/me/blocks/{ida}", headers=other_viewer.headers)
    unknown = await pg_client.delete(f"{API}/me/blocks/{uuid.uuid4()}", headers=other_viewer.headers)
    assert foreign.status_code == 404 and shape(foreign) == shape(unknown)
    assert (await pg_client.delete(f"{API}/me/blocks/{idb}", headers=viewer.headers)).status_code == 204
    assert (await pg_client.delete(f"{API}/me/blocks/{idb}", headers=viewer.headers)).status_code == 404
    assert len(await db_rows(UserBlock)) == 2


async def test_c_blk_07_no_enumeration_of_hidden_authors(pg_client, make_user, published_sermon, seed_comment):
    viewer = await make_user()
    private_sermon = await published_sermon(status=SermonStatus.DRAFT)
    cid = await seed_comment(private_sermon, (await make_user()).id)
    assert shape(await block(pg_client, viewer, cid)) == shape(await block(pg_client, viewer, uuid.uuid4()))
    assert (await pg_client.get(f"{API}/me/blocks", headers=viewer.headers)).json() == []


async def test_c_blk_08_09_survive_deactivation_staff_can_block(pg_client, make_user, published_sermon, seed_comment, sessions, db_rows):
    sid = await published_sermon()
    author, staff = await make_user(), await make_user(role="manager")
    cid = await seed_comment(sid, author.id)
    assert (await block(pg_client, staff, cid)).status_code == 200
    async with sessions() as s:
        (await s.get(User, author.id)).is_active = False
        await s.commit()
    assert len(await db_rows(UserBlock)) == 1
    async with sessions() as s:
        await s.execute(text("DELETE FROM users WHERE id = :i"), {"i": author.id})
        await s.commit()
    assert await db_rows(UserBlock) == []  # cascades with the blocked user


# ═════════════════════════════════════════════════════════════════════════════
# Terms and profile name
# ═════════════════════════════════════════════════════════════════════════════
async def test_c_terms_01_02_04_idempotent_timestamp(pg_client, make_user):
    u = await make_user(terms=False)
    assert (await pg_client.get(f"{API}/auth/me", headers=u.headers)).json()["comments_terms_accepted_at"] is None
    assert (await pg_client.post(f"{API}/me/comments-terms", headers=u.headers)).status_code == 204
    first = (await pg_client.get(f"{API}/auth/me", headers=u.headers)).json()["comments_terms_accepted_at"]
    assert first is not None
    assert (await pg_client.post(f"{API}/me/comments-terms", headers=u.headers)).status_code == 204
    assert (await pg_client.get(f"{API}/auth/me", headers=u.headers)).json()["comments_terms_accepted_at"] == first


async def test_c_terms_03_concurrent_accept(pg_client, make_user, db_rows):
    u = await make_user(terms=False)
    rs = await asyncio.gather(*[pg_client.post(f"{API}/me/comments-terms", headers=u.headers) for _ in range(2)])
    assert [r.status_code for r in rs] == [204, 204]
    assert (await db_rows(User, id=u.id))[0].comments_terms_accepted_at is not None


async def test_au_me_01_rename_applies_to_old_comments(pg_client, make_user, published_sermon):
    sid = await published_sermon()
    u = await make_user(full_name="Old Name")
    await post(pg_client, u, sid, "before rename")
    r = await pg_client.patch(f"{API}/auth/me", json={"full_name": "  Nii   Kwame Okai "}, headers=u.headers)
    assert r.status_code == 200 and r.json()["full_name"] == "Nii Kwame Okai"
    assert (await pg_client.get(f"{API}/auth/me", headers=u.headers)).json()["full_name"] == "Nii Kwame Okai"
    names = {i["author_display_name"] for i in (await listing(pg_client, u, sid)).json()["items"]}
    assert names == {"Nii O."}  # computed at read time, not frozen
    assert (await post(pg_client, u, sid, "after")).json()["author_display_name"] == "Nii O."


@pytest.mark.parametrize("name,ok", [
    ("A", True), ("x" * 100, True), ("", False), ("   ", False), ("x" * 101, False),
    ("‮‬", False),
])
async def test_au_me_02_length_bounds(pg_client, make_user, name, ok):
    u = await make_user()
    r = await pg_client.patch(f"{API}/auth/me", json={"full_name": name}, headers=u.headers)
    assert r.status_code == (200 if ok else 422)


async def test_au_me_02_normalised_like_bodies(pg_client, make_user):
    u = await make_user()
    r = await pg_client.patch(f"{API}/auth/me", json={"full_name": "‮Nii‬\x00 Kwame\n"}, headers=u.headers)
    assert r.json()["full_name"] == "Nii Kwame"


@pytest.mark.parametrize("extra", [
    {"email": "x@y.com"}, {"role": "admin"}, {"is_active": False},
    {"comments_terms_accepted_at": "2020-01-01T00:00:00Z"},
])
async def test_au_me_03_only_full_name_is_patchable(pg_client, make_user, db_rows, extra):
    u = await make_user(full_name="Keep Me")
    r = await pg_client.patch(f"{API}/auth/me", json={"full_name": "New Name", **extra}, headers=u.headers)
    assert r.status_code == 422
    (row,) = await db_rows(User, id=u.id)
    assert row.full_name == "Keep Me" and row.role.value == "viewer" and row.is_active


async def test_au_me_05_07_filters_on_names(pg_client, make_user):
    u = await make_user()
    for bad in ("fuck face", "visit example.com", "https://x.co", "Pastor Nii", "call 0241234567"):
        r = await pg_client.patch(f"{API}/auth/me", json={"full_name": bad}, headers=u.headers)
        assert r.status_code == 422, bad
        assert bad not in r.text


async def test_au_me_06_user_public_shape(pg_client, make_user):
    u = await make_user()
    keys = set((await pg_client.get(f"{API}/auth/me", headers=u.headers)).json())
    assert keys == {
        "id", "email", "full_name", "first_name", "last_name", "gender", "avatar_url",
        "role", "is_active", "activated_at", "comments_terms_accepted_at", "created_at",
    }


# ═════════════════════════════════════════════════════════════════════════════
# §A.6 role matrix, viewer-side cells
# ═════════════════════════════════════════════════════════════════════════════
@pytest.mark.parametrize("role", ["viewer", "editor", "manager", "admin"])
async def test_matrix_cells_r1_to_r4(pg_client, make_user, published_sermon, seed_comment, db_rows, role):
    sid = await published_sermon()
    actor = await make_user(role=role)
    other = await make_user()
    foreign = await seed_comment(sid, other.id, "someone else")
    assert (await listing(pg_client, actor, sid)).status_code == 200                      # R1
    mine = await post(pg_client, actor, sid, "mine")                                       # R2
    assert mine.status_code == 201
    non_owner = await pg_client.delete(f"{API}/comments/{foreign}", headers=actor.headers)
    assert non_owner.status_code == 404                                                    # R3 non-own
    assert (await pg_client.delete(f"{API}/comments/{mine.json()['id']}", headers=actor.headers)).status_code == 204
    assert (await report(pg_client, actor, foreign)).status_code == 204                    # R4
    assert (await block(pg_client, actor, foreign)).status_code == 200
    assert len(await db_rows(SermonComment, id=foreign)) == 1


async def test_matrix_r3_author_hidden_is_409_and_r4_author_ignored(pg_client, make_user, published_sermon, seed_comment, db_rows):
    sid = await published_sermon()
    author = await make_user()
    hidden = await seed_comment(sid, author.id, status=CommentStatus.HIDDEN)
    assert (await pg_client.delete(f"{API}/comments/{hidden}", headers=author.headers)).status_code == 409
    assert (await report(pg_client, author, hidden)).status_code == 204
    assert (await block(pg_client, author, hidden)).json() == {"id": None}
    assert await db_rows(SermonCommentReport) == [] and await db_rows(UserBlock) == []


async def test_adm_auth_01_staff_author_self_delete_only_own(pg_client, make_user, published_sermon):
    sid = await published_sermon()
    admin_a, admin_b = await make_user(role="admin"), await make_user(role="admin")
    cid = (await post(pg_client, admin_a, sid, "admin words")).json()["id"]
    assert (await pg_client.delete(f"{API}/comments/{cid}", headers=admin_b.headers)).status_code == 404
    assert (await pg_client.delete(f"{API}/comments/{cid}", headers=admin_a.headers)).status_code == 204


# ═════════════════════════════════════════════════════════════════════════════
# Rate limits (real Redis)
# ═════════════════════════════════════════════════════════════════════════════
async def test_rl_01_post_per_minute(pg_client, real_redis, make_user, published_sermon, db_rows):
    sid = await published_sermon()
    u = await make_user()
    for i in range(5):
        assert (await post(pg_client, u, sid, f"c{i}")).status_code == 201
    r = await post(pg_client, u, sid, "sixth")
    assert r.status_code == 429
    assert r.json()["detail"] and "correlation_id" in r.json()
    assert 0 < int(r.headers["Retry-After"]) <= 60
    assert len(await db_rows(SermonComment, user_id=u.id)) == 5  # RL-10: nothing written


async def test_rl_02_post_per_hour(pg_client, real_redis, make_user, published_sermon):
    sid = await published_sermon()
    u = await make_user()
    key = comments_service.rate_limit_key("post", "1h", u.id)
    await real_redis.set(f"ratelimit:{key}", 30, ex=3600)
    r = await post(pg_client, u, sid, "over the hour")
    assert r.status_code == 429 and 60 < int(r.headers["Retry-After"]) <= 3600


async def test_rl_03_window_recovery(pg_client, real_redis, make_user, published_sermon):
    sid = await published_sermon()
    u = await make_user()
    for i in range(5):
        await post(pg_client, u, sid, f"c{i}")
    assert (await post(pg_client, u, sid, "blocked")).status_code == 429
    await real_redis.pexpire(f"ratelimit:{comments_service.rate_limit_key('post', '1m', u.id)}", 300)
    await asyncio.sleep(0.6)
    assert (await post(pg_client, u, sid, "recovered")).status_code == 201


async def test_rl_04_reports(pg_client, real_redis, make_user, published_sermon, seed_comment, db_rows):
    sid = await published_sermon()
    author, reporter = await make_user(), await make_user()
    ids = [await seed_comment(sid, author.id, f"c{i}") for i in range(16)]
    for cid in ids[:15]:
        assert (await report(pg_client, reporter, cid)).status_code == 204
    r = await report(pg_client, reporter, ids[15])
    assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0
    assert len(await db_rows(SermonCommentReport)) == 15
    assert (await db_rows(SermonComment, id=ids[15]))[0].report_count == 0


async def test_rl_05_blocks(pg_client, real_redis, make_user, published_sermon, seed_comment, db_rows):
    sid = await published_sermon()
    viewer = await make_user()
    comments = [await seed_comment(sid, (await make_user()).id) for _ in range(31)]
    for cid in comments[:30]:
        assert (await block(pg_client, viewer, cid)).status_code == 200
    r = await block(pg_client, viewer, comments[30])
    assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0
    assert len(await db_rows(UserBlock)) == 30


async def test_rl_06_07_per_user_and_independent(pg_client, real_redis, make_user, published_sermon, seed_comment):
    sid = await published_sermon()
    a, b = await make_user(), await make_user()
    for i in range(5):
        await post(pg_client, a, sid, f"c{i}")
    spoof = {**a.headers, "X-Forwarded-For": "203.0.113.9"}
    still_limited = await pg_client.post(f"{API}/sermons/{sid}/comments", json={"body": "x"}, headers=spoof)
    assert still_limited.status_code == 429          # not IP-keyed
    assert (await post(pg_client, b, sid, "b is fine")).status_code == 201  # other user unaffected
    cid = await seed_comment(sid, b.id)
    assert (await report(pg_client, a, cid)).status_code == 204             # independent per action
    assert (await block(pg_client, a, cid)).status_code == 200


async def test_rl_08_concurrent_posts_exactly_five(pg_client, real_redis, make_user, published_sermon, db_rows):
    sid = await published_sermon()
    u = await make_user()
    rs = await asyncio.gather(*[post(pg_client, u, sid, f"race {i}") for i in range(10)])
    codes = sorted(r.status_code for r in rs)
    assert codes == [201] * 5 + [429] * 5
    assert len(await db_rows(SermonComment, user_id=u.id)) == 5


async def test_rl_09_redis_down_fails_open(pg_client, make_user, published_sermon, seed_comment, db_rows):
    from tests.conftest import _fake

    sid = await published_sermon()
    u, author = await make_user(), await make_user()
    cid = await seed_comment(sid, author.id)
    with _fake.failing():
        assert (await report(pg_client, u, cid)).status_code == 204
        assert (await report(pg_client, u, cid)).status_code == 204
        assert (await block(pg_client, u, cid)).status_code == 200
    assert len(await db_rows(SermonCommentReport)) == 1  # the DB constraint still holds


async def test_rl_11_comment_429_is_a_content_error(pg_client, real_redis, make_user, published_sermon):
    sid = await published_sermon()
    u = await make_user()
    for i in range(5):
        await post(pg_client, u, sid, f"c{i}")
    r = await post(pg_client, u, sid, "x")
    assert r.status_code == 429 and r.json()["detail"] == "Too many requests. Please try again shortly."


async def test_rl_12_rejected_attempts_consume_budget(pg_client, real_redis, make_user, published_sermon):
    """Pin A6: URL / blocklist / validation rejects still cost budget."""
    sid = await published_sermon()
    u = await make_user()
    for _ in range(5):
        assert (await post(pg_client, u, sid, "see http://x.com")).status_code == 422
    assert (await post(pg_client, u, sid, "a clean one")).status_code == 429


# ═════════════════════════════════════════════════════════════════════════════
# No bodies in logs
# ═════════════════════════════════════════════════════════════════════════════
async def test_nl_01_no_body_in_logs_on_success_paths(pg_client, capture_logs, make_user, published_sermon):
    sid = await published_sermon()
    u = await make_user()
    sentinel = _sentinel()
    r = await post(pg_client, u, sid, f"praise {sentinel}")
    assert r.status_code == 201
    assert (await listing(pg_client, u, sid)).status_code == 200
    assert (await pg_client.delete(f"{API}/comments/{r.json()['id']}", headers=u.headers)).status_code == 204
    assert capture_logs.records, "service logging is expected to fire"
    assert sentinel not in capture_logs.text()


@pytest.mark.parametrize("make_body", [
    lambda s: f"{s} http://spam.example.com",
    lambda s: f"{s} fuck",
    lambda s: s + "x" * 1000,
])
async def test_nl_02_no_body_in_logs_on_rejections(pg_client, capture_logs, make_user, published_sermon, make_body):
    sid = await published_sermon()
    sentinel = _sentinel()
    r = await post(pg_client, await make_user(), sid, make_body(sentinel))
    assert r.status_code == 422
    assert sentinel not in capture_logs.text() and sentinel not in r.text


async def test_nl_02_no_body_in_logs_on_403_404_429(pg_client, real_redis, capture_logs, make_user, published_sermon):
    sid = await published_sermon()
    sentinel = _sentinel()
    unready = await make_user(terms=False)
    assert (await post(pg_client, unready, sid, sentinel)).status_code == 403
    assert (await post(pg_client, unready, str(uuid.uuid4()), sentinel)).status_code == 404
    limited = await make_user()
    for i in range(5):
        await post(pg_client, limited, sid, f"c{i}")
    assert (await post(pg_client, limited, sid, sentinel)).status_code == 429
    assert sentinel not in capture_logs.text()


@pytest.mark.parametrize("exc_factory", [
    lambda: __import__("sqlalchemy.exc", fromlist=["x"]).IntegrityError("INSERT ... [parameters: ('SENTINEL',)]", {"body": "SENTINEL"}, Exception("SENTINEL")),
    lambda: __import__("sqlalchemy.exc", fromlist=["x"]).OperationalError("SELECT SENTINEL", {}, Exception("SENTINEL")),
])
async def test_nl_02_forced_db_error_leaks_no_body(
    pg_client, capture_logs, monkeypatch, make_user, published_sermon, db_rows, exc_factory
):
    from sqlalchemy.ext.asyncio import AsyncSession

    sid = await published_sermon()
    u = await make_user()
    sentinel = _sentinel()

    async def boom(self):
        raise exc_factory()

    monkeypatch.setattr(AsyncSession, "commit", boom)
    r = await post(pg_client, u, sid, f"x {sentinel}")
    monkeypatch.undo()
    assert r.status_code == 500 and sentinel not in r.text
    assert sentinel not in capture_logs.text()
    assert "SENTINEL" not in capture_logs.text()  # not even the driver's parameters
    assert await db_rows(SermonComment) == []


async def test_nl_04_06_validation_errors_and_names_and_details_not_logged(
    pg_client, capture_logs, make_user, published_sermon, seed_comment
):
    sid = await published_sermon()
    u = await make_user()
    sentinel = _sentinel()
    r1 = await pg_client.post(f"{API}/sermons/{sid}/comments", json={"body": 5, "x": sentinel}, headers=u.headers)
    cid = await seed_comment(sid, (await make_user()).id)
    r2 = await report(pg_client, u, cid, detail=sentinel)
    r3 = await pg_client.patch(f"{API}/auth/me", json={"full_name": f"{sentinel}.com"}, headers=u.headers)
    r4 = await pg_client.patch(f"{API}/auth/me", json={"full_name": f"Nii {sentinel[-8:]}"}, headers=u.headers)
    assert (r1.status_code, r2.status_code, r3.status_code, r4.status_code) == (422, 204, 422, 200)
    assert sentinel not in r1.text and sentinel not in r3.text
    assert sentinel not in capture_logs.text() and sentinel[-8:] not in capture_logs.text()


# ═════════════════════════════════════════════════════════════════════════════
# Races
# ═════════════════════════════════════════════════════════════════════════════
async def test_race_01_concurrent_double_report_same_reporter(pg_client, make_user, published_sermon, seed_comment, db_rows, sessions):
    sid = await published_sermon()
    author = await make_user()
    for i in range(20):
        cid = await seed_comment(sid, author.id, f"c{i}")
        reporter = await make_user()
        rs = await asyncio.gather(*[report(pg_client, reporter, cid) for _ in range(2)])
        assert [r.status_code for r in rs] == [204, 204]
        assert len(await db_rows(SermonCommentReport, comment_id=cid)) == 1
        assert (await db_rows(SermonComment, id=cid))[0].report_count == 1


async def test_race_04_report_vs_self_delete(pg_client, make_user, published_sermon, seed_comment, db_rows):
    sid = await published_sermon()
    author = await make_user()
    for i in range(10):
        cid = await seed_comment(sid, author.id, f"c{i}")
        reporter = await make_user()
        rep, dele = await asyncio.gather(
            report(pg_client, reporter, cid),
            pg_client.delete(f"{API}/comments/{cid}", headers=author.headers),
        )
        assert rep.status_code in (204, 404) and dele.status_code == 204
        assert await db_rows(SermonComment, id=cid) == []
        assert await db_rows(SermonCommentReport, comment_id=cid) == []
    assert len(await db_rows(CommentModerationLog)) == 10


async def test_race_06_block_and_unblock(pg_client, make_user, published_sermon, seed_comment, db_rows):
    sid = await published_sermon()
    author, viewer = await make_user(), await make_user()
    cid = await seed_comment(sid, author.id)
    rs = await asyncio.gather(*[block(pg_client, viewer, cid) for _ in range(3)])
    assert [r.status_code for r in rs] == [200, 200, 200]
    assert len(await db_rows(UserBlock)) == 1
    bid = rs[0].json()["id"]
    mixed = await asyncio.gather(
        block(pg_client, viewer, cid),
        pg_client.delete(f"{API}/me/blocks/{bid}", headers=viewer.headers),
    )
    assert mixed[0].status_code == 200 and mixed[1].status_code in (204, 404)
    assert len(await db_rows(UserBlock)) <= 1


async def test_race_07_concurrent_double_self_delete(pg_client, make_user, published_sermon, seed_comment, db_rows):
    sid = await published_sermon()
    author = await make_user()
    cid = await seed_comment(sid, author.id)
    rs = await asyncio.gather(*[pg_client.delete(f"{API}/comments/{cid}", headers=author.headers) for _ in range(2)])
    assert sorted(r.status_code for r in rs) == [204, 404]
    assert len(await db_rows(CommentModerationLog)) == 1


# ═════════════════════════════════════════════════════════════════════════════
# Atomicity and parity
# ═════════════════════════════════════════════════════════════════════════════
async def test_adm_tx_01_self_delete_rolls_back_when_log_fails(
    pg_client, break_moderation_log, make_user, published_sermon, seed_comment, db_rows
):
    sid = await published_sermon()
    author = await make_user()
    cid = await seed_comment(sid, author.id)
    r = await pg_client.delete(f"{API}/comments/{cid}", headers=author.headers)
    assert r.status_code == 500
    assert len(await db_rows(SermonComment, id=cid)) == 1  # the delete rolled back with the log row


async def test_par_01_request_rules_match_db_check(pg_engine, make_user):
    """Everything the service accepts inserts; every length-rejected string is
    refused by the CHECK. Normalisation-only rejects are covered by the empty
    string."""
    from psycopg.errors import CheckViolation
    from sqlalchemy.exc import DBAPIError

    corpus = [
        "", "a", "a" * 999, "a" * 1000, "a" * 1001, f"  {'a' * 1000}  ", f"‮{'b' * 1000}‬",
        "\U0001f600" * 1000, "\U0001f600" * 1001, "é" * 1000, "é" * 1001, "​​", "   ",
    ]
    owner = await make_user(role="editor")
    from app.models.models import Sermon

    sermon_id = uuid.uuid4()
    async with pg_engine.begin() as conn:
        await conn.execute(text(
            "INSERT INTO sermons (id, title, status, created_by) VALUES (:i, 't', 'PUBLISHED', :u)"
        ), {"i": sermon_id, "u": owner.id})

    for raw in corpus:
        try:
            body = comments_service.validate_comment_body(raw)
            accepted = True
        except Exception:
            body, accepted = normalise_text(raw), False
        try:
            async with pg_engine.begin() as conn:
                await conn.execute(text(
                    "INSERT INTO sermon_comments (id, sermon_id, user_id, body) VALUES (:i, :s, :u, :b)"
                ), {"i": uuid.uuid4(), "s": sermon_id, "u": owner.id, "b": body})
            db_ok = True
        except DBAPIError as exc:
            assert isinstance(exc.orig, CheckViolation)
            db_ok = False
        if accepted:
            assert db_ok, f"service accepted but DB refused: {raw[:20]!r}"
        elif len(body) == 0 or len(body) > 1000:
            assert not db_ok, f"length-rejected but DB accepted: {raw[:20]!r}"
    assert Sermon  # model import keeps the sermon table definition loaded


def test_nomock_01_no_orm_mocking_in_comments_tests():
    import re
    from pathlib import Path

    forbidden = re.compile("unittest" + r"\.mock|Magic" + "Mock|Async" + "Mock|create_auto" + "spec")
    for name in ("test_comments.py", "test_comment_moderation.py", "comments_pg.py"):
        src = (Path(__file__).parent / name).read_text()
        assert not forbidden.search(src), name


# ═════════════════════════════════════════════════════════════════════════════
# S10 fixes: raw-length bound before normalising (M-1), match form (S-2), TLDs (S-4)
# ═════════════════════════════════════════════════════════════════════════════
class _CountingNormaliser:
    def __init__(self, real):
        self.real = real
        self.calls = 0

    def __call__(self, *args, **kwargs):
        self.calls += 1
        return self.real(*args, **kwargs)


async def test_m1_huge_body_rejected_without_running_the_normaliser(
    pg_client, make_user, published_sermon, monkeypatch
):
    counter = _CountingNormaliser(comments_service.normalise_text)
    monkeypatch.setattr(comments_service, "normalise_text", counter)
    sid = await published_sermon()
    r = await post(pg_client, await make_user(), sid, "a" * 1_900_000)
    assert r.status_code == 422
    assert counter.calls == 0
    # The normalised cap still applies inside the raw cap, via the normaliser.
    r = await post(pg_client, await make_user(), sid, "a" * 1001)
    assert r.status_code == 422 and counter.calls == 1


async def test_m1_huge_body_still_costs_rate_limit_budget(
    pg_client, real_redis, make_user, published_sermon
):
    """Pin A6 holds: the raw-length 422 comes after the budget charge."""
    sid = await published_sermon()
    u = await make_user()
    for _ in range(5):
        assert (await post(pg_client, u, sid, "a" * 1_900_000)).status_code == 422
    assert (await post(pg_client, u, sid, "fine")).status_code == 429


async def test_m1_huge_full_name_rejected_without_running_the_normaliser(
    pg_client, make_user, monkeypatch
):
    counter = _CountingNormaliser(comments_service.normalise_text)
    monkeypatch.setattr(comments_service, "normalise_text", counter)
    r = await pg_client.patch(
        f"{API}/auth/me", json={"full_name": "n" * 1_900_000}, headers=(await make_user()).headers
    )
    assert r.status_code == 422
    assert counter.calls == 0


def test_m1_huge_moderation_reason_rejected_without_running_the_normaliser(monkeypatch):
    from pydantic import ValidationError

    from app.models import content_schemas

    counter = _CountingNormaliser(content_schemas.normalise_text)
    monkeypatch.setattr(content_schemas, "normalise_text", counter)
    with pytest.raises(ValidationError):
        content_schemas.ModerationReason(reason="r" * 1_900_000)
    assert counter.calls == 0
    assert content_schemas.ModerationReason(reason=" fine reason ").reason == "fine reason"


@pytest.mark.parametrize("candidate", [
    "example.­com", "exam­ple.com", "www­.example.com", "ex͏ample.com",
    "example.‌com", "example.⁤com",
])
def test_s2_invisible_format_chars_cannot_hide_a_url(candidate):
    assert contains_url(candidate)


def test_s2_soft_hyphen_cannot_hide_a_blocklisted_word():
    word = sorted(t for t in BLOCKED_TERMS if " " not in t and len(t) >= 4)[0]
    assert contains_blocked_term(word[:2] + "­" + word[2:])
    assert contains_blocked_term(word[:2] + "͏" + word[2:])


@pytest.mark.parametrize("candidate", ["Praise God.Today", "Amen.Me", "Thank Him.It", "Walk in the light.Life is good"])
def test_s4_run_together_english_is_accepted(candidate):
    assert not contains_url(candidate)


@pytest.mark.parametrize("candidate", ["x.church", "visit grace.church today", "example.com"])
def test_s4_church_tld_and_core_tlds_rejected(candidate):
    assert contains_url(candidate)


async def test_n2_retry_after_failure_is_logged_at_debug_and_fails_open(monkeypatch, capture_logs):
    from redis.exceptions import RedisError

    class Boom:
        async def ttl(self, key):
            raise RedisError("down")

    monkeypatch.setattr(comments_service.rate_limit, "get_redis", lambda: Boom())
    assert await comments_service._retry_after("k", 60) == 60
    assert any(
        r["level"] == "debug" and r["event"] == "comment_retry_after_unavailable"
        for r in capture_logs.records
    )


async def test_s5_write_guard_survives_a_failing_rollback_and_logs_sqlstate(monkeypatch, capture_logs):
    from sqlalchemy.exc import DBAPIError, InvalidRequestError

    class Orig(Exception):
        sqlstate = "40001"

    class FakeDb:
        async def rollback(self):
            raise InvalidRequestError("rollback failed with SECRET-PARAM")

    with pytest.raises(comments_service.ContentError) as ei:
        async with comments_service._write_guard(FakeDb(), "comment_write_failed"):
            raise DBAPIError("INSERT ... SECRET-PARAM", {"body": "SECRET-PARAM"}, Orig("x"))
    assert ei.value.status_code == 500
    assert ei.value.__cause__ is None and ei.value.__suppress_context__
    text = capture_logs.text()
    assert "40001" in text and "SECRET-PARAM" not in text


def test_m1_huge_report_detail_rejected_without_running_the_normaliser(monkeypatch):
    from pydantic import ValidationError

    from app.models import content_schemas

    counter = _CountingNormaliser(content_schemas.normalise_text)
    monkeypatch.setattr(content_schemas, "normalise_text", counter)
    with pytest.raises(ValidationError):
        content_schemas.CommentReportCreate(reason="spam", detail="d" * 1_900_000)
    assert counter.calls == 0
    ok = content_schemas.CommentReportCreate(reason="spam", detail=" fine ")
    assert ok.detail == "fine"
