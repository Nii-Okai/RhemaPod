"""Both Phase 2 migrations round-trip exactly.

`f5a6b7c8d9e0` (processed_webhooks.subscription_id) and `a6b7c8d9e0f1`
(users.activated_at) are additive. This module runs the sequence the acceptance
criteria call out — ``alembic upgrade head`` -> downgrade past both -> ``upgrade
head`` — against a throwaway PostgreSQL database and asserts the ``users`` and
``processed_webhooks`` column schemas are byte-identical before and after, and
that each column is genuinely gone once downgraded past it.

The downgrade target is the explicit revision id one below `f5a6b7c8d9e0`
(``e4f5a6b7c8d9``), not a relative ``-2`` — a relative offset from *head*
silently changes meaning every time a later migration is chained on top (as
happened when `b3c4d5e6f7a8`, sermons.publish_at, landed after
`a6b7c8d9e0f1`: ``-2`` from the new head only reached `a6b7c8d9e0f1`'s parent,
one short of where this test needs to land). An explicit revision id is head-
independent and stays correct regardless of how many migrations follow.

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


def test_phase2_migrations_roundtrip_users_and_processed_webhooks(throwaway_db):
    alembic_url, inspect_dsn = throwaway_db

    _alembic(alembic_url, "upgrade", "head")
    users_head = _columns(inspect_dsn, "users")
    webhooks_head = _columns(inspect_dsn, "processed_webhooks")
    assert users_head["activated_at"] == ("timestamp with time zone", "YES", None)
    assert "subscription_id" in webhooks_head

    _alembic(alembic_url, "downgrade", "e4f5a6b7c8d9")
    assert "activated_at" not in _columns(inspect_dsn, "users")
    assert "subscription_id" not in _columns(inspect_dsn, "processed_webhooks")

    _alembic(alembic_url, "upgrade", "head")
    assert _columns(inspect_dsn, "users") == users_head
    assert _columns(inspect_dsn, "processed_webhooks") == webhooks_head


def test_a6b7c8d9e0f1_backfills_pre_migration_rows_with_created_at(throwaway_db):
    """A row that predates ``a6b7c8d9e0f1`` is an account that has been in use →
    activated by definition. The ``upgrade`` backfill must stamp it (with its own
    ``created_at``), so ``resend_invite`` — which reads ``activated_at IS NULL``
    as "invite still pending" — cannot mint a working set-password link for it
    (security review of d3390d7, CWE-620/640).
    """
    alembic_url, inspect_dsn = throwaway_db

    # Schema as it stood *before* the activated_at migration.
    _alembic(alembic_url, "upgrade", "f5a6b7c8d9e0")
    with psycopg.connect(inspect_dsn, autocommit=True, connect_timeout=5) as conn:
        conn.execute(
            "INSERT INTO users (email, password_hash) VALUES (%s, %s)",
            ("legacy-active@example.com", "argon2-placeholder"),
        )
        assert "activated_at" not in _columns(inspect_dsn, "users")

    # Applying the migration adds the column AND backfills every existing row.
    _alembic(alembic_url, "upgrade", "head")
    with psycopg.connect(inspect_dsn, connect_timeout=5) as conn:
        activated_at, created_at = conn.execute(
            "SELECT activated_at, created_at FROM users WHERE email = %s",
            ("legacy-active@example.com",),
        ).fetchone()

    assert activated_at is not None, "pre-migration row left NULL — resendable"
    assert activated_at == created_at, "backfill must use the row's own created_at"


def test_a517c3beba93_collapses_subscriptions_unique_indexes(throwaway_db):
    """Pre-existing drift fix (found during ADMIN-SETTINGS S3's `alembic check`,
    unrelated to that plan): `a7b8c9d0e1f2` (the original subscriptions
    migration) created `user_id`/`provider_subscription_id` uniqueness as a
    separate non-unique index *plus* a separate unnamed unique constraint, but
    `Subscription.user_id`/`.provider_subscription_id` have declared
    `unique=True, index=True` — a single unique index — since the class was
    first written. `a517c3beba93` collapses each pair into the one unique
    index the model has always asked for, without renaming anything or
    touching data.

    Round-trips: pre-fix shape -> post-fix shape -> back to pre-fix shape on
    downgrade -> post-fix shape again on re-upgrade, and uniqueness is
    actually enforced (not just structurally present) at every stage.
    """
    alembic_url, inspect_dsn = throwaway_db

    # Schema as it stood before this fix: separate unique constraint + plain index.
    _alembic(alembic_url, "upgrade", "dbdcee764ca3")
    assert _constraint_names(inspect_dsn, "subscriptions", type_="UNIQUE") == {
        "subscriptions_user_id_key",
        "subscriptions_provider_subscription_id_key",
    }
    pre_fix_indexes = _index_names(inspect_dsn, "subscriptions")
    assert {
        "ix_subscriptions_user_id", "ix_subscriptions_provider_subscription_id",
    } <= pre_fix_indexes
    assert _unique_index_names(inspect_dsn, "subscriptions") == {
        "subscriptions_pkey",
        "subscriptions_user_id_key",
        "subscriptions_provider_subscription_id_key",
    }

    # Applying the fix: the unique constraints (and the index that backed
    # each one) are gone, and the two surviving plain indexes (same names
    # as before) are now unique themselves.
    _alembic(alembic_url, "upgrade", "head")
    assert _constraint_names(inspect_dsn, "subscriptions", type_="UNIQUE") == set()
    assert _index_names(inspect_dsn, "subscriptions") == pre_fix_indexes - {
        "subscriptions_user_id_key", "subscriptions_provider_subscription_id_key",
    }
    assert _unique_index_names(inspect_dsn, "subscriptions") == {
        "subscriptions_pkey",
        "ix_subscriptions_user_id",
        "ix_subscriptions_provider_subscription_id",
    }

    # Uniqueness is still actually enforced post-fix, not just reshaped away.
    with psycopg.connect(inspect_dsn, autocommit=True, connect_timeout=5) as conn:
        user_id = conn.execute(
            "INSERT INTO users (email, password_hash) VALUES (%s, %s) RETURNING id",
            ("drift-fix@example.com", "argon2-placeholder"),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO subscriptions (id, user_id, tier, status) "
            "VALUES (gen_random_uuid(), %s, 'FREE', 'ACTIVE')",
            (user_id,),
        )
        with pytest.raises(psycopg.errors.UniqueViolation):
            conn.execute(
                "INSERT INTO subscriptions (id, user_id, tier, status) "
                "VALUES (gen_random_uuid(), %s, 'FREE', 'ACTIVE')",
                (user_id,),
            )

    # Downgrade restores the original two-object shape exactly.
    _alembic(alembic_url, "downgrade", "dbdcee764ca3")
    assert _constraint_names(inspect_dsn, "subscriptions", type_="UNIQUE") == {
        "subscriptions_user_id_key",
        "subscriptions_provider_subscription_id_key",
    }
    assert _index_names(inspect_dsn, "subscriptions") == pre_fix_indexes
    assert _unique_index_names(inspect_dsn, "subscriptions") == {
        "subscriptions_pkey",
        "subscriptions_user_id_key",
        "subscriptions_provider_subscription_id_key",
    }

    # Re-upgrading lands on the fixed shape again.
    _alembic(alembic_url, "upgrade", "head")
    assert _constraint_names(inspect_dsn, "subscriptions", type_="UNIQUE") == set()
    assert _unique_index_names(inspect_dsn, "subscriptions") == {
        "subscriptions_pkey",
        "ix_subscriptions_user_id",
        "ix_subscriptions_provider_subscription_id",
    }
