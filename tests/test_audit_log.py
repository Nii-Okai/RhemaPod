"""`audit_log` schema, `audit_service`, and the retention purge script
(`plans/plan-admin-settings.md` §A.4.2/§A.6/§A.7, step S6).

Named per `status.md`'s S1 test strategy, scoped to what S6 actually builds.
S1's own DoD-4 block in this file (`test_staff_invited_writes_audit_row_...`,
the three audit-insert-failure-rollback cases, etc.) instruments real call
sites in `auth_service.py`/`admin_auth.py` — that's S7's and S8's work, not
this step's (S6 "only builds the schema and the service, nothing calls it").
Those cases land here once S7/S8 exist; see this step's `status.md` entry
for the explicit accounting. What *is* S6's own verification (quoting the
plan): "the round-trip passes. CHECK rejects an unknown action on Postgres.
`details` JSONB and `ip` INET round-trip on Postgres, and SQLite still
boots. The purge deletes or nulls exactly at the boundary." Plus K8's own
named case and two minimal direct tests of `record`/`record_detached`
(the units this step actually writes), per the usual "happy path + one
failure mode" bar — not named by S1, since S1's matrix maps to DoD bullets
and these two have no DoD bullet of their own yet (S7/S8 exercise them for
real).

Schema/CHECK/JSONB/INET/purge cases run on real Postgres (`pg_client`/
`pg_engine`) — dialect-specific by nature. The SQLite-boot case is the
deliberate exception, proving the `with_variant`/`_InetAsString` fallback
actually works on the dialect the rest of the suite runs on.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.models import AuditAction, AuditLog, AuditOutcome
from app.scripts.purge_audit_log import purge_audit_log
from app.services.audit_service import AuditContext, AuditTarget, record, record_detached

pytestmark = pytest.mark.asyncio

_SETTINGS_BASE_ENV = {
    "secret_key": "test-suite-signing-key-2b9f3a7c1e4d8065af12cd93",
    "database_url": "postgresql+psycopg://u:p@db/app",
    "redis_url": "redis://r:6379/0",
    "environment": "development",
}


@pytest.fixture
def sessions(pg_engine):
    return async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)


async def _seed(sessions, **kw) -> uuid.UUID:
    defaults = dict(
        action=AuditAction.SETTINGS_UPDATED,
        outcome=AuditOutcome.SUCCESS,
        created_at=datetime.now(UTC),
        details={},
    )
    row = AuditLog(**{**defaults, **kw})
    async with sessions() as s:
        s.add(row)
        await s.commit()
    return row.id


async def _get(sessions, row_id: uuid.UUID) -> AuditLog:
    async with sessions() as s:
        return (await s.execute(select(AuditLog).where(AuditLog.id == row_id))).scalar_one()


# ── CHECK constraint ────────────────────────────────────────────────────────


async def test_check_constraint_rejects_unknown_action(pg_client, pg_engine, sessions):
    """The CHECK, not the ORM's `Enum` type, is what's under test: a raw SQL
    insert bypasses SQLAlchemy's own Python-side enum validation, which
    would otherwise reject an unknown action before the statement ever
    reaches Postgres."""
    from sqlalchemy import text

    async with sessions() as s:
        with pytest.raises(IntegrityError):
            await s.execute(
                text(
                    "INSERT INTO audit_log (id, action, outcome) "
                    "VALUES (:id, :action, :outcome)"
                ),
                {"id": uuid.uuid4(), "action": "bogus.action", "outcome": "success"},
            )


async def test_check_constraint_rejects_unknown_outcome(pg_client, pg_engine, sessions):
    from sqlalchemy import text

    async with sessions() as s:
        with pytest.raises(IntegrityError):
            await s.execute(
                text(
                    "INSERT INTO audit_log (id, action, outcome) "
                    "VALUES (:id, :action, :outcome)"
                ),
                {"id": uuid.uuid4(), "action": "auth.login", "outcome": "maybe"},
            )


# ── JSONB / INET round-trip ─────────────────────────────────────────────────


async def test_details_jsonb_roundtrip(pg_client, pg_engine, sessions):
    details = {
        "changed": ["contact_email", "comment_guidelines"],
        "before": {"contact_email": "old@example.com"},
        "after": {"contact_email": "new@example.com"},
    }
    row_id = await _seed(sessions, action=AuditAction.SETTINGS_UPDATED, details=details)
    got = await _get(sessions, row_id)
    assert got.details == details
    assert isinstance(got.details["changed"], list)
    assert isinstance(got.details["before"], dict)


async def test_details_jsonb_default_is_empty_object(pg_client, pg_engine, sessions):
    """Omitting `details` entirely (a raw insert, not the ORM) still lands
    on `{}` via the column's own `server_default` — not NULL."""
    from sqlalchemy import text

    row_id = uuid.uuid4()
    async with sessions() as s:
        await s.execute(
            text("INSERT INTO audit_log (id, action, outcome) VALUES (:id, :action, :outcome)"),
            {"id": row_id, "action": "auth.logout", "outcome": "success"},
        )
        await s.commit()
    got = await _get(sessions, row_id)
    assert got.details == {}


async def test_ip_inet_roundtrip(pg_client, pg_engine, sessions):
    """Also guards the `_InetAsString` fix (`app/models/models.py`):
    psycopg 3 hands `inet` columns back as `ipaddress.IPv4Address`/
    `IPv6Address` by default, which would make `AuditLog.ip`'s Python type
    differ from SQLite's plain `str` if left uncorrected."""
    v4_id = await _seed(sessions, ip="203.0.113.42")
    v6_id = await _seed(sessions, ip="2001:db8::1")
    none_id = await _seed(sessions, ip=None)

    v4 = await _get(sessions, v4_id)
    v6 = await _get(sessions, v6_id)
    none_row = await _get(sessions, none_id)

    assert (v4.ip, type(v4.ip)) == ("203.0.113.42", str)
    assert (v6.ip, type(v6.ip)) == ("2001:db8::1", str)
    assert none_row.ip is None


# ── SQLite boot ──────────────────────────────────────────────────────────────


async def test_sqlite_boot_with_new_columns(engine):
    """The default test engine (SQLite in-memory, `create_all` over all of
    `Base.metadata`) must keep booting with `AuditLog` in place, and the
    table must be genuinely usable: `ip` falls back to a plain varchar and
    `details` to plain `JSON`, both of which this test exercises end to
    end, not just at `CREATE TABLE` time."""
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        row = AuditLog(
            action=AuditAction.LOGIN,
            outcome=AuditOutcome.SUCCESS,
            actor_id=uuid.uuid4(),
            actor_email="viewer@example.com",
            actor_role="viewer",
            ip="10.0.0.5",
            user_agent="pytest-sqlite",
            correlation_id="corr-1",
            details={"method": "password"},
        )
        s.add(row)
        await s.commit()
        row_id = row.id

    async with Session() as s:
        got = (await s.execute(select(AuditLog).where(AuditLog.id == row_id))).scalar_one()
        assert got.action == AuditAction.LOGIN
        assert got.ip == "10.0.0.5"
        assert got.details == {"method": "password"}


# ── audit_service.record / record_detached (the units this step writes) ────


async def test_record_adds_and_flushes_without_committing(pg_client, pg_engine, sessions):
    """`record()`'s whole contract (S7/S8 depend on it): the row is visible
    within the same transaction (flushed) but a rollback of the caller's
    transaction takes it with it — nothing commits on `record()`'s own."""
    async with sessions() as s:
        row = await record(
            s, AuditAction.ROLE_CHANGED,
            actor=None, target=AuditTarget(type="user", id=uuid.uuid4(), label="x@example.com"),
            details={"from": "editor", "to": "manager"}, outcome=AuditOutcome.SUCCESS,
            ctx=AuditContext(correlation_id="corr-2"),
        )
        assert row.id is not None
        # Visible mid-transaction (flushed).
        mid_txn = (await s.execute(select(AuditLog).where(AuditLog.id == row.id))).scalar_one_or_none()
        assert mid_txn is not None
        await s.rollback()

    async with sessions() as s:
        after_rollback = (
            await s.execute(select(AuditLog).where(AuditLog.id == row.id))
        ).scalar_one_or_none()
    assert after_rollback is None


async def test_record_detached_commits_own_session_and_is_fail_open(
    pg_client, pg_engine, sessions, monkeypatch,
):
    """Happy path: `record_detached` commits independently of any caller
    transaction — the row survives even though nothing here holds a
    transaction open. Failure mode: a genuinely broken insert (a real CHECK
    violation on `outcome`, not a mocked session) is swallowed — no
    exception reaches the caller, and `audit_write_failed` is logged. No
    ORM/session mocking: the failure is a real constraint violation against
    real Postgres, only the logger is swapped for a recorder (the
    codebase's own `capture_logs` convention, `tests/comments_pg.py`), to
    assert what was logged without parsing structlog's wire format."""
    events: list[dict] = []

    class _Recorder:
        def error(self, event, **kw):
            events.append({"event": event, **kw})

    import app.services.audit_service as audit_service_module

    # `record_detached` opens its own session via the module-level
    # `PrimarySession`, which is bound to the app's real configured engine
    # (`app/db/database.py`), not this test's `pg_engine` — same situation
    # `purge_comment_snapshots.py`'s own test (`test_pg_07_logs_only_counts`)
    # solves by swapping the name for a sessionmaker bound to the test
    # database. `sessions` here already *is* such a sessionmaker.
    monkeypatch.setattr(audit_service_module, "PrimarySession", sessions)

    # Happy path: committed independently, visible in a fresh session.
    await record_detached(
        AuditAction.LOGOUT, actor=None, target=None, details=None,
        outcome=AuditOutcome.SUCCESS, ctx=AuditContext(correlation_id="corr-3"),
    )
    async with sessions() as s:
        logout_rows = (
            await s.execute(select(AuditLog).where(AuditLog.action == AuditAction.LOGOUT))
        ).scalars().all()
    assert len(logout_rows) == 1

    # Failure mode: a real CHECK-constraint violation (outcome is a plain
    # SQLAlchemy Enum(native_enum=False) — it does not validate client-side,
    # so a value outside the enum reaches Postgres and is rejected there).
    monkeypatch.setattr(audit_service_module, "log", _Recorder())
    await record_detached(  # must not raise
        AuditAction.LOGIN, actor=None, target=None, details=None,
        outcome="not_a_real_outcome", ctx=AuditContext(correlation_id="corr-4"),
    )
    assert any(e["event"] == "audit_write_failed" for e in events)
    async with sessions() as s:
        login_rows = (
            await s.execute(select(AuditLog).where(AuditLog.action == AuditAction.LOGIN))
        ).scalars().all()
    assert login_rows == []  # the broken write never landed


# ── Retention purge (§A.7) ──────────────────────────────────────────────────

_NOW = datetime(2026, 10, 17, 12, 0, 0, tzinfo=UTC)
_365 = timedelta(days=365)


async def test_purge_deletes_auth_rows_past_retention_boundary(pg_client, pg_engine, sessions):
    """Boundary is strict, matching `purge_comment_snapshots.py`'s own rule:
    a row exactly 365 days old is kept until the *next* run."""
    older = await _seed(sessions, action=AuditAction.LOGIN, created_at=_NOW - _365 - timedelta(seconds=1))
    exact = await _seed(sessions, action=AuditAction.LOGIN, created_at=_NOW - _365)
    newer = await _seed(sessions, action=AuditAction.LOGIN, created_at=_NOW - _365 + timedelta(seconds=1))

    async with sessions() as s:
        deleted, nulled = await purge_audit_log(s, now=_NOW)
    assert (deleted, nulled) == (1, 0)

    async with sessions() as s:
        remaining_ids = {r.id for r in (await s.execute(select(AuditLog))).scalars().all()}
    assert older not in remaining_ids
    assert {exact, newer} <= remaining_ids

    # The next run takes the exact-boundary row.
    async with sessions() as s:
        deleted2, _ = await purge_audit_log(s, now=_NOW + timedelta(seconds=1))
    assert deleted2 == 1


async def test_purge_nulls_ip_ua_on_non_auth_rows_past_network_retention(pg_client, pg_engine, sessions):
    """Non-`auth.*` rows keep their row — only `ip`/`user_agent` are nulled."""
    row_id = await _seed(
        sessions, action=AuditAction.ROLE_CHANGED, outcome=AuditOutcome.SUCCESS,
        created_at=_NOW - _365 - timedelta(days=1),
        ip="203.0.113.1", user_agent="Mozilla/5.0 old-browser",
        actor_email="manager@example.com", details={"from": "editor", "to": "manager"},
    )

    async with sessions() as s:
        deleted, nulled = await purge_audit_log(s, now=_NOW)
    assert (deleted, nulled) == (0, 1)

    got = await _get(sessions, row_id)
    assert got.ip is None
    assert got.user_agent is None
    # Everything else about the row is untouched.
    assert got.action == AuditAction.ROLE_CHANGED
    assert got.actor_email == "manager@example.com"
    assert got.details == {"from": "editor", "to": "manager"}


async def test_purge_leaves_recent_rows_untouched(pg_client, pg_engine, sessions):
    recent_auth = await _seed(sessions, action=AuditAction.LOGIN, created_at=_NOW - timedelta(days=1))
    recent_other = await _seed(
        sessions, action=AuditAction.SETTINGS_UPDATED, created_at=_NOW - timedelta(days=1),
        ip="203.0.113.9", user_agent="recent-ua",
    )

    async with sessions() as s:
        deleted, nulled = await purge_audit_log(s, now=_NOW)
    assert (deleted, nulled) == (0, 0)

    assert (await _get(sessions, recent_auth)) is not None
    other = await _get(sessions, recent_other)
    assert other.ip == "203.0.113.9"
    assert other.user_agent == "recent-ua"


async def test_purge_halts_if_retention_values_unset():
    """§A.7: this plan "doesn't ship a number Isaac hasn't approved." The
    approved values (365/365) are the `Settings` fields' own defaults
    (`app/core/config.py`), matching every other retention knob in that
    file (`archive_source_retention_days`, `comments_auto_hide_threshold`,
    ...) — none of them are an optional/unset field a deploy could leave
    blank. What actually halts a bad value is `Field(..., ge=1)`: a
    non-positive override is rejected at process start (before the purge
    script, or anything else, could run with a meaningless window), which
    is this codebase's actual "ships with an approved number or refuses to
    boot" mechanism.
    """
    from app.core.config import Settings

    base = Settings(**_SETTINGS_BASE_ENV)
    assert base.audit_auth_retention_days == 365
    assert base.audit_network_retention_days == 365

    with pytest.raises(ValidationError):
        Settings(**_SETTINGS_BASE_ENV, audit_auth_retention_days=0)
    with pytest.raises(ValidationError):
        Settings(**_SETTINGS_BASE_ENV, audit_network_retention_days=-1)
