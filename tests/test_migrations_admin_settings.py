"""Migration round-trips for the admin-settings plan's three additive
migrations (`plans/plan-admin-settings.md` §A.4).

This file is **shared across three steps**, landing incrementally:

- S3: `sermon_play_daily` + `listener_day` (migration 1, revision
  `dbdcee764ca3`).
- S6: `audit_log` (migration 2, revision `8c596c67f0ae`) — adds its own
  round-trip + CHECK/JSONB/INET + no-FK cases, and the running combined
  chain test.
- S11: `church_settings` (migration 3, revision `e5a68425e539`) — adds its
  own round-trip + singleton + seed cases, and extends the combined chain
  test to cover all three.

Each step appends its own tests and does not rewrite another step's. The
harness below (`throwaway_db`, `_alembic`, `_columns`) follows the pattern
established in `tests/test_migration_roundtrip.py`: upgrade/downgrade against
a throwaway PostgreSQL database, inspected via `information_schema`. Skipped
module-wide when no PostgreSQL is reachable.

PostgreSQL-only for the round-trip/check tests below: they run real Alembic
DDL against a real server. The SQLite-boot test is deliberately the one
exception — it proves the plan's own claim (§A.4 preamble) that this
particular migration needs no `with_variant` Postgres-only type and the
existing SQLite suite (`tests/conftest.py` L48, `create_all` over
`Base.metadata`) still boots with the new models in place.
"""
from __future__ import annotations

import os
import subprocess
import sys
import uuid
from datetime import date
from pathlib import Path

import pytest

psycopg = pytest.importorskip("psycopg", reason="psycopg not installed")
from psycopg.conninfo import conninfo_to_dict  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]

# The revision this migration chains onto (current alembic head as of S0/S3)
# and this migration's own revision id, used as explicit downgrade targets —
# never a relative `-1`, for the same reason `test_migration_roundtrip.py`
# gives: a relative offset from *head* silently changes meaning once S6/S11
# chain more migrations on top.
_PRE_ROLLUPS_REVISION = "c9b3e7a1f2d4"
_ROLLUPS_REVISION = "dbdcee764ca3"
# Lands between rollups and audit: an unrelated pre-existing drift fix
# (`a517c3beba93`), not part of this plan — see that migration's own
# docstring. It is audit_log's actual immediate parent, not `_ROLLUPS_
# REVISION` above.
_PRE_AUDIT_REVISION = "a517c3beba93"
_AUDIT_REVISION = "8c596c67f0ae"
_CHURCH_SETTINGS_REVISION = "e5a68425e539"
# Sits on top of d9e0f1a2b3c4 and drops church_settings.comment_guidelines.
_PRE_DROP_GUIDELINES_REVISION = "d9e0f1a2b3c4"
_DROP_GUIDELINES_REVISION = "a7c3e9f1b2d4"

_CANDIDATE_DSNS = [
    os.environ.get("TEST_PG_DSN"),
    os.environ.get("DATABASE_URL", "").replace("postgresql+psycopg://", "postgresql://"),
    "postgresql://postgres:postgres@localhost:5432/postgres",
    "postgresql://postgres@localhost:5432/postgres",
    "postgresql://localhost:5432/postgres",
]


def _reachable_admin_dsn() -> str | None:
    for dsn in _CANDIDATE_DSNS:
        if not dsn:
            continue
        try:
            with psycopg.connect(dsn, connect_timeout=2) as conn:
                conn.execute("SELECT 1")
            return dsn
        except Exception:
            continue
    return None


_ADMIN_DSN = _reachable_admin_dsn()
if _ADMIN_DSN is None:
    pytest.skip(
        "no PostgreSQL reachable (set TEST_PG_DSN) — these migrations emit "
        "PostgreSQL DDL and cannot be round-tripped on SQLite",
        allow_module_level=True,
    )


def _auth_host(parts: dict) -> str:
    user = parts.get("user") or ""
    pw = parts.get("password")
    host = parts.get("host") or "localhost"
    port = parts.get("port") or "5432"
    auth = user + (f":{pw}" if pw else "")
    return f"{auth + '@' if auth else ''}{host}:{port}"


def _alembic(db_url: str, *args: str) -> str:
    env = {
        **os.environ,
        "DATABASE_URL": db_url,
        "SECRET_KEY": os.environ.get(
            "SECRET_KEY", "test-suite-signing-key-2b9f3a7c1e4d8065af12cd93"
        ),
        "REDIS_URL": os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
        "ENVIRONMENT": "development",
    }
    proc = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=REPO_ROOT, env=env, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise AssertionError(
            f"alembic {' '.join(args)} failed:\n{proc.stdout}\n{proc.stderr}"
        )
    return proc.stdout


def _columns(dsn: str, table: str) -> dict[str, tuple]:
    with psycopg.connect(dsn, connect_timeout=5) as conn:
        rows = conn.execute(
            "SELECT column_name, data_type, is_nullable, column_default "
            "FROM information_schema.columns WHERE table_name = %s "
            "ORDER BY column_name",
            (table,),
        ).fetchall()
    return {name: (dtype, nullable, default) for name, dtype, nullable, default in rows}


def _table_exists(dsn: str, table: str) -> bool:
    with psycopg.connect(dsn, connect_timeout=5) as conn:
        row = conn.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_name = %s", (table,)
        ).fetchone()
    return row is not None


@pytest.fixture
def throwaway_db():
    parts = conninfo_to_dict(_ADMIN_DSN)
    db_name = f"migrate_roundtrip_{uuid.uuid4().hex[:12]}"
    auth_host = _auth_host(parts)

    with psycopg.connect(_ADMIN_DSN, autocommit=True, connect_timeout=5) as conn:
        conn.execute(f'CREATE DATABASE "{db_name}"')
    try:
        yield (
            f"postgresql+psycopg://{auth_host}/{db_name}",  # alembic (async URL)
            f"postgresql://{auth_host}/{db_name}",          # psycopg inspection
        )
    finally:
        with psycopg.connect(_ADMIN_DSN, autocommit=True, connect_timeout=5) as conn:
            conn.execute(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname = %s AND pid <> pg_backend_pid()",
                (db_name,),
            )
            conn.execute(f'DROP DATABASE IF EXISTS "{db_name}"')


# ── S3: sermon_play_daily / listener_day ───────────────────────────────────


def test_rollup_migration_round_trip(throwaway_db):
    """`alembic upgrade head` -> downgrade past `dbdcee764ca3` -> `upgrade
    head` round-trips exactly: both tables appear, then genuinely disappear,
    then reappear with byte-identical column schemas.
    """
    alembic_url, inspect_dsn = throwaway_db

    _alembic(alembic_url, "upgrade", "head")
    assert _table_exists(inspect_dsn, "sermon_play_daily")
    assert _table_exists(inspect_dsn, "listener_day")
    play_daily_head = _columns(inspect_dsn, "sermon_play_daily")
    listener_day_head = _columns(inspect_dsn, "listener_day")
    assert play_daily_head["day"] == ("date", "NO", None)
    assert play_daily_head["sermon_id"] == ("uuid", "NO", None)
    assert play_daily_head["plays"][:2] == ("integer", "NO")
    assert play_daily_head["completions"][:2] == ("integer", "NO")
    assert play_daily_head["watched_seconds"][:2] == ("bigint", "NO")
    assert listener_day_head["day"] == ("date", "NO", None)
    assert listener_day_head["user_id"] == ("uuid", "NO", None)

    _alembic(alembic_url, "downgrade", _PRE_ROLLUPS_REVISION)
    assert not _table_exists(inspect_dsn, "sermon_play_daily")
    assert not _table_exists(inspect_dsn, "listener_day")

    _alembic(alembic_url, "upgrade", "head")
    assert _columns(inspect_dsn, "sermon_play_daily") == play_daily_head
    assert _columns(inspect_dsn, "listener_day") == listener_day_head


def test_rollup_pk_rejects_duplicate_day_sermon(throwaway_db):
    """`PK(day, sermon_id)` is a real composite key, not a surrogate id plus
    a unique constraint — a second row for the same (day, sermon) must
    violate the primary key, not silently insert a duplicate.
    """
    alembic_url, inspect_dsn = throwaway_db
    _alembic(alembic_url, "upgrade", "head")

    with psycopg.connect(inspect_dsn, autocommit=True, connect_timeout=5) as conn:
        conn.execute(
            "INSERT INTO users (id, email, password_hash) VALUES "
            "(%s, 'rollup-pk@example.com', 'x')",
            (str(uuid.uuid4()),),
        )
        user_id = conn.execute(
            "SELECT id FROM users WHERE email = 'rollup-pk@example.com'"
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO sermons (id, title, created_by, status) VALUES "
            "(%s, 'Rollup PK test', %s, 'draft')",
            (str(uuid.uuid4()), str(user_id)),
        )
        sermon_id = conn.execute(
            "SELECT id FROM sermons WHERE title = 'Rollup PK test'"
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO sermon_play_daily (day, sermon_id, plays, completions, "
            "watched_seconds) VALUES (%s, %s, 1, 0, 20)",
            (date(2026, 10, 17), str(sermon_id)),
        )
        with pytest.raises(Exception):
            conn.execute(
                "INSERT INTO sermon_play_daily (day, sermon_id, plays, completions, "
                "watched_seconds) VALUES (%s, %s, 1, 0, 20)",
                (date(2026, 10, 17), str(sermon_id)),
            )


def test_fk_cascade_sermon_play_daily_on_sermon_delete(throwaway_db):
    """Hard-deleting a sermon cascades to its `sermon_play_daily` rows
    (§A.2's accepted consequence: past report totals for that sermon drop).
    """
    alembic_url, inspect_dsn = throwaway_db
    _alembic(alembic_url, "upgrade", "head")

    with psycopg.connect(inspect_dsn, autocommit=True, connect_timeout=5) as conn:
        conn.execute(
            "INSERT INTO users (id, email, password_hash) VALUES "
            "(%s, 'cascade-sermon@example.com', 'x')",
            (str(uuid.uuid4()),),
        )
        user_id = conn.execute(
            "SELECT id FROM users WHERE email = 'cascade-sermon@example.com'"
        ).fetchone()[0]
        sermon_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO sermons (id, title, created_by, status) VALUES "
            "(%s, 'Cascade test sermon', %s, 'draft')",
            (sermon_id, str(user_id)),
        )
        conn.execute(
            "INSERT INTO sermon_play_daily (day, sermon_id, plays, completions, "
            "watched_seconds) VALUES (%s, %s, 3, 1, 90)",
            (date(2026, 10, 17), sermon_id),
        )
        assert conn.execute(
            "SELECT count(*) FROM sermon_play_daily WHERE sermon_id = %s", (sermon_id,)
        ).fetchone()[0] == 1

        conn.execute("DELETE FROM sermons WHERE id = %s", (sermon_id,))

        assert conn.execute(
            "SELECT count(*) FROM sermon_play_daily WHERE sermon_id = %s", (sermon_id,)
        ).fetchone()[0] == 0


def test_fk_cascade_listener_day_on_user_delete(throwaway_db):
    """Erasing a user cascades to their `listener_day` rows (§A.2: this is
    deliberately consistent with `playback_sessions.user_id`'s own CASCADE,
    and errs toward erasure over retaining a dangling personal-data row).
    """
    alembic_url, inspect_dsn = throwaway_db
    _alembic(alembic_url, "upgrade", "head")

    with psycopg.connect(inspect_dsn, autocommit=True, connect_timeout=5) as conn:
        user_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO users (id, email, password_hash) VALUES "
            "(%s, 'cascade-listener@example.com', 'x')",
            (user_id,),
        )
        conn.execute(
            "INSERT INTO listener_day (day, user_id) VALUES (%s, %s)",
            (date(2026, 10, 17), user_id),
        )
        assert conn.execute(
            "SELECT count(*) FROM listener_day WHERE user_id = %s", (user_id,)
        ).fetchone()[0] == 1

        conn.execute("DELETE FROM users WHERE id = %s", (user_id,))

        assert conn.execute(
            "SELECT count(*) FROM listener_day WHERE user_id = %s", (user_id,)
        ).fetchone()[0] == 0


async def test_sqlite_create_all_still_boots_with_new_models(engine):
    """The default test engine (`tests/conftest.py` L48, SQLite in-memory,
    `create_all` over all of `Base.metadata`) must keep booting once
    `SermonPlayDaily`/`ListenerDay` exist — confirming §A.4's claim that this
    particular migration needs no `with_variant` Postgres-only type and the
    tables are genuinely usable on both dialects, not just creatable.
    """
    from sqlalchemy import insert, select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import ListenerDay, Sermon, SermonPlayDaily, User

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        user = User(email="sqlite-rollup@example.com", password_hash="x")
        s.add(user)
        await s.flush()
        sermon = Sermon(title="SQLite rollup test", created_by=user.id)
        s.add(sermon)
        await s.flush()

        today = date(2026, 10, 17)
        await s.execute(
            insert(SermonPlayDaily).values(
                day=today, sermon_id=sermon.id, plays=1, completions=0,
                watched_seconds=20,
            )
        )
        await s.execute(insert(ListenerDay).values(day=today, user_id=user.id))
        await s.commit()

        rollup = (await s.execute(
            select(SermonPlayDaily).where(SermonPlayDaily.sermon_id == sermon.id)
        )).scalar_one()
        assert (rollup.day, rollup.plays, rollup.watched_seconds) == (today, 1, 20)

        listener_row = (await s.execute(
            select(ListenerDay).where(ListenerDay.user_id == user.id)
        )).scalar_one()
        assert listener_row.day == today


def test_rollup_migration_introduces_no_new_alembic_drift(throwaway_db):
    """`alembic check` compares the migrated schema against `Base.metadata`
    via autogenerate. At the moment this step lands, running it at head
    reports a **non-zero exit** — but every item in that diff is pre-existing
    drift on tables this plan never touches (`announcements`, `playback_
    sessions`, `sermons`, `subscriptions`), confirmed present at the prior
    head `c9b3e7a1f2d4` as well, i.e. before this migration existed at all.
    That's a plan-level finding flagged to the Conductor in the S3 status
    entry, not something S3 fixes (it's out of §A's scope and touches tables
    three other, unrelated features own).

    What this test actually proves, and the only claim S3 owns: upgrading to
    head (now including `dbdcee764ca3`) introduces **no new** drift —
    `sermon_play_daily`/`listener_day` appear in neither an `add_table` diff
    (ORM ahead of the migration) nor a `remove_*` diff (migration ahead of
    the ORM) in `alembic check`'s report. Deliberately does not assert on
    the overall exit code, so this test keeps meaning what it says if the
    pre-existing drift is ever cleaned up separately.
    """
    alembic_url, _inspect_dsn = throwaway_db
    _alembic(alembic_url, "upgrade", "head")

    env = {
        **os.environ,
        "DATABASE_URL": alembic_url,
        "SECRET_KEY": os.environ.get(
            "SECRET_KEY", "test-suite-signing-key-2b9f3a7c1e4d8065af12cd93"
        ),
        "REDIS_URL": os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
        "ENVIRONMENT": "development",
    }
    proc = subprocess.run(
        [sys.executable, "-m", "alembic", "check"],
        cwd=REPO_ROOT, env=env, capture_output=True, text=True,
    )
    combined = proc.stdout + proc.stderr
    assert "sermon_play_daily" not in combined, combined
    assert "listener_day" not in combined, combined


# ── S6: audit_log ────────────────────────────────────────────────────────


def test_audit_migration_round_trip(throwaway_db):
    """`alembic upgrade head` -> downgrade past `8c596c67f0ae` -> `upgrade
    head` round-trips exactly: `audit_log` appears, genuinely disappears,
    then reappears with byte-identical column schemas. Column shapes match
    §A.4.2 exactly, including the Postgres-only `inet`/`jsonb` types.
    """
    alembic_url, inspect_dsn = throwaway_db

    _alembic(alembic_url, "upgrade", "head")
    assert _table_exists(inspect_dsn, "audit_log")
    audit_head = _columns(inspect_dsn, "audit_log")
    assert audit_head["id"] == ("uuid", "NO", None)
    assert audit_head["created_at"][:2] == ("timestamp with time zone", "NO")
    assert audit_head["action"] == ("character varying", "NO", None)
    assert audit_head["outcome"] == ("character varying", "NO", None)
    assert audit_head["actor_id"] == ("uuid", "YES", None)
    assert audit_head["ip"][:2] == ("inet", "YES")
    assert audit_head["details"][:2] == ("jsonb", "NO")

    _alembic(alembic_url, "downgrade", _PRE_AUDIT_REVISION)
    assert not _table_exists(inspect_dsn, "audit_log")
    # The migration this one chains onto is untouched by its downgrade.
    assert _table_exists(inspect_dsn, "sermon_play_daily")

    _alembic(alembic_url, "upgrade", "head")
    assert _columns(inspect_dsn, "audit_log") == audit_head


def test_audit_check_constraint_rejects_unknown_action(throwaway_db):
    """The migration's own `CHECK`, not the ORM's `Enum` type — a raw insert
    against the alembic-created table, bypassing SQLAlchemy entirely."""
    alembic_url, inspect_dsn = throwaway_db
    _alembic(alembic_url, "upgrade", "head")

    with psycopg.connect(inspect_dsn, autocommit=True, connect_timeout=5) as conn:
        with pytest.raises(Exception):
            conn.execute(
                "INSERT INTO audit_log (id, action, outcome) VALUES (%s, %s, %s)",
                (str(uuid.uuid4()), "bogus.action", "success"),
            )


def test_audit_check_constraint_rejects_unknown_outcome(throwaway_db):
    alembic_url, inspect_dsn = throwaway_db
    _alembic(alembic_url, "upgrade", "head")

    with psycopg.connect(inspect_dsn, autocommit=True, connect_timeout=5) as conn:
        with pytest.raises(Exception):
            conn.execute(
                "INSERT INTO audit_log (id, action, outcome) VALUES (%s, %s, %s)",
                (str(uuid.uuid4()), "auth.login", "maybe"),
            )


def test_audit_jsonb_and_inet_roundtrip_via_migration(throwaway_db):
    """`details` (jsonb) and `ip` (inet) round-trip through the migration's
    own column types, inserted and read back via raw SQL — independent of
    the ORM's `_InetAsString`/`with_variant` wrapping, which is what
    `tests/test_audit_log.py` already covers at the ORM layer."""
    alembic_url, inspect_dsn = throwaway_db
    _alembic(alembic_url, "upgrade", "head")

    row_id = str(uuid.uuid4())
    with psycopg.connect(inspect_dsn, autocommit=True, connect_timeout=5) as conn:
        conn.execute(
            "INSERT INTO audit_log (id, action, outcome, ip, details) "
            "VALUES (%s, %s, %s, %s, %s)",
            (row_id, "settings.updated", "success", "203.0.113.42",
             '{"changed": ["contact_email"], "before": {"x": 1}, "after": {"x": 2}}'),
        )
        ip, details = conn.execute(
            "SELECT ip, details FROM audit_log WHERE id = %s", (row_id,)
        ).fetchone()
    assert str(ip) == "203.0.113.42"
    assert details == {
        "changed": ["contact_email"], "before": {"x": 1}, "after": {"x": 2},
    }


def test_audit_log_actor_id_survives_user_deletion_no_fk(throwaway_db):
    """§A.4.2's deliberate design: `actor_id` carries **no FK**, unlike
    `ApprovalLog`/`AnnouncementApprovalLog` (RESTRICT) or
    `CommentModerationLog` (SET NULL) — a hard account erasure must not be
    blocked by, or silently null out, its own audit trail. Proven here by
    deleting the referenced user and showing the audit row is completely
    untouched (not nulled, not cascaded, not rejected).
    """
    alembic_url, inspect_dsn = throwaway_db
    _alembic(alembic_url, "upgrade", "head")

    with psycopg.connect(inspect_dsn, autocommit=True, connect_timeout=5) as conn:
        user_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO users (id, email, password_hash) VALUES (%s, %s, 'x')",
            (user_id, "audit-no-fk@example.com"),
        )
        row_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO audit_log (id, action, outcome, actor_id, actor_email) "
            "VALUES (%s, 'user.role_changed', 'success', %s, %s)",
            (row_id, user_id, "audit-no-fk@example.com"),
        )

        conn.execute("DELETE FROM users WHERE id = %s", (user_id,))  # must not raise

        actor_id, actor_email = conn.execute(
            "SELECT actor_id, actor_email FROM audit_log WHERE id = %s", (row_id,)
        ).fetchone()
    assert str(actor_id) == user_id
    assert actor_email == "audit-no-fk@example.com"


def test_audit_migration_introduces_no_new_alembic_drift(throwaway_db):
    """Same scoped claim `test_rollup_migration_introduces_no_new_alembic_
    drift` makes for S3: `alembic check`'s pre-existing drift (subscriptions,
    sermons, announcements, playback_sessions — present since before this
    plan existed) is a separate, flagged, out-of-scope finding, not
    something this migration fixes. What this test actually proves:
    upgrading to head introduces **no new** drift involving `audit_log`.
    """
    alembic_url, _inspect_dsn = throwaway_db
    _alembic(alembic_url, "upgrade", "head")

    env = {
        **os.environ,
        "DATABASE_URL": alembic_url,
        "SECRET_KEY": os.environ.get(
            "SECRET_KEY", "test-suite-signing-key-2b9f3a7c1e4d8065af12cd93"
        ),
        "REDIS_URL": os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
        "ENVIRONMENT": "development",
    }
    proc = subprocess.run(
        [sys.executable, "-m", "alembic", "check"],
        cwd=REPO_ROOT, env=env, capture_output=True, text=True,
    )
    combined = proc.stdout + proc.stderr
    assert "audit_log" not in combined, combined


def test_combined_chain_upgrade_downgrade_upgrade_all_three(throwaway_db):
    """The "round-trips cleanly" chain test (DoD bullet: `alembic upgrade
    head` -> `downgrade` past all three additive migrations -> `upgrade
    head`): rollups, audit and church settings, each downgrade leaving the
    earlier ones in place.
    """
    alembic_url, inspect_dsn = throwaway_db

    _alembic(alembic_url, "upgrade", "head")
    assert _table_exists(inspect_dsn, "sermon_play_daily")
    assert _table_exists(inspect_dsn, "listener_day")
    assert _table_exists(inspect_dsn, "audit_log")
    assert _table_exists(inspect_dsn, "church_settings")

    _alembic(alembic_url, "downgrade", _AUDIT_REVISION)
    assert not _table_exists(inspect_dsn, "church_settings")
    assert _table_exists(inspect_dsn, "audit_log")  # unaffected

    _alembic(alembic_url, "downgrade", _PRE_AUDIT_REVISION)
    assert not _table_exists(inspect_dsn, "audit_log")
    assert _table_exists(inspect_dsn, "sermon_play_daily")  # unaffected

    _alembic(alembic_url, "downgrade", _PRE_ROLLUPS_REVISION)
    assert not _table_exists(inspect_dsn, "sermon_play_daily")
    assert not _table_exists(inspect_dsn, "listener_day")

    _alembic(alembic_url, "upgrade", "head")
    assert _table_exists(inspect_dsn, "sermon_play_daily")
    assert _table_exists(inspect_dsn, "listener_day")
    assert _table_exists(inspect_dsn, "audit_log")
    assert _table_exists(inspect_dsn, "church_settings")


# ── S11: church_settings ─────────────────────────────────────────────────


def _ts_comments_terms_text() -> str:
    """`COMMENTS_TERMS_TEXT` straight out of the mobile source, so a change
    on either side without the other fails here rather than in the app."""
    import re

    ts = (REPO_ROOT / "mobile/lib/content/commentsCompliance.ts").read_text(encoding="utf-8")
    match = re.search(r"export const COMMENTS_TERMS_TEXT = `(.*?)`;", ts, re.S)
    assert match, "COMMENTS_TERMS_TEXT template literal not found"
    text = match.group(1)
    # A template literal with escapes or interpolation would not be the
    # literal runtime string; refuse rather than compare the wrong thing.
    assert "\\" not in text and "${" not in text
    return text


def _original_guidelines() -> str:
    """The text `e5a68425e539` seeded and `_CANONICAL` freezes: the mobile
    constant minus the "Last updated" block GA0 added to the file. Pins the
    body byte-for-byte."""
    import re

    text = _ts_comments_terms_text()
    original, n = re.subn(r"^Last updated: [^\n]+\n\n", "", text, count=1, flags=re.M)
    assert n == 1, "mobile constant has no 'Last updated' line"
    return original


def test_church_settings_migration_round_trip(throwaway_db):
    alembic_url, inspect_dsn = throwaway_db

    _alembic(alembic_url, "upgrade", "head")
    cols = _columns(inspect_dsn, "church_settings")
    assert cols["id"][:2] == ("smallint", "NO")
    assert cols["contact_email"][:2] == ("character varying", "NO")
    assert "comment_guidelines" not in cols  # dropped by _DROP_GUIDELINES_REVISION
    assert cols["version"] == ("integer", "NO", "1")
    assert cols["updated_by_id"] == ("uuid", "YES", None)
    for nullable in ("church_name", "app_display_name", "tagline", "about",
                     "contact_phone", "website_url", "address",
                     "terms_of_use_url", "privacy_policy_url", "copyright_notice"):
        assert cols[nullable][1] == "YES", nullable

    _alembic(alembic_url, "downgrade", _AUDIT_REVISION)
    assert not _table_exists(inspect_dsn, "church_settings")
    assert _table_exists(inspect_dsn, "audit_log")

    _alembic(alembic_url, "upgrade", "head")
    assert _columns(inspect_dsn, "church_settings") == cols


def test_church_settings_seed_row(throwaway_db):
    """Runs at the revision that seeds the row; the column is dropped later."""
    alembic_url, inspect_dsn = throwaway_db
    _alembic(alembic_url, "upgrade", _CHURCH_SETTINGS_REVISION)

    with psycopg.connect(inspect_dsn, connect_timeout=5) as conn:
        rows = conn.execute(
            "SELECT id, church_name, app_display_name, contact_email, "
            "comment_guidelines, terms_of_use_url, privacy_policy_url, "
            "tagline, about, contact_phone, website_url, address, "
            "copyright_notice, version, updated_by_id FROM church_settings"
        ).fetchall()
    assert len(rows) == 1
    (id_, church, app_name, email, guidelines, terms, privacy,
     *others, version, updated_by) = rows[0]
    assert (id_, church, app_name, email) == (
        1, "Watered Garden Church", "RhemaPod", "contact@rhemapod.com",
    )
    assert guidelines == _original_guidelines()  # byte-for-byte
    assert guidelines.split("\n", 1)[0] == "RhemaPod Comment Guidelines"
    assert (terms, privacy) == (None, None)
    assert others == [None] * 6
    assert (version, updated_by) == (1, None)


def test_church_settings_check_rejects_a_second_row(throwaway_db):
    alembic_url, inspect_dsn = throwaway_db
    _alembic(alembic_url, "upgrade", "head")

    with psycopg.connect(inspect_dsn, autocommit=True, connect_timeout=5) as conn:
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute(
                "INSERT INTO church_settings (id, contact_email) "
                "VALUES (2, 'x@example.com')"
            )
        with pytest.raises(psycopg.errors.UniqueViolation):
            conn.execute(
                "INSERT INTO church_settings (id, contact_email) "
                "VALUES (1, 'x@example.com')"
            )


def test_church_settings_has_no_foreign_keys(throwaway_db):
    """`updated_by_id` is deliberately FK-free (like `audit_log.actor_id`):
    erasing the last editor's account must not touch or be blocked by the
    settings row."""
    alembic_url, inspect_dsn = throwaway_db
    _alembic(alembic_url, "upgrade", "head")

    with psycopg.connect(inspect_dsn, connect_timeout=5) as conn:
        fks = conn.execute(
            "SELECT count(*) FROM information_schema.table_constraints "
            "WHERE table_name = 'church_settings' AND constraint_type = 'FOREIGN KEY'"
        ).fetchone()[0]
    assert fks == 0


def test_church_settings_migration_introduces_no_alembic_drift(throwaway_db):
    """Since `a517c3beba93` cleaned up the pre-existing drift, the whole
    `alembic check` is expected clean at head, not just this table."""
    alembic_url, _inspect_dsn = throwaway_db
    _alembic(alembic_url, "upgrade", "head")
    out = _alembic(alembic_url, "check")
    assert "No new upgrade operations detected" in out


# ── ad5-amendment-1: drop church_settings.comment_guidelines ────────────────


def _guidelines_value(dsn: str) -> str:
    with psycopg.connect(dsn, connect_timeout=5) as conn:
        return conn.execute(
            "SELECT comment_guidelines FROM church_settings WHERE id = 1"
        ).fetchone()[0]


def test_drop_guidelines_upgrade_removes_the_column(throwaway_db):
    alembic_url, inspect_dsn = throwaway_db
    _alembic(alembic_url, "upgrade", _PRE_DROP_GUIDELINES_REVISION)
    assert "comment_guidelines" in _columns(inspect_dsn, "church_settings")

    _alembic(alembic_url, "upgrade", "head")
    assert "comment_guidelines" not in _columns(inspect_dsn, "church_settings")


def test_drop_guidelines_downgrade_restores_not_null_canonical_text(throwaway_db):
    alembic_url, inspect_dsn = throwaway_db
    _alembic(alembic_url, "upgrade", "head")
    assert "comment_guidelines" not in _columns(inspect_dsn, "church_settings")

    _alembic(alembic_url, "downgrade", _PRE_DROP_GUIDELINES_REVISION)
    col = _columns(inspect_dsn, "church_settings")["comment_guidelines"]
    assert col == ("text", "NO", None)  # TEXT NOT NULL, no server default
    assert _guidelines_value(inspect_dsn) == _original_guidelines()

    _alembic(alembic_url, "upgrade", "head")  # re-upgrade: guard passes on canonical text
    assert "comment_guidelines" not in _columns(inspect_dsn, "church_settings")


def test_drop_guidelines_upgrade_aborts_on_edited_text(throwaway_db):
    alembic_url, inspect_dsn = throwaway_db
    _alembic(alembic_url, "upgrade", _PRE_DROP_GUIDELINES_REVISION)
    with psycopg.connect(inspect_dsn, autocommit=True, connect_timeout=5) as conn:
        conn.execute("UPDATE church_settings SET comment_guidelines = 'edited'")

    with pytest.raises(AssertionError) as exc:
        _alembic(alembic_url, "upgrade", "head")
    assert "differs from the canonical text" in str(exc.value)
    assert "edited" not in str(exc.value)  # the stored text is not echoed

    # Nothing was dropped or changed.
    assert "comment_guidelines" in _columns(inspect_dsn, "church_settings")
    assert _guidelines_value(inspect_dsn) == "edited"
    assert "a7c3e9f1b2d4" not in _alembic(alembic_url, "current")


def test_drop_guidelines_canonical_matches_the_file_text():
    """`_CANONICAL` is the ORIGINAL text (what the database holds). The file
    adds only the GA0 "Last updated" line, so the two are equal once that
    block is removed. When the file text next changes for real, rewrite this
    to compare against a git-pinned constant instead (plan-ad5-amendment-1
    §G.3): the migration's frozen copy must never follow the file."""
    import importlib.util
    import re

    from app.content import COMMENT_GUIDELINES

    path = next((REPO_ROOT / "alembic/versions").glob(f"{_DROP_GUIDELINES_REVISION}_*.py"))
    spec = importlib.util.spec_from_file_location("drop_guidelines_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    without_date = re.sub(r"^Last updated: [^\n]+\n\n", "", COMMENT_GUIDELINES, count=1, flags=re.M)
    assert module._CANONICAL == without_date == _original_guidelines()
