"""Smoke tests for app.scripts.seed_dev.

The seed script doubles as the Playwright fixture, so this pins the two things
the portal relies on: a spread of sermon statuses and the staff accounts. It
also pins the production guard.
"""
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.models.models import Sermon, User
from app.scripts import seed_dev

pytestmark = pytest.mark.asyncio


def _session_factory(engine):
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def test_seed_produces_status_spread_and_staff(engine):
    factory = _session_factory(engine)

    summary = await seed_dev.seed(session_factory=factory)

    assert summary.created is True
    # All six SermonStatus values are exercised; >= 5 distinct is the floor.
    assert len(summary.sermon_statuses) >= 5

    async with factory() as db:
        distinct_statuses = (await db.execute(
            select(func.count(func.distinct(Sermon.status)))
            .select_from(Sermon)
            .where(Sermon.title.like(f"{seed_dev.SEED_PREFIX}%"))
        )).scalar_one()
        assert distinct_statuses >= 5

        staff_emails = set((await db.execute(
            select(User.email).where(User.email.like(f"%@{seed_dev.SEED_EMAIL_DOMAIN}"))
        )).scalars().all())

    for email, _name, _role in seed_dev.STAFF:
        assert email in staff_emails
    editors = [r for _e, _n, r in seed_dev.STAFF if r.value == "editor"]
    managers = [r for _e, _n, r in seed_dev.STAFF if r.value == "manager"]
    assert len(editors) >= 2 and len(managers) >= 2


async def test_seed_is_idempotent_without_fresh(engine):
    factory = _session_factory(engine)
    await seed_dev.seed(session_factory=factory)

    async with factory() as db:
        before = (await db.execute(
            select(func.count()).select_from(Sermon)
        )).scalar_one()

    second = await seed_dev.seed(session_factory=factory)
    assert second.created is False

    async with factory() as db:
        after = (await db.execute(
            select(func.count()).select_from(Sermon)
        )).scalar_one()
    assert after == before


async def test_seed_fresh_rebuilds_cleanly(engine):
    factory = _session_factory(engine)
    await seed_dev.seed(session_factory=factory)
    # DATABASE_URL host in the suite is 'localhost' (loopback) → --force is
    # sufficient to confirm the DELETE in this non-interactive context.
    await seed_dev.seed(session_factory=factory, fresh=True, force=True)

    async with factory() as db:
        sermons = (await db.execute(
            select(func.count()).select_from(Sermon)
            .where(Sermon.title.like(f"{seed_dev.SEED_PREFIX}%"))
        )).scalar_one()
        users = (await db.execute(
            select(func.count()).select_from(User)
            .where(User.email.like(f"%@{seed_dev.SEED_EMAIL_DOMAIN}"))
        )).scalar_one()

    # Rebuilt exactly once — no duplicates from the second run.
    assert users == len(seed_dev.STAFF)
    assert sermons == 12


async def test_seed_refuses_in_production(engine, monkeypatch):
    monkeypatch.setattr(get_settings(), "environment", "production")
    with pytest.raises(SystemExit):
        await seed_dev.seed(session_factory=_session_factory(engine))


async def test_seed_refuses_unknown_environment(engine, monkeypatch):
    monkeypatch.setattr(get_settings(), "environment", "staging")
    with pytest.raises(SystemExit):
        await seed_dev.seed(session_factory=_session_factory(engine))


# ── DB-target guard (F2) ─────────────────────────────────────────────────────
PROD_LOOKING_URL = "postgresql+psycopg://app:pw@prod-db.internal.example.com:5432/app"


async def test_seed_refuses_prod_looking_database_url(engine, monkeypatch):
    """Default ENVIRONMENT=development is NOT enough: a prod DATABASE_URL host
    must still be refused so a laptop cannot seed (or --fresh DELETE) prod."""
    assert get_settings().environment == "development"
    monkeypatch.setattr(get_settings(), "database_url", PROD_LOOKING_URL)
    with pytest.raises(SystemExit):
        await seed_dev.seed(session_factory=_session_factory(engine))


async def test_build_guard_runs_when_called_directly(engine, monkeypatch):
    """The guard lives in _build itself — a caller that skips seed() cannot
    write seed accounts into an unvetted DB."""
    monkeypatch.setattr(get_settings(), "database_url", PROD_LOOKING_URL)
    async with _session_factory(engine)() as db:
        with pytest.raises(SystemExit):
            await seed_dev._build(db)


async def test_delete_seed_rows_guard_runs_when_called_directly(engine, monkeypatch):
    monkeypatch.setattr(get_settings(), "database_url", PROD_LOOKING_URL)
    async with _session_factory(engine)() as db:
        with pytest.raises(SystemExit):
            await seed_dev._delete_seed_rows(db, force=True)


async def test_seed_allows_allowlisted_db_host(engine, monkeypatch):
    monkeypatch.setattr(
        get_settings(),
        "database_url",
        "postgresql+psycopg://app:pw@my-dev-box.example.com/app",
    )
    monkeypatch.setenv("SEED_DEV_ALLOWED_DB_HOSTS", "my-dev-box.example.com, other")
    summary = await seed_dev.seed(session_factory=_session_factory(engine))
    assert summary.created is True


# ── --fresh confirmation gate ────────────────────────────────────────────────
async def test_fresh_refuses_without_confirmation_non_interactive(engine):
    factory = _session_factory(engine)
    await seed_dev.seed(session_factory=factory)
    with pytest.raises(SystemExit):
        # No confirm_delete_host, no force, stdin is not a tty under pytest.
        await seed_dev.seed(session_factory=factory, fresh=True)


async def test_fresh_accepts_matching_confirm_host(engine):
    factory = _session_factory(engine)
    await seed_dev.seed(session_factory=factory)
    # Suite DATABASE_URL host is 'localhost'.
    summary = await seed_dev.seed(
        session_factory=factory, fresh=True, confirm_delete_host="LOCALHOST"
    )
    assert summary.created is True


async def test_fresh_rejects_mismatched_confirm_host(engine):
    factory = _session_factory(engine)
    await seed_dev.seed(session_factory=factory)
    with pytest.raises(SystemExit):
        await seed_dev.seed(
            session_factory=factory, fresh=True, confirm_delete_host="postgres"
        )
