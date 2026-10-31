"""Share-links S11: playlists private by default, on real Postgres.

Revision b4d8f2a6c1e9 backfills every playlists.is_public to false and flips
the server default. Its downgrade restores the default only (rows are not
restored).
"""
from __future__ import annotations

import uuid

import psycopg
import pytest

from tests.comments_pg import alembic_runner, pg_server, throwaway_db  # noqa: F401

REV = "b4d8f2a6c1e9"
PRE_REV = "a7c3e9f1b2d4"


def _ok(proc):
    assert proc.returncode == 0, f"alembic failed:\n{proc.stdout}\n{proc.stderr}"


def _default(dsn: str) -> str:
    with psycopg.connect(dsn) as c:
        return c.execute(
            "SELECT column_default FROM information_schema.columns "
            "WHERE table_name='playlists' AND column_name='is_public'"
        ).fetchone()[0]


def _seed(dsn: str) -> dict[str, uuid.UUID]:
    with psycopg.connect(dsn, autocommit=True) as c:
        uid = uuid.uuid4()
        c.execute(
            "INSERT INTO users (id, email, password_hash, role, is_active) "
            "VALUES (%s, %s, 'x', 'VIEWER', true)",
            (uid, f"{uid}@example.com"),
        )
        ids = {"public": uuid.uuid4(), "private": uuid.uuid4()}
        for name, pid in ids.items():
            c.execute(
                "INSERT INTO playlists (id, user_id, name, is_public) VALUES (%s, %s, %s, %s)",
                (pid, uid, name, name == "public"),
            )
        ids["user"] = uid
        return ids


def _flags(dsn: str) -> dict[str, bool]:
    with psycopg.connect(dsn) as c:
        return dict(c.execute("SELECT name, is_public FROM playlists").fetchall())


def _insert_default(dsn: str, uid: uuid.UUID, name: str) -> bool:
    with psycopg.connect(dsn, autocommit=True) as c:
        return c.execute(
            "INSERT INTO playlists (id, user_id, name) VALUES (%s, %s, %s) RETURNING is_public",
            (uuid.uuid4(), uid, name),
        ).fetchone()[0]


def test_upgrade_backfills_all_rows_private_and_flips_default(throwaway_db, alembic_runner):
    _ok(alembic_runner(throwaway_db.sa_url, "upgrade", PRE_REV))
    ids = _seed(throwaway_db.dsn)
    assert _flags(throwaway_db.dsn) == {"public": True, "private": False}
    assert _default(throwaway_db.dsn) == "true"

    _ok(alembic_runner(throwaway_db.sa_url, "upgrade", REV))

    assert _flags(throwaway_db.dsn) == {"public": False, "private": False}
    assert _default(throwaway_db.dsn) == "false"
    # a new row with the column omitted is private
    assert _insert_default(throwaway_db.dsn, ids["user"], "fresh") is False


def test_downgrade_restores_default_true_but_not_rows_then_upgrade_is_clean(throwaway_db, alembic_runner):
    url = throwaway_db.sa_url
    _ok(alembic_runner(url, "upgrade", PRE_REV))
    ids = _seed(throwaway_db.dsn)
    _ok(alembic_runner(url, "upgrade", REV))
    before = _flags(throwaway_db.dsn)

    _ok(alembic_runner(url, "downgrade", PRE_REV))
    assert _default(throwaway_db.dsn) == "true"
    assert _flags(throwaway_db.dsn) == before  # rows unchanged (all false); not restored
    assert _insert_default(throwaway_db.dsn, ids["user"], "after-down") is True

    # make one row public again, then re-upgrade: backfill runs again, cleanly
    _ok(alembic_runner(url, "upgrade", REV))
    assert set(_flags(throwaway_db.dsn).values()) == {False}
    assert _default(throwaway_db.dsn) == "false"
