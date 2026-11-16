"""Devotionals migration (`e7a1c3d5f9b2`, plans/plan-daily-devotional.md DV1)
round-trips exactly and its constraints hold on real PostgreSQL.

PostgreSQL only (the suite's SQLite DB is built from ``Base.metadata``, not
Alembic). Skipped when no PostgreSQL is reachable (honours ``TEST_PG_DSN``).
"""
from __future__ import annotations

import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

psycopg = pytest.importorskip("psycopg", reason="psycopg not installed")
from psycopg.conninfo import conninfo_to_dict  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]
REV = "e7a1c3d5f9b2"
PARENT = "d9c4e7a1f3b2"

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
        "no PostgreSQL reachable (set TEST_PG_DSN) — the Phase 2 migrations emit "
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


def _alembic(db_url: str, *args: str) -> None:
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


def _columns(dsn: str, table: str) -> dict[str, tuple]:
    with psycopg.connect(dsn, connect_timeout=5) as conn:
        rows = conn.execute(
            "SELECT column_name, data_type, is_nullable, column_default "
            "FROM information_schema.columns WHERE table_name = %s "
            "ORDER BY column_name",
            (table,),
        ).fetchall()
    return {name: (dtype, nullable, default) for name, dtype, nullable, default in rows}


def _index_names(dsn: str, table: str) -> set[str]:
    with psycopg.connect(dsn, connect_timeout=5) as conn:
        rows = conn.execute(
            "SELECT indexname FROM pg_indexes WHERE tablename = %s", (table,)
        ).fetchall()
    return {name for (name,) in rows}


def _unique_index_names(dsn: str, table: str) -> set[str]:
    with psycopg.connect(dsn, connect_timeout=5) as conn:
        rows = conn.execute(
            "SELECT c.relname FROM pg_index i "
            "JOIN pg_class c ON c.oid = i.indexrelid "
            "JOIN pg_class t ON t.oid = i.indrelid "
            "WHERE t.relname = %s AND i.indisunique",
            (table,),
        ).fetchall()
    return {name for (name,) in rows}


def _constraint_names(dsn: str, table: str, *, type_: str) -> set[str]:
    with psycopg.connect(dsn, connect_timeout=5) as conn:
        rows = conn.execute(
            "SELECT constraint_name FROM information_schema.table_constraints "
            "WHERE table_name = %s AND constraint_type = %s",
            (table, type_),
        ).fetchall()
    return {name for (name,) in rows}


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



def _insert_user(dsn: str) -> str:
    with psycopg.connect(dsn, autocommit=True) as conn:
        return str(conn.execute(
            "INSERT INTO users (email, password_hash) VALUES (%s, 'x') RETURNING id",
            (f"{uuid.uuid4().hex}@example.com",),
        ).fetchone()[0])


_BASE_COLS = (
    "id, title, status, passage_ref, passage_translation, passage_text, "
    "reflection_md, pray_question, pray_text, created_by"
)


def _insert(conn, user_id: str, *, date=None, evergreen=False, extra_cols="", extra_vals=()):
    cols = _BASE_COLS + ", date, is_evergreen" + extra_cols
    vals = [str(uuid.uuid4()), "T", "DRAFT", "Ps 1", "kjv", "1 Blessed", "r", "q", "p",
            user_id, date, evergreen, *extra_vals]
    placeholders = ", ".join(["%s"] * len(vals))
    conn.execute(f"INSERT INTO devotionals ({cols}) VALUES ({placeholders})", vals)


def test_devotionals_migration_roundtrips(throwaway_db):
    alembic_url, dsn = throwaway_db
    _alembic(alembic_url, "upgrade", "head")
    dev_cols = _columns(dsn, "devotionals")
    log_cols = _columns(dsn, "devotional_approval_log")
    settings_cols = _columns(dsn, "church_settings")
    assert "devotional_reading_fallback" in settings_cols
    assert "uq_devotionals_date" in _constraint_names(dsn, "devotionals", type_="UNIQUE")
    assert "ix_devotionals_date_status" in _index_names(dsn, "devotionals")

    _alembic(alembic_url, "downgrade", PARENT)
    assert _columns(dsn, "devotionals") == {}
    assert _columns(dsn, "devotional_approval_log") == {}
    assert not any(c.startswith("devotional_") for c in _columns(dsn, "church_settings"))

    _alembic(alembic_url, "upgrade", "head")
    assert _columns(dsn, "devotionals") == dev_cols
    assert _columns(dsn, "devotional_approval_log") == log_cols
    assert _columns(dsn, "church_settings") == settings_cols


def test_existing_settings_row_gets_defaults(throwaway_db):
    alembic_url, dsn = throwaway_db
    _alembic(alembic_url, "upgrade", "head")
    with psycopg.connect(dsn) as conn:
        row = conn.execute(
            "SELECT devotional_reading_fallback, devotional_allow_override, "
            "devotional_tts_rate_pct, devotional_publish_hour, devotional_gap_alert_days, "
            "devotional_still_seconds, devotional_default_translation FROM church_settings"
        ).fetchone()
    assert row == ("text", True, 90, 5, 14, 60, "kjv")


def test_constraints(throwaway_db):
    alembic_url, dsn = throwaway_db
    _alembic(alembic_url, "upgrade", "head")
    user = _insert_user(dsn)
    with psycopg.connect(dsn, autocommit=True) as conn:
        _insert(conn, user, date="2026-11-09")
        _insert(conn, user, evergreen=True)
        _insert(conn, user, evergreen=True)  # many evergreen rows are fine
        with pytest.raises(psycopg.errors.UniqueViolation):
            _insert(conn, user, date="2026-11-09")
        with pytest.raises(psycopg.errors.CheckViolation):
            _insert(conn, user, date="2026-11-10", evergreen=True)
        with pytest.raises(psycopg.errors.CheckViolation):
            _insert(conn, user, evergreen=False)  # no date but not evergreen
        with pytest.raises(psycopg.errors.CheckViolation):
            _insert(conn, user, date="2026-11-11", extra_cols=", moment_start_s",
                    extra_vals=(10,))
        with pytest.raises(psycopg.errors.CheckViolation):
            _insert(conn, user, date="2026-11-12",
                    extra_cols=", moment_start_s, moment_end_s", extra_vals=(10, 900))
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("UPDATE church_settings SET devotional_reading_fallback = 'audio'")
