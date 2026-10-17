"""Sermon-comments schema migration (S5), on real Postgres via Testcontainers.

Covers S1 cases MG-01..MG-17 for the comments revision. MG-05 (the notes drop
revision's downgrade) belongs to S3 and is included here because the round trip
walks through it.

The Notes identifiers are never spelled out in this file (DoD-1 grep).
"""
from __future__ import annotations

import uuid

import psycopg
import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from alembic.config import Config
from psycopg import errors
from sqlalchemy import create_engine

from app.db.database import Base
import app.models.models  # noqa: F401  (register all tables on Base.metadata)
from tests.comments_pg import (  # noqa: F401  (fixtures)
    alembic_runner,
    pg_server,
    throwaway_db,
)

DROP_REV = "d1e2f3a4b5c6"
COMMENTS_REV = "e5f6a7b8c9d0"
PRE_DROP_REV = "c7d8e9f0a1b2"
# The merge revision joining this chain with the sibling (verses/prophets-catalog)
# branch. MG-01/04/06/07 below target COMMENTS_REV/DROP_REV directly rather than
# relying on "head" or a relative `-1` step — both become ambiguous once a merge
# revision has two parents.
MERGE_REV = "0543034f79af"
# The actual current head — whatever's chained on top of MERGE_REV as of the most
# recent migration (ADMIN-SETTINGS S6: `audit_log`, `8c596c67f0ae`, chained on
# the pre-existing schema-drift fix `a517c3beba93`, itself chained on S3's
# sermon_play_daily/listener_day rollup tables `dbdcee764ca3`, chained on
# `c9b3e7a1f2d4`). A future migration moves this constant forward again; the
# chain assertions below it (MERGE_REV/COMMENTS_REV/DROP_REV/PRE_DROP_REV, all
# further down the tree) don't change, since they describe ancestry beneath
# MERGE_REV, not what sits on top of it.
CURRENT_HEAD = "8c596c67f0ae"

NEW_TABLES = {
    "sermon_comments",
    "sermon_comment_reports",
    "comment_moderation_log",
    "user_blocks",
}


def _ok(proc):
    assert proc.returncode == 0, f"alembic failed:\n{proc.stdout}\n{proc.stderr}"


def _fingerprint(dsn: str) -> dict:
    """Tables, columns, indexes (with definitions), constraints (with
    definitions) for the public schema."""
    with psycopg.connect(dsn) as conn:
        cols = conn.execute(
            "SELECT table_name, column_name, data_type, is_nullable, column_default "
            "FROM information_schema.columns WHERE table_schema='public' "
            "ORDER BY 1,2"
        ).fetchall()
        idx = conn.execute(
            "SELECT tablename, indexname, indexdef FROM pg_indexes "
            "WHERE schemaname='public' ORDER BY 1,2"
        ).fetchall()
        cons = conn.execute(
            "SELECT conrelid::regclass::text, conname, pg_get_constraintdef(oid) "
            "FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY 1,2"
        ).fetchall()
    return {"cols": cols, "idx": idx, "cons": cons}


def _tables(dsn: str) -> set[str]:
    with psycopg.connect(dsn) as conn:
        return {
            r[0]
            for r in conn.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema='public'"
            )
        }


def _catalog_names(dsn: str) -> set[tuple]:
    """Every relation, constraint and column name in public, for MG-07."""
    with psycopg.connect(dsn) as conn:
        rels = {("rel", r[0]) for r in conn.execute(
            "SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace")}
        cons = {("con", r[0]) for r in conn.execute(
            "SELECT conname FROM pg_constraint WHERE connamespace='public'::regnamespace")}
        cols = {("col", r[0], r[1]) for r in conn.execute(
            "SELECT table_name, column_name FROM information_schema.columns "
            "WHERE table_schema='public'")}
    return rels | cons | cols


@pytest.fixture
def migrated(throwaway_db, alembic_runner):
    _ok(alembic_runner(throwaway_db.sa_url, "upgrade", "head"))
    return throwaway_db


def _mk_user(conn, email=None, role="VIEWER") -> uuid.UUID:
    uid = uuid.uuid4()
    conn.execute(
        "INSERT INTO users (id, email, password_hash, role, is_active) "
        "VALUES (%s, %s, 'x', %s, true)",
        (uid, email or f"{uid}@example.com", role),
    )
    return uid


def _mk_sermon(conn, creator) -> uuid.UUID:
    sid = uuid.uuid4()
    conn.execute(
        "INSERT INTO sermons (id, title, status, created_by) "
        "VALUES (%s, 't', 'DRAFT', %s)",
        (sid, creator),
    )
    return sid


def _mk_comment(conn, sermon, user, body="hello", **extra) -> uuid.UUID:
    cid = uuid.uuid4()
    cols = {"id": cid, "sermon_id": sermon, "user_id": user, "body": body, **extra}
    names = ", ".join(cols)
    marks = ", ".join(["%s"] * len(cols))
    conn.execute(f"INSERT INTO sermon_comments ({names}) VALUES ({marks})", tuple(cols.values()))
    return cid


_AUTO = object()


def _log(conn, comment, action, reason=None, snapshot=None, actor=None, cleared=_AUTO):
    """`cleared` defaults to a valid value for the action (3 for dismiss_reports,
    NULL otherwise) so only the tests probing that CHECK pass it explicitly."""
    if cleared is _AUTO:
        cleared = 3 if action == "dismiss_reports" else None
    conn.execute(
        "INSERT INTO comment_moderation_log "
        "(id, comment_id, actor_id, action, reason, sermon_id, author_id, body_snapshot, "
        "cleared_report_count) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (uuid.uuid4(), comment, actor, action, reason, uuid.uuid4(), uuid.uuid4(), snapshot, cleared),
    )


@pytest.fixture
def conn(migrated):
    with psycopg.connect(migrated.dsn, autocommit=True) as c:
        yield c


# --------------------------------------------------------------------------- #
# MG-01 .. MG-08: revision graph, round trip, additivity, parity
# --------------------------------------------------------------------------- #

def test_mg01_single_head_and_chain(alembic_runner, throwaway_db):
    cfg = Config("alembic.ini")
    script = ScriptDirectory.from_config(cfg)
    assert script.get_heads() == [CURRENT_HEAD]
    assert COMMENTS_REV in script.get_revision(MERGE_REV).down_revision
    assert script.get_revision(COMMENTS_REV).down_revision == DROP_REV
    assert script.get_revision(DROP_REV).down_revision == PRE_DROP_REV


def test_mg02_mg03_round_trip_fingerprint_identical(throwaway_db, alembic_runner):
    url = throwaway_db.sa_url
    _ok(alembic_runner(url, "upgrade", "head"))
    before = _fingerprint(throwaway_db.dsn)
    _ok(alembic_runner(url, "downgrade", DROP_REV))
    _ok(alembic_runner(url, "downgrade", PRE_DROP_REV))
    _ok(alembic_runner(url, "upgrade", "head"))
    assert _fingerprint(throwaway_db.dsn) == before


def test_mg04_downgrade_removes_only_comment_objects(throwaway_db, alembic_runner):
    url = throwaway_db.sa_url
    _ok(alembic_runner(url, "upgrade", "head"))
    # Target DROP_REV explicitly rather than a relative `-1` step: from the merge
    # revision's two parents, a relative step is an "Ambiguous walk" to alembic.
    _ok(alembic_runner(url, "downgrade", DROP_REV))
    tables = _tables(throwaway_db.dsn)
    assert not (NEW_TABLES & tables)
    with psycopg.connect(throwaway_db.dsn) as c:
        n = c.execute(
            "SELECT count(*) FROM information_schema.columns WHERE "
            "table_name='users' AND column_name='comments_terms_accepted_at'"
        ).fetchone()[0]
    assert n == 0
    # the drop revision's state is intact: the old notes-style table stays absent
    assert not {t for t in tables if t.startswith("sermon_no" + "tes")}


def test_mg05_drop_revision_downgrade_restores_table_and_indexes(throwaway_db, alembic_runner):
    url = throwaway_db.sa_url
    _ok(alembic_runner(url, "upgrade", "head"))
    _ok(alembic_runner(url, "downgrade", PRE_DROP_REV))
    tbl = "sermon_no" + "tes"
    assert tbl in _tables(throwaway_db.dsn)
    with psycopg.connect(throwaway_db.dsn) as c:
        idx = {r[0] for r in c.execute(
            "SELECT indexname FROM pg_indexes WHERE tablename=%s", (tbl,))}
    assert {f"ix_{tbl}_user_created", f"ix_{tbl}_user_sermon_position",
            f"ix_{tbl}_sermon_id", f"ix_{tbl}_user_id"} <= idx


def test_mg06_round_trip_with_seeded_rows_discards_data(migrated, alembic_runner, conn):
    admin = _mk_user(conn)
    author = _mk_user(conn)
    sermon = _mk_sermon(conn, admin)
    cid = _mk_comment(conn, sermon, author)
    conn.execute(
        "INSERT INTO sermon_comment_reports (id, comment_id, reporter_id, reason) "
        "VALUES (%s, %s, %s, 'spam')", (uuid.uuid4(), cid, admin))
    conn.execute("INSERT INTO user_blocks (id, blocker_id, blocked_id) VALUES (%s,%s,%s)",
                 (uuid.uuid4(), admin, author))
    _log(conn, cid, "self_delete")
    conn.execute("UPDATE users SET comments_terms_accepted_at = now() WHERE id=%s", (author,))
    # Target DROP_REV explicitly — see MG-04's comment on why `-1` is ambiguous here.
    _ok(alembic_runner(migrated.sa_url, "downgrade", DROP_REV))
    _ok(alembic_runner(migrated.sa_url, "upgrade", "head"))
    for t in NEW_TABLES:
        assert conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] == 0
    # unrelated data is untouched, and the re-added column is NULL again
    assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 2
    assert conn.execute(
        "SELECT count(*) FROM users WHERE comments_terms_accepted_at IS NOT NULL"
    ).fetchone()[0] == 0


def test_mg07_upgrade_is_purely_additive(throwaway_db, alembic_runner):
    url = throwaway_db.sa_url
    _ok(alembic_runner(url, "upgrade", DROP_REV))
    before = _catalog_names(throwaway_db.dsn)
    # Target COMMENTS_REV, not "head": "head" now also pulls in the sibling
    # verses/prophets-catalog branch (merged at MERGE_REV), which this test has
    # no opinion on — it's scoped to what the comments revision itself adds.
    _ok(alembic_runner(url, "upgrade", COMMENTS_REV))
    after = _catalog_names(throwaway_db.dsn)
    assert before <= after, f"upgrade removed objects: {sorted(before - after)}"
    added_tables = {n[1] for n in after - before if n[0] == "col"}
    added_cols = {n for n in after - before if n[0] == "col"}
    assert {t for t in added_tables} == NEW_TABLES | {"users"}
    assert [c for c in added_cols if c[1] == "users"] == [
        ("col", "users", "comments_terms_accepted_at")
    ]


def test_mg08_orm_migration_parity(migrated):
    sync_url = migrated.sa_url
    engine = create_engine(sync_url)
    try:
        with engine.connect() as c:
            diff = compare_metadata(MigrationContext.configure(c), Base.metadata)
    finally:
        engine.dispose()
    # The schema carries pre-existing drift on unrelated tables (announcements,
    # playback_sessions, subscriptions, sermons FTS index); out of scope for S5.
    # Parity is asserted for every object this revision owns.
    owned = NEW_TABLES | {"users"}

    def table_of(item):
        if isinstance(item, list):  # modify_* ops are grouped in a list
            return {t for i in item for t in table_of(i)}
        op, obj = item[0], item[1]
        if op in ("add_table", "remove_table"):
            return {obj.name}
        if op in ("add_column", "remove_column"):
            return {item[2]}
        if op.startswith("modify_"):
            return {item[2]}
        return {obj.table.name} if hasattr(obj, "table") and obj.table is not None else set()

    ours = [d for d in diff if table_of(d) & owned]
    assert ours == [], f"model drift vs migrated schema: {ours}"


# --------------------------------------------------------------------------- #
# MG-09 .. MG-14, MG-17: constraints
# --------------------------------------------------------------------------- #

@pytest.fixture
def seeded(conn):
    admin = _mk_user(conn)
    author = _mk_user(conn)
    return conn, _mk_sermon(conn, admin), author, admin


@pytest.mark.parametrize("body,ok", [
    pytest.param("", False, id="0-chars-rejected"),
    pytest.param("a", True, id="1-char-ok"),
    pytest.param("a" * 1000, True, id="1000-chars-ok"),
    pytest.param("a" * 1001, False, id="1001-chars-rejected"),
    pytest.param("\U0001F600" * 1000, True, id="1000-astral-ok"),
    pytest.param("\U0001F600" * 1001, False, id="1001-astral-rejected"),
])
def test_mg09_body_length_check(seeded, body, ok):
    conn, sermon, author, _ = seeded
    if ok:
        _mk_comment(conn, sermon, author, body=body)
    else:
        with pytest.raises(errors.CheckViolation):
            _mk_comment(conn, sermon, author, body=body)


@pytest.mark.parametrize("action,ok", [
    ("hide", False), ("hard_delete", False), ("dismiss_reports", False),
    ("restore", True), ("self_delete", True), ("auto_hide", True),
])
def test_mg10_reason_required_for_hide_hard_delete_and_dismiss_reports(seeded, action, ok):
    conn, *_ = seeded
    if ok:
        _log(conn, uuid.uuid4(), action, reason=None)
    else:
        with pytest.raises(errors.CheckViolation):
            _log(conn, uuid.uuid4(), action, reason=None)
    _log(conn, uuid.uuid4(), action, reason="because")  # a reason is always fine


@pytest.mark.parametrize("action,snapshot,ok", [
    ("hide", "x", False), ("restore", "x", False),
    ("self_delete", "x", False), ("auto_hide", "x", False), ("dismiss_reports", "x", False),
    ("hard_delete", "x", True), ("hide", None, True), ("hard_delete", None, True),
])
def test_mg11_snapshot_only_on_hard_delete(seeded, action, snapshot, ok):
    conn, *_ = seeded
    call = lambda: _log(conn, uuid.uuid4(), action, reason="r", snapshot=snapshot)  # noqa: E731
    if ok:
        call()
    else:
        with pytest.raises(errors.CheckViolation):
            call()


def test_mg12_user_blocks_constraints(seeded):
    conn, _, a, b = seeded
    with pytest.raises(errors.CheckViolation):
        conn.execute("INSERT INTO user_blocks (id, blocker_id, blocked_id) VALUES (%s,%s,%s)",
                     (uuid.uuid4(), a, a))
    bid = uuid.uuid4()
    conn.execute("INSERT INTO user_blocks (id, blocker_id, blocked_id) VALUES (%s,%s,%s)",
                 (bid, a, b))
    with pytest.raises(errors.UniqueViolation):
        conn.execute("INSERT INTO user_blocks (id, blocker_id, blocked_id) VALUES (%s,%s,%s)",
                     (uuid.uuid4(), a, b))
    # the reverse direction is a distinct pair
    conn.execute("INSERT INTO user_blocks (id, blocker_id, blocked_id) VALUES (%s,%s,%s)",
                 (uuid.uuid4(), b, a))
    with pytest.raises(errors.UniqueViolation):  # surrogate id is unique
        conn.execute("INSERT INTO user_blocks (id, blocker_id, blocked_id) VALUES (%s,%s,%s)",
                     (bid, a, _mk_user(conn)))


def test_mg13_report_unique_per_reporter(seeded):
    conn, sermon, author, reporter = seeded
    cid = _mk_comment(conn, sermon, author)
    sql = ("INSERT INTO sermon_comment_reports (id, comment_id, reporter_id, reason) "
           "VALUES (%s, %s, %s, 'spam')")
    conn.execute(sql, (uuid.uuid4(), cid, reporter))
    with pytest.raises(errors.UniqueViolation):
        conn.execute(sql, (uuid.uuid4(), cid, reporter))


def test_mg_dismiss_reports_action_is_accepted_and_neighbours_still_rejected(seeded):
    conn, *_ = seeded
    _log(conn, uuid.uuid4(), "dismiss_reports", reason="reviewed")
    for bogus in ("dismiss", "dismiss_report", "DISMISS_REPORTS"):
        with pytest.raises(errors.CheckViolation):
            _log(conn, uuid.uuid4(), bogus, reason="r")


@pytest.mark.parametrize("action,cleared,ok", [
    ("dismiss_reports", 1, True), ("dismiss_reports", 3, True), ("dismiss_reports", 2_000_000, True),
    ("dismiss_reports", None, False), ("dismiss_reports", 0, False), ("dismiss_reports", -1, False),
    ("hide", None, True), ("restore", None, True), ("hard_delete", None, True),
    ("self_delete", None, True), ("auto_hide", None, True),
    ("hide", 1, False), ("restore", 1, False), ("hard_delete", 1, False),
    ("self_delete", 0, False), ("auto_hide", 3, False),
])
def test_mg_cleared_report_count_set_iff_dismiss_reports_and_positive(seeded, action, cleared, ok):
    conn, *_ = seeded
    call = lambda: _log(conn, uuid.uuid4(), action, reason="r", cleared=cleared)  # noqa: E731
    if ok:
        call()
    else:
        with pytest.raises(errors.CheckViolation):
            call()


def test_mg_cleared_report_count_is_a_nullable_integer(seeded):
    conn, *_ = seeded
    assert conn.execute(
        "SELECT data_type, is_nullable FROM information_schema.columns "
        "WHERE table_name='comment_moderation_log' AND column_name='cleared_report_count'"
    ).fetchone() == ("integer", "YES")


def test_mg14_enum_columns_are_varchar_with_check(seeded):
    conn, sermon, author, reporter = seeded
    with pytest.raises(errors.CheckViolation):
        _mk_comment(conn, sermon, author, status="DELETED")
    cid = _mk_comment(conn, sermon, author)
    with pytest.raises(errors.CheckViolation):
        conn.execute(
            "INSERT INTO sermon_comment_reports (id, comment_id, reporter_id, reason) "
            "VALUES (%s, %s, %s, 'bogus')", (uuid.uuid4(), cid, reporter))
    with pytest.raises(errors.CheckViolation):
        _log(conn, cid, "bogus", reason="r")
    # reason enum accepts all six documented values
    for i, reason in enumerate(["spam", "harassment", "hate", "sexual", "self_harm", "other"]):
        u = _mk_user(conn)
        conn.execute(
            "INSERT INTO sermon_comment_reports (id, comment_id, reporter_id, reason) "
            "VALUES (%s, %s, %s, %s)", (uuid.uuid4(), cid, u, reason))
    # no PG enum types, columns are varchar
    assert conn.execute("SELECT count(*) FROM pg_type WHERE typtype='e'").fetchone()[0] == 0
    types = dict(conn.execute(
        "SELECT table_name||'.'||column_name, data_type FROM information_schema.columns "
        "WHERE (table_name, column_name) IN (('sermon_comments','status'),"
        "('sermon_comment_reports','reason'),('comment_moderation_log','action'))"
    ).fetchall())
    assert set(types.values()) == {"character varying"} and len(types) == 3


def test_mg17_defaults_and_not_null(seeded):
    conn, sermon, author, _ = seeded
    cid = _mk_comment(conn, sermon, author)
    row = conn.execute(
        "SELECT report_count, hidden_auto, status, hidden_at, hidden_by_id, created_at "
        "FROM sermon_comments WHERE id=%s", (cid,)).fetchone()
    assert row[0] == 0 and row[1] is False and row[2] == "VISIBLE"
    assert row[3] is None and row[4] is None and row[5] is not None
    for col in ("report_count", "hidden_auto"):
        with pytest.raises(errors.NotNullViolation):
            _mk_comment(conn, sermon, author, **{col: None})
    assert conn.execute(
        "SELECT is_nullable FROM information_schema.columns WHERE table_name='users' "
        "AND column_name='comments_terms_accepted_at'").fetchone()[0] == "YES"


# --------------------------------------------------------------------------- #
# MG-15: FK behaviour
# --------------------------------------------------------------------------- #

def _count(conn, table, where="true", params=()):
    return conn.execute(f"SELECT count(*) FROM {table} WHERE {where}", params).fetchone()[0]


def test_mg15_delete_sermon_cascades_comments_and_reports_log_survives(conn):
    creator, author, reporter = _mk_user(conn), _mk_user(conn), _mk_user(conn)
    sermon = _mk_sermon(conn, creator)
    cid = _mk_comment(conn, sermon, author)
    conn.execute(
        "INSERT INTO sermon_comment_reports (id, comment_id, reporter_id, reason) "
        "VALUES (%s,%s,%s,'spam')", (uuid.uuid4(), cid, reporter))
    _log(conn, cid, "hide", reason="r")
    conn.execute("DELETE FROM sermons WHERE id=%s", (sermon,))
    assert _count(conn, "sermon_comments") == 0
    assert _count(conn, "sermon_comment_reports") == 0
    assert _count(conn, "comment_moderation_log") == 1


def test_mg15_delete_author_cascades_comments_reports_blocks_both_sides(conn):
    creator, author, other = _mk_user(conn), _mk_user(conn), _mk_user(conn)
    sermon = _mk_sermon(conn, creator)
    mine = _mk_comment(conn, sermon, author)
    theirs = _mk_comment(conn, sermon, other)
    # author reported someone else's comment; someone reported author's
    conn.execute("INSERT INTO sermon_comment_reports (id, comment_id, reporter_id, reason) "
                 "VALUES (%s,%s,%s,'spam')", (uuid.uuid4(), theirs, author))
    conn.execute("INSERT INTO sermon_comment_reports (id, comment_id, reporter_id, reason) "
                 "VALUES (%s,%s,%s,'spam')", (uuid.uuid4(), mine, other))
    conn.execute("INSERT INTO user_blocks (id, blocker_id, blocked_id) VALUES (%s,%s,%s)",
                 (uuid.uuid4(), author, other))
    conn.execute("INSERT INTO user_blocks (id, blocker_id, blocked_id) VALUES (%s,%s,%s)",
                 (uuid.uuid4(), other, author))
    _log(conn, mine, "hide", reason="r")
    conn.execute("DELETE FROM users WHERE id=%s", (author,))
    assert _count(conn, "sermon_comments", "id=%s", (mine,)) == 0
    assert _count(conn, "sermon_comments", "id=%s", (theirs,)) == 1
    assert _count(conn, "sermon_comment_reports") == 0  # both the filed and the received one
    assert _count(conn, "user_blocks") == 0
    assert _count(conn, "comment_moderation_log") == 1


def test_mg15_moderator_delete_sets_null(conn):
    creator, author, mod = _mk_user(conn), _mk_user(conn), _mk_user(conn, role="MANAGER")
    sermon = _mk_sermon(conn, creator)
    cid = _mk_comment(conn, sermon, author, status="HIDDEN", hidden_by_id=mod, hidden_reason="r")
    _log(conn, cid, "hide", reason="r", actor=mod)
    conn.execute("DELETE FROM users WHERE id=%s", (mod,))
    assert conn.execute("SELECT hidden_by_id FROM sermon_comments WHERE id=%s",
                        (cid,)).fetchone()[0] is None
    assert conn.execute("SELECT actor_id FROM comment_moderation_log").fetchone()[0] is None
    assert _count(conn, "comment_moderation_log") == 1


def test_mg15_log_survives_comment_deletion(conn):
    creator, author = _mk_user(conn), _mk_user(conn)
    sermon = _mk_sermon(conn, creator)
    cid = _mk_comment(conn, sermon, author)
    _log(conn, cid, "self_delete")
    conn.execute("DELETE FROM sermon_comments WHERE id=%s", (cid,))
    assert _count(conn, "comment_moderation_log", "comment_id=%s", (cid,)) == 1


# --------------------------------------------------------------------------- #
# MG-16: indexes
# --------------------------------------------------------------------------- #

def test_mg16_index_definitions(conn):
    defs = dict(conn.execute(
        "SELECT indexname, indexdef FROM pg_indexes WHERE tablename='sermon_comments'"
    ).fetchall())
    assert "(sermon_id, status, created_at DESC, id)" in defs["ix_sermon_comments_sermon_status_created"]
    assert "(user_id, created_at)" in defs["ix_sermon_comments_user_created"]
    assert "(status, created_at)" in defs["ix_sermon_comments_status_created"]
    assert "WHERE (report_count > 0)" in defs["ix_sermon_comments_reported"]


def test_mg16_planner_uses_list_and_partial_indexes(conn):
    creator, author = _mk_user(conn), _mk_user(conn)
    sermon = _mk_sermon(conn, creator)
    other_sermon = _mk_sermon(conn, creator)
    for i in range(200):
        conn.execute(
            "INSERT INTO sermon_comments (id, sermon_id, user_id, body, report_count, created_at) "
            "VALUES (%s,%s,%s,'b',%s, now() - make_interval(secs => %s))",
            (uuid.uuid4(), sermon if i % 2 else other_sermon, author, 1 if i % 50 == 0 else 0, i))
    conn.execute("ANALYZE sermon_comments")
    conn.execute("SET enable_seqscan = off")

    def plan(sql, params=()):
        return "\n".join(r[0] for r in conn.execute("EXPLAIN " + sql, params).fetchall())

    listing = plan(
        "SELECT id FROM sermon_comments WHERE sermon_id=%s AND status='VISIBLE' "
        "ORDER BY created_at DESC, id LIMIT 20", (sermon,))
    assert "ix_sermon_comments_sermon_status_created" in listing
    queue = plan("SELECT id FROM sermon_comments WHERE report_count > 0")
    assert "ix_sermon_comments_reported" in queue
