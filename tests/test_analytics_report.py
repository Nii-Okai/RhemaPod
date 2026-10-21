"""Usage reports (plan-admin-settings §A.5, D1, step S13).

`GET /admin/analytics/report` (manager+) and
`GET /admin/analytics/report/export` (admin only, CSV, fail-closed
`report.exported`). One fixed dataset over 1–14 Oct 2026 (1 Oct is a
Thursday), seeded straight into the rollup tables, so every number below
is checkable by hand. Main cases on real Postgres; one SQLite smoke case,
since the suite runs there and the SQL must stay dialect-neutral.
"""
from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.api.analytics as analytics_api
from app.models.models import (
    AuditAction,
    AuditLog,
    ListenerDay,
    PlaybackSession,
    Sermon,
    SermonPlayDaily,
    User,
    UserRole,
)
from app.services.analytics_service import csv_cell, report_csv, report_edges
from app.services.audit_service import AuditTarget

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"
REPORT = "/api/v1/admin/analytics/report"
EXPORT = "/api/v1/admin/analytics/report/export"
EVIL_TITLE = '=HYPERLINK("http://evil.example","click")'


def D(day: int) -> date:
    return date(2026, 10, day)


def at(day: int, hour: int = 12) -> datetime:
    return datetime(2026, 10, day, hour, tzinfo=UTC)


# ── pure helpers ────────────────────────────────────────────────────────────


def test_day_edges():
    assert report_edges(D(1), D(4), "day") == [D(1), D(2), D(3), D(4)]


def test_week_edges_cut_at_mondays_and_clip_both_ends():
    # Thu 1 Oct .. Wed 14 Oct (exclusive 15): Mondays 5 and 12 inside.
    assert report_edges(D(1), D(15), "week") == [D(1), D(5), D(12), D(15)]


def test_month_edges():
    assert report_edges(date(2026, 11, 20), date(2027, 2, 3), "month") == [
        date(2026, 11, 20), date(2026, 12, 1), date(2027, 1, 1),
        date(2027, 2, 1), date(2027, 2, 3),
    ]


@pytest.mark.parametrize(("raw", "out"), [
    ("Grace", "Grace"),
    ("=1+1", "'=1+1"),
    ("+tel", "'+tel"),
    ("-2", "'-2"),
    ("@sum", "'@sum"),
    ("\tx", "'\tx"),
    ("\rx", "\"'\rx\""),
    ("a,b", '"a,b"'),
    ('say "amen"', '"say ""amen"""'),
    (EVIL_TITLE, '"\'=HYPERLINK(""http://evil.example"",""click"")"'),
    (None, ""),
    (12, "12"),
])
def test_csv_cell_guards_formulas_then_quotes(raw, out):
    assert csv_cell(raw) == out


def test_csv_has_bom_and_crlf():
    body = report_csv({"series": [], "top_sermons": []}, "timeseries")
    assert body.startswith("﻿period_start,period_end,")
    assert body.endswith("\r\n")


# ── fixtures ────────────────────────────────────────────────────────────────


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
    """Two sermons, three listeners.

    sermon_play_daily (plays, completions, watched_seconds):
      A: 1 Oct (3, 1, 3600), 6 Oct (2, 0, 1800), 13 Oct (1, 1, 900)
      B: 2 Oct (5, 2, 7200), 30 Sep (9, 9, 9999)  <- before the period
    listener_day: u1 on 6 and 7 Oct (same week), u2 on 1 and 13 Oct,
      u3 on 30 Sep only.
    First-ever plays: u1 6 Oct, u2 1 Oct, u3 30 Sep (before the period).
    Viewer signups: u1 2 Oct, u2 3 Oct, u3 20 Sep; a staff account on 4 Oct
      (not a signup).
    """
    async with Session() as s:
        editor = User(email="ed@example.com", role=UserRole.EDITOR, password_hash=None,
                      created_at=at(4))
        u1 = User(email="u1@example.com", role=UserRole.VIEWER, password_hash=None,
                  created_at=at(2))
        u2 = User(email="u2@example.com", role=UserRole.VIEWER, password_hash=None,
                  created_at=at(3))
        u3 = User(email="u3@example.com", role=UserRole.VIEWER, password_hash=None,
                  created_at=datetime(2026, 9, 20, tzinfo=UTC))
        s.add_all([editor, u1, u2, u3])
        await s.flush()
        a = Sermon(title="Grace Abounds", created_by=editor.id)
        b = Sermon(title=EVIL_TITLE, created_by=editor.id)
        s.add_all([a, b])
        await s.flush()
        s.add_all([
            SermonPlayDaily(day=D(1), sermon_id=a.id, plays=3, completions=1, watched_seconds=3600),
            SermonPlayDaily(day=D(6), sermon_id=a.id, plays=2, completions=0, watched_seconds=1800),
            SermonPlayDaily(day=D(13), sermon_id=a.id, plays=1, completions=1, watched_seconds=900),
            SermonPlayDaily(day=D(2), sermon_id=b.id, plays=5, completions=2, watched_seconds=7200),
            SermonPlayDaily(day=date(2026, 9, 30), sermon_id=b.id, plays=9, completions=9,
                            watched_seconds=9999),
            ListenerDay(day=D(6), user_id=u1.id),
            ListenerDay(day=D(7), user_id=u1.id),
            ListenerDay(day=D(1), user_id=u2.id),
            ListenerDay(day=D(13), user_id=u2.id),
            ListenerDay(day=date(2026, 9, 30), user_id=u3.id),
            PlaybackSession(user_id=u1.id, sermon_id=a.id, first_played_at=at(6),
                            last_played_at=at(7)),
            PlaybackSession(user_id=u2.id, sermon_id=a.id, first_played_at=at(1),
                            last_played_at=at(13)),
            # u2's later debut on another sermon doesn't make them new again.
            PlaybackSession(user_id=u2.id, sermon_id=b.id, first_played_at=at(2),
                            last_played_at=at(2)),
            PlaybackSession(user_id=u3.id, sermon_id=b.id,
                            first_played_at=datetime(2026, 9, 30, tzinfo=UTC),
                            last_played_at=datetime(2026, 9, 30, tzinfo=UTC)),
        ])
        await s.commit()
        return {"a": a.id, "b": b.id}


@pytest.fixture
def pg_sessions(pg_engine):
    return async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture
async def pg(pg_client, pg_sessions):
    admin = await _headers(pg_client, pg_sessions, "admin@example.com", "admin")
    mgr = await _headers(pg_client, pg_sessions, "mgr@example.com", "manager")
    # The two staff accounts above were created "now", outside the period.
    ids = await _seed(pg_sessions)
    return pg_client, pg_sessions, admin, mgr, ids


async def _report(client, headers, start=1, end=15, granularity="week"):
    r = await client.get(REPORT, headers=headers, params={
        "from": D(start).isoformat(), "to": D(end).isoformat(), "granularity": granularity,
    })
    assert r.status_code == 200, r.text
    return r.json()


# ── report ──────────────────────────────────────────────────────────────────


async def test_kpis_cover_only_the_period(pg):
    client, _, _, mgr, _ = pg
    body = await _report(client, mgr)
    assert body["period"] == {"from": "2026-10-01", "to": "2026-10-15", "granularity": "week"}
    assert body["kpis"] == {
        "plays": 11,             # 3 + 2 + 1 + 5; 30 Sep excluded
        "completions": 4,
        "watch_hours": 3.8,      # 13500s = 3.75h
        "listeners": 2,          # u1, u2 (u3 only on 30 Sep)
        "new_listeners": 2,      # u1 (6 Oct), u2 (1 Oct)
        "signups": 2,            # u1, u2; staff and u3 excluded
    }
    assert body["data_available_from"] == "2026-09-30"


@pytest.mark.parametrize("granularity", ["day", "week", "month"])
async def test_buckets_reconcile_with_the_kpis(pg, granularity):
    client, _, _, mgr, _ = pg
    body = await _report(client, mgr, granularity=granularity)
    for measure in ("plays", "completions", "new_listeners", "signups"):
        assert sum(b[measure] for b in body["series"]) == body["kpis"][measure], measure
    assert body["series"][0]["start"] == "2026-10-01"
    assert body["series"][-1]["end"] == "2026-10-15"
    assert len(body["series"]) == {"day": 14, "week": 3, "month": 1}[granularity]


async def test_weekly_buckets(pg):
    client, _, _, mgr, _ = pg
    series = (await _report(client, mgr))["series"]
    assert [(b["start"], b["end"]) for b in series] == [
        ("2026-10-01", "2026-10-05"), ("2026-10-05", "2026-10-12"), ("2026-10-12", "2026-10-15"),
    ]
    assert [b["plays"] for b in series] == [8, 2, 1]
    # u1 listened on 6 and 7 Oct: one listener for that week, not two.
    assert [b["listeners"] for b in series] == [1, 1, 1]
    assert [b["new_listeners"] for b in series] == [1, 1, 0]


async def test_daily_listeners_count_each_day(pg):
    client, _, _, mgr, _ = pg
    series = (await _report(client, mgr, granularity="day"))["series"]
    by_day = {b["start"]: b["listeners"] for b in series}
    assert by_day["2026-10-06"] == 1 and by_day["2026-10-07"] == 1
    assert sum(by_day.values()) == 4  # u1 x2, u2 x2


async def test_top_sermons_in_period(pg):
    client, _, _, mgr, ids = pg
    top = (await _report(client, mgr))["top_sermons"]
    assert [(t["sermon_id"], t["plays"]) for t in top] == [
        (str(ids["a"]), 6), (str(ids["b"]), 5),  # B's 9 plays on 30 Sep excluded
    ]
    assert top[0]["watch_hours"] == 1.8


@pytest.mark.parametrize(("start", "end", "status"), [
    (date(2026, 1, 1), date(2027, 1, 3), 422),   # 367 days
    (date(2026, 1, 1), date(2027, 1, 2), 200),   # 366 days
    (D(5), D(5), 422),                           # empty
    (D(6), D(5), 422),                           # inverted
])
async def test_period_limits(pg, start, end, status):
    client, _, _, mgr, _ = pg
    r = await client.get(REPORT, headers=mgr, params={
        "from": start.isoformat(), "to": end.isoformat(), "granularity": "day",
    })
    assert r.status_code == status


async def test_unknown_granularity_is_422(pg):
    client, _, _, mgr, _ = pg
    r = await client.get(REPORT, headers=mgr, params={
        "from": "2026-10-01", "to": "2026-10-15", "granularity": "year",
    })
    assert r.status_code == 422


async def test_empty_database_reports_zeros(pg_client, pg_sessions):
    mgr = await _headers(pg_client, pg_sessions, "mgr@example.com", "manager")
    body = await _report(pg_client, mgr)
    assert body["data_available_from"] is None
    assert body["kpis"]["plays"] == 0 and body["top_sermons"] == []


# ── export ──────────────────────────────────────────────────────────────────


async def test_export_timeseries_csv(pg):
    client, Session, admin, _, _ = pg
    r = await client.get(EXPORT, headers=admin, params={
        "from": "2026-10-01", "to": "2026-10-15", "granularity": "week", "kind": "timeseries",
    })
    assert r.status_code == 200
    assert r.headers["content-type"] == "text/csv; charset=utf-8"
    assert r.headers["content-disposition"] == (
        'attachment; filename="rhemapod-timeseries-2026-10-01-to-2026-10-15.csv"'
    )
    raw = r.content
    assert raw.startswith("﻿".encode("utf-8"))
    lines = raw.decode("utf-8").lstrip("﻿").split("\r\n")
    assert lines[0] == (
        "period_start,period_end,plays,completions,watch_hours,listeners,new_listeners,signups"
    )
    assert lines[1] == "2026-10-01,2026-10-05,8,3,3.0,1,1,2"
    assert len(lines) == 5 and lines[-1] == ""


async def test_export_neutralises_formula_titles(pg):
    client, _, admin, _, ids = pg
    r = await client.get(EXPORT, headers=admin, params={
        "from": "2026-10-01", "to": "2026-10-15", "kind": "top_sermons",
    })
    assert r.status_code == 200
    body = r.content.decode("utf-8")
    assert f'{ids["b"]},"\'=HYPERLINK(""http://evil.example"",""click"")",5,2,2.0' in body


async def test_export_writes_report_exported(pg):
    client, Session, admin, _, _ = pg
    await client.get(EXPORT, headers=admin, params={
        "from": "2026-10-01", "to": "2026-10-15", "granularity": "day", "kind": "timeseries",
    })
    async with Session() as s:
        rows = list((await s.execute(
            select(AuditLog).where(AuditLog.action == AuditAction.REPORT_EXPORTED)
        )).scalars())
    assert len(rows) == 1
    assert rows[0].actor_email == "admin@example.com"
    assert rows[0].details == {
        "kind": "timeseries", "from": "2026-10-01", "to": "2026-10-15", "granularity": "day",
    }


async def test_export_is_fail_closed(pg, monkeypatch):
    """A real Postgres failure in the audit insert means no file at all."""
    client, Session, admin, _, _ = pg
    monkeypatch.setattr(
        analytics_api, "AuditTarget",
        lambda **kw: AuditTarget(**{**kw, "label": "x" * 500}),
    )
    with pytest.raises(DBAPIError):
        await client.get(EXPORT, headers=admin, params={
            "from": "2026-10-01", "to": "2026-10-15", "kind": "timeseries",
        })
    async with Session() as s:
        count = len(list((await s.execute(
            select(AuditLog).where(AuditLog.action == AuditAction.REPORT_EXPORTED)
        )).scalars()))
    assert count == 0


async def test_export_rejects_unknown_kind_and_bad_period(pg):
    client, _, admin, _, _ = pg
    bad_kind = await client.get(EXPORT, headers=admin, params={
        "from": "2026-10-01", "to": "2026-10-15", "kind": "everything",
    })
    too_long = await client.get(EXPORT, headers=admin, params={
        "from": "2026-01-01", "to": "2027-01-03", "kind": "timeseries",
    })
    assert bad_kind.status_code == too_long.status_code == 422


# ── authz (D1) ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("role", "report", "export"), [
    ("viewer", 403, 403), ("editor", 403, 403), ("manager", 200, 403), ("admin", 200, 200),
])
async def test_role_matrix(pg_client, pg_sessions, role, report, export):
    headers = await _headers(pg_client, pg_sessions, f"{role}.caller@example.com", role)
    params = {"from": "2026-10-01", "to": "2026-10-15"}
    assert (await pg_client.get(REPORT, headers=headers, params=params)).status_code == report
    r = await pg_client.get(EXPORT, headers=headers, params={**params, "kind": "timeseries"})
    assert r.status_code == export


# ── SQLite smoke ────────────────────────────────────────────────────────────


async def test_report_and_export_run_on_sqlite(client, engine):
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    admin = await _headers(client, Session, "admin@example.com", "admin")
    await _seed(Session)
    body = await _report(client, admin, granularity="week")
    assert body["kpis"]["plays"] == 11 and body["kpis"]["listeners"] == 2
    assert [b["listeners"] for b in body["series"]] == [1, 1, 1]
    r = await client.get(EXPORT, headers=admin, params={
        "from": "2026-10-01", "to": "2026-10-15", "kind": "top_sermons",
    })
    assert r.status_code == 200

