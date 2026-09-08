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
    await seed_dev.seed(session_factory=factory, fresh=True)

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
