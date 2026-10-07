"""ADM-LIST-10 (plan S1): the comment list queries issue a constant number of
statements and the planner can use the e5f6a7b8c9d0 indexes.

Real Postgres. The SQL under test is captured from the live request path (the
engine's `before_cursor_execute` hook) and then EXPLAINed with its own bound
parameters, so the plan is the plan of the shipped query, not a hand-copy.
"""
from __future__ import annotations

import json
import re
import uuid

import pytest
from sqlalchemy import event, text

from tests.comments_pg import (  # noqa: F401
    db_rows,
    make_user,
    pg_client,
    pg_engine,
    pg_migrated_db,
    pg_server,
    published_sermon,
    redis_server,
    sessions,
)

API = "/api/v1"
ADMIN = f"{API}/admin/comments"
BULK = 20_000


class Capture:
    def __init__(self, engine):
        self.engine = engine.sync_engine
        self.statements: list[tuple[str, object]] = []

    def _hook(self, conn, cursor, statement, parameters, context, executemany):
        self.statements.append((statement, parameters))

    def __enter__(self):
        event.listen(self.engine, "before_cursor_execute", self._hook)
        return self

    def __exit__(self, *exc):
        event.remove(self.engine, "before_cursor_execute", self._hook)

    def on_comments(self):
        return [(s, p) for s, p in self.statements if "FROM sermon_comments" in s]


async def _seed_bulk(sessions, sermon_id: str, authors: list[uuid.UUID], n: int) -> None:
    """n comments on `sermon_id` plus n on a noise sermon, ~1% reported, a few auto-hidden."""
    async with sessions() as s:
        await s.execute(
            text(
                """
                INSERT INTO sermon_comments
                  (id, sermon_id, user_id, body, status, hidden_auto, report_count, created_at)
                SELECT gen_random_uuid(), :sid, (:authors)[1 + (g % :na)], 'Amen ' || g,
                       CASE WHEN g % 200 = 0 THEN 'HIDDEN' ELSE 'VISIBLE' END,
                       g % 200 = 0,
                       CASE WHEN g % 100 = 0 THEN 3 ELSE 0 END,
                       now() - make_interval(secs => g)
                FROM generate_series(1, :n) g
                """
            ).bindparams(sid=uuid.UUID(sermon_id), authors=authors, na=len(authors), n=n)
        )
        await s.execute(text("ANALYZE sermon_comments"))
        await s.commit()


async def _explain(engine, statement: str, params) -> str:
    async with engine.connect() as conn:
        await conn.exec_driver_sql("SET enable_seqscan = off")  # prove usable, not chosen
        rows = await conn.exec_driver_sql("EXPLAIN (FORMAT JSON) " + statement, params)
        return json.dumps(rows.scalar_one())


async def test_adm_list_10_statement_count_is_constant_in_page_size(
    pg_client, pg_engine, sessions, make_user, published_sermon, db_rows
):
    editor = await make_user(role="editor")
    viewer = await make_user(role="viewer")
    manager = await make_user(role="manager")
    authors = [(await make_user()).id for _ in range(5)]
    sid = await published_sermon(owner=editor)
    await _seed_bulk(sessions, sid, authors, 60)

    async def counts(url, headers, limit):
        with Capture(pg_engine) as cap:
            r = await pg_client.get(url, params={"limit": limit}, headers=headers)
        assert r.status_code == 200 and len(r.json()["items"]) == limit
        return len(cap.statements)

    for url, who in ((f"{API}/sermons/{sid}/comments", viewer), (ADMIN, manager)):
        small = await counts(url, who.headers, 2)
        large = await counts(url, who.headers, 50)
        assert small == large, f"{url}: {small} statements at limit=2, {large} at limit=50"


async def test_adm_list_10_plans_use_the_comment_indexes(
    pg_client, pg_engine, sessions, make_user, published_sermon
):
    editor = await make_user(role="editor")
    viewer = await make_user(role="viewer")
    manager = await make_user(role="manager")
    authors = [(await make_user()).id for _ in range(20)]
    sid = await published_sermon(owner=editor)
    other = await published_sermon(owner=editor, title="noise")
    await _seed_bulk(sessions, sid, authors, BULK)
    await _seed_bulk(sessions, other, authors, BULK)

    async def index_names(url, params, who) -> set[str]:
        with Capture(pg_engine) as cap:
            r = await pg_client.get(url, params={**params, "limit": 25}, headers=who.headers)
        assert r.status_code == 200, r.text
        found: set[str] = set()
        for stmt, args in cap.on_comments():
            found |= set(re.findall(r'"Index Name": "([^"]+)"', await _explain(pg_engine, stmt, args)))
        return found

    # Both the page query and its count query must be able to use the index.
    assert "ix_sermon_comments_sermon_status_created" in await index_names(
        f"{API}/sermons/{sid}/comments", {}, viewer
    )
    assert "ix_sermon_comments_reported" in await index_names(
        ADMIN, {"reported_only": "true"}, manager
    )
    assert "ix_sermon_comments_status_created" in await index_names(
        ADMIN, {"status": "HIDDEN"}, manager
    )


async def test_adm_list_10_needs_review_uses_the_partial_queue_index(
    pg_client, pg_engine, sessions, make_user, published_sermon
):
    editor = await make_user(role="editor")
    manager = await make_user(role="manager")
    authors = [(await make_user()).id for _ in range(20)]
    sid = await published_sermon(owner=editor)
    await _seed_bulk(sessions, sid, authors, BULK)
    with Capture(pg_engine) as cap:
        r = await pg_client.get(ADMIN, params={"needs_review": "true"}, headers=manager.headers)
    assert r.status_code == 200
    for stmt, args in cap.on_comments():
        assert "ix_sermon_comments_reported" in await _explain(pg_engine, stmt, args)
