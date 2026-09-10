"""Both Phase 2 migrations round-trip exactly.

`f5a6b7c8d9e0` (processed_webhooks.subscription_id) and `a6b7c8d9e0f1`
(users.activated_at) are additive. This module runs the sequence the acceptance
criteria call out — ``alembic upgrade head`` -> ``downgrade -2`` -> ``upgrade
head`` — against a throwaway PostgreSQL database and asserts the ``users`` and
``processed_webhooks`` column schemas are byte-identical before and after, and
that each column is genuinely gone at ``-2``.

PostgreSQL only: the migrations emit PG DDL (``postgresql.UUID`` etc.) and the
suite's SQLite DB is built from ``Base.metadata``, not Alembic. Skipped with a
reason when no PostgreSQL is reachable (honours ``TEST_PG_DSN``).
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


def test_phase2_migrations_roundtrip_users_and_processed_webhooks(throwaway_db):
    alembic_url, inspect_dsn = throwaway_db

    _alembic(alembic_url, "upgrade", "head")
    users_head = _columns(inspect_dsn, "users")
    webhooks_head = _columns(inspect_dsn, "processed_webhooks")
    assert users_head["activated_at"] == ("timestamp with time zone", "YES", None)
    assert "subscription_id" in webhooks_head

    _alembic(alembic_url, "downgrade", "-2")
    assert "activated_at" not in _columns(inspect_dsn, "users")
    assert "subscription_id" not in _columns(inspect_dsn, "processed_webhooks")

    _alembic(alembic_url, "upgrade", "head")
    assert _columns(inspect_dsn, "users") == users_head
    assert _columns(inspect_dsn, "processed_webhooks") == webhooks_head
