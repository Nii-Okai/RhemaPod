"""Church settings API (plan-admin-settings §A.5, step S12).

`GET /settings/public` (no auth, cache-aside, weak ETag / 304),
`GET /admin/settings` and `PATCH /admin/settings` (manager+, optimistic
`version` lock, `settings.updated` audit row in the same transaction, cache
invalidated after commit).

Correctness-under-concurrency and rollback cases run on real Postgres
(`pg_client`); ETag/304 and invalidation run against a real Redis when one
is reachable (`TEST_REDIS_URL`), and the same cases also run on the suite's
FakeRedis so they never silently skip. The settings row is seeded the way
migration `e5a68425e539` seeds it, since the test databases are built with
`create_all`, not Alembic.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import re
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import app.content as content_module
import app.core.redis as redis_module
import app.services.settings_service as settings_service_module
from app.content import COMMENT_GUIDELINES, COMMENT_GUIDELINES_DIGEST
from app.models.models import AuditAction, AuditLog, ChurchSettings
from app.services.audit_service import AuditTarget
from tests.conftest import _fake

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"
PUBLIC = "/api/v1/settings/public"
ADMIN = "/api/v1/admin/settings"
REPO_ROOT = Path(__file__).resolve().parents[1]


def _mobile_terms_text() -> str:
    ts = (REPO_ROOT / "mobile/lib/content/commentsCompliance.ts").read_text(encoding="utf-8")
    m = re.search(r"export const COMMENTS_TERMS_TEXT = `(.*?)`;", ts, re.S)
    body = m.group(1)
    # A template literal with escapes or interpolation would not be the same
    # bytes as the runtime string; refuse to compare it.
    assert "\\" not in body and "${" not in body
    return body


async def _seed_settings(Session) -> None:
    async with Session() as s:
        s.add(ChurchSettings(
            id=1,
            church_name="Watered Garden Church",
            app_display_name="RhemaPod",
            contact_email="contact@rhemapod.com",
        ))
        await s.commit()


async def _headers(client, Session, email: str, role: str) -> dict:
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    if role != "viewer":
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


async def _row(Session) -> ChurchSettings:
    async with Session() as s:
        return (await s.execute(select(ChurchSettings))).scalar_one()


async def _settings_audit_rows(Session) -> list[AuditLog]:
    async with Session() as s:
        return list((await s.execute(
            select(AuditLog).where(AuditLog.action == AuditAction.SETTINGS_UPDATED)
        )).scalars())


@pytest.fixture
def pg_sessions(pg_engine):
    return async_sessionmaker(pg_engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture
def sqlite_sessions(engine):
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture
async def pg(pg_client, pg_sessions):
    """Seeded Postgres app + a manager's headers."""
    await _seed_settings(pg_sessions)
    mgr = await _headers(pg_client, pg_sessions, "mgr@example.com", "manager")
    return pg_client, pg_sessions, mgr


@pytest_asyncio.fixture
async def lite(client, sqlite_sessions):
    """Seeded SQLite app + a manager's headers."""
    await _seed_settings(sqlite_sessions)
    mgr = await _headers(client, sqlite_sessions, "mgr@example.com", "manager")
    return client, sqlite_sessions, mgr


# ── Real Redis (cache-aside + invalidation proven on the real thing) ───────

_TEST_REDIS_DB = os.environ.get("TEST_REDIS_DB", "15")
_REDIS_URLS = [os.environ.get("TEST_REDIS_URL"), f"redis://localhost:6379/{_TEST_REDIS_DB}"]


def _reachable_redis_url() -> str | None:
    import redis as redis_sync

    for url in _REDIS_URLS:
        if not url:
            continue
        try:
            c = redis_sync.Redis.from_url(url, socket_connect_timeout=2)
            c.ping()
            c.close()
            return url
        except Exception:
            continue
    return None


_REAL_REDIS_URL = _reachable_redis_url()


@pytest_asyncio.fixture(params=["fake", "real"])
async def redis_backend(request, monkeypatch):
    """Runs a case on the suite's FakeRedis and, when reachable, on a real
    Redis (dedicated DB index, flushed before and after)."""
    if request.param == "fake":
        yield _fake
        return
    if _REAL_REDIS_URL is None:
        pytest.skip("no Redis reachable (set TEST_REDIS_URL)")
    import redis.asyncio as redis_lib

    real = redis_lib.Redis.from_url(_REAL_REDIS_URL, decode_responses=True)
    await real.flushdb()
    monkeypatch.setattr(redis_module, "get_redis", lambda: real)
    monkeypatch.setattr(settings_service_module, "get_redis", lambda: real)
    try:
        yield real
    finally:
        await real.flushdb()
        await real.aclose()


# ── GET /settings/public ────────────────────────────────────────────────────


async def test_public_settings_need_no_auth(lite):
    client, _, _ = lite
    r = await client.get(PUBLIC)
    assert r.status_code == 200
    body = r.json()
    assert body["contact_email"] == "contact@rhemapod.com"
    assert body["comment_guidelines"] == COMMENT_GUIDELINES
    assert body["terms_of_use_url"] is None and body["privacy_policy_url"] is None
    assert body["version"] == 1
    assert "updated_by" not in body and "updated_by_id" not in body
    assert r.headers["etag"] == f'W/"1-{COMMENT_GUIDELINES_DIGEST}"'
    assert r.headers["cache-control"] == "public, max-age=300"


async def test_public_settings_304_on_matching_etag(lite, redis_backend):
    client, _, _ = lite
    etag = (await client.get(PUBLIC)).headers["etag"]

    for header in (etag, etag[2:], f'"9", {etag}', "*"):
        r = await client.get(PUBLIC, headers={"If-None-Match": header})
        assert r.status_code == 304, header
        assert r.content == b""
        assert r.headers["etag"] == etag

    r = await client.get(PUBLIC, headers={"If-None-Match": 'W/"0"'})
    assert r.status_code == 200
    # A pre-digest validator ('W/"1"') must not 304 a body whose guidelines
    # may have changed in a deploy.
    for stale in ('W/"1"', '"1"'):
        r = await client.get(PUBLIC, headers={"If-None-Match": stale})
        assert r.status_code == 200, stale


async def test_digest_change_changes_etag_and_cache_key(lite, redis_backend, monkeypatch):
    client, _, _ = lite
    old_etag = (await client.get(PUBLIC)).headers["etag"]
    old_key = settings_service_module.public_cache_key()
    assert old_key == f"settings:public:v2:{COMMENT_GUIDELINES_DIGEST}"
    assert await redis_backend.get(old_key) is not None

    monkeypatch.setattr(content_module, "COMMENT_GUIDELINES_DIGEST", "0123456789ab")
    r = await client.get(PUBLIC)
    assert r.headers["etag"] == 'W/"1-0123456789ab"' != old_etag
    assert settings_service_module.public_cache_key() == "settings:public:v2:0123456789ab"
    assert await redis_backend.get("settings:public:v2:0123456789ab") is not None
    # The old validator no longer 304s.
    assert (await client.get(PUBLIC, headers={"If-None-Match": old_etag})).status_code == 200


async def test_public_settings_are_cached(lite, redis_backend):
    """Cache-aside: once cached, a DB change that bypasses the service (so
    nothing invalidates) is not visible until the key goes."""
    client, Session, _ = lite
    await client.get(PUBLIC)
    async with Session() as s:
        await s.execute(text("UPDATE church_settings SET tagline = 'sneaky'"))
        await s.commit()

    assert (await client.get(PUBLIC)).json()["tagline"] is None
    await redis_backend.delete(settings_service_module.public_cache_key())
    assert (await client.get(PUBLIC)).json()["tagline"] == "sneaky"


async def test_public_settings_still_200_when_redis_is_down(lite):
    client, _, _ = lite
    with _fake.failing():
        r = await client.get(PUBLIC)
    assert r.status_code == 200
    assert r.json()["contact_email"] == "contact@rhemapod.com"


async def test_patch_invalidates_the_public_cache(lite, redis_backend):
    client, _, mgr = lite
    assert (await client.get(PUBLIC)).json()["privacy_policy_url"] is None  # now cached

    r = await client.patch(ADMIN, json={
        "version": 1, "privacy_policy_url": "https://wateredgarden.org/privacy",
    }, headers=mgr)
    assert r.status_code == 200

    after = await client.get(PUBLIC)
    assert after.json()["privacy_policy_url"] == "https://wateredgarden.org/privacy"
    assert after.headers["etag"] == f'W/"2-{COMMENT_GUIDELINES_DIGEST}"'
    # The old validator no longer matches.
    stale = await client.get(PUBLIC, headers={"If-None-Match": f'W/"1-{COMMENT_GUIDELINES_DIGEST}"'})
    assert stale.status_code == 200


# ── GET/PATCH /admin/settings: authz ────────────────────────────────────────


@pytest.mark.parametrize(("role", "status"), [
    ("viewer", 403), ("editor", 403), ("manager", 200), ("admin", 200),
])
async def test_role_matrix(lite, role, status):
    client, Session, _ = lite
    headers = await _headers(client, Session, f"{role}.caller@example.com", role)
    assert (await client.get(ADMIN, headers=headers)).status_code == status
    r = await client.patch(ADMIN, json={"version": 1, "tagline": f"by {role}"}, headers=headers)
    assert r.status_code == status


async def test_anonymous_admin_settings_is_401(lite):
    client, _, _ = lite
    assert (await client.get(ADMIN)).status_code == 401
    assert (await client.patch(ADMIN, json={"version": 1})).status_code == 401


# ── PATCH semantics ─────────────────────────────────────────────────────────


async def test_patch_updates_bumps_version_and_records_editor(pg):
    client, Session, mgr = pg
    r = await client.patch(ADMIN, json={
        "version": 1, "tagline": "  Rooted in the Word  ", "contact_phone": "+233 20 000 0000",
    }, headers=mgr)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tagline"] == "Rooted in the Word"  # normalised
    assert body["version"] == 2
    assert body["updated_by"] == "mgr@example.com"

    got = await client.get(ADMIN, headers=mgr)
    assert got.json()["tagline"] == "Rooted in the Word"
    assert got.json()["updated_by"] == "mgr@example.com"


async def test_patch_writes_one_audit_row_with_before_and_after(pg):
    client, Session, mgr = pg
    r = await client.patch(ADMIN, json={
        "version": 1,
        "contact_email": "hello@wateredgarden.org",
        "church_name": "Watered Garden Church",  # unchanged: not audited
        "website_url": "https://wateredgarden.org",
    }, headers=mgr)
    assert r.status_code == 200

    rows = await _settings_audit_rows(Session)
    assert len(rows) == 1
    row = rows[0]
    assert row.actor_email == "mgr@example.com"
    assert row.target_type == "church_settings"
    assert row.details == {
        "changed": ["contact_email", "website_url"],
        "before": {"contact_email": "contact@rhemapod.com", "website_url": None},
        "after": {
            "contact_email": "hello@wateredgarden.org",
            "website_url": "https://wateredgarden.org",
        },
    }


async def test_noop_patch_writes_nothing(pg):
    client, Session, mgr = pg
    r = await client.patch(ADMIN, json={"version": 1, "church_name": "Watered Garden Church"},
                           headers=mgr)
    assert r.status_code == 200
    assert r.json()["version"] == 1
    assert await _settings_audit_rows(Session) == []


async def test_stale_version_is_409(pg):
    client, Session, mgr = pg
    assert (await client.patch(ADMIN, json={"version": 1, "tagline": "a"}, headers=mgr)).status_code == 200
    r = await client.patch(ADMIN, json={"version": 1, "tagline": "b"}, headers=mgr)
    assert r.status_code == 409
    assert (await _row(Session)).tagline == "a"
    # A no-op with a stale version is still a 409: the editor's view is old.
    r = await client.patch(ADMIN, json={"version": 1}, headers=mgr)
    assert r.status_code == 409


async def test_concurrent_patches_with_same_version_one_wins(pg):
    """Both requests pass the version read; the `UPDATE ... WHERE version`
    on real Postgres lets exactly one through."""
    client, Session, mgr = pg
    results = await asyncio.gather(*[
        client.patch(ADMIN, json={"version": 1, "tagline": f"editor {i}"}, headers=mgr)
        for i in range(4)
    ])
    codes = sorted(r.status_code for r in results)
    assert codes == [200, 409, 409, 409]

    row = await _row(Session)
    assert row.version == 2
    winner = next(r for r in results if r.status_code == 200).json()["tagline"]
    assert row.tagline == winner
    assert len(await _settings_audit_rows(Session)) == 1


async def test_failed_audit_insert_rolls_back_the_settings_change(pg, monkeypatch):
    """A real Postgres failure in the audit insert (target_label overflows
    varchar(200)) must take the settings change down with it."""
    client, Session, mgr = pg
    monkeypatch.setattr(
        settings_service_module, "AuditTarget",
        lambda **kw: AuditTarget(**{**kw, "label": "x" * 500}),
    )
    with pytest.raises(DBAPIError):
        await client.patch(ADMIN, json={"version": 1, "tagline": "lost"}, headers=mgr)

    row = await _row(Session)
    assert (row.tagline, row.version) == (None, 1)
    assert await _settings_audit_rows(Session) == []


async def test_clearing_an_optional_field_with_null(pg):
    client, Session, mgr = pg
    await client.patch(ADMIN, json={"version": 1, "tagline": "x"}, headers=mgr)
    r = await client.patch(ADMIN, json={"version": 2, "tagline": None}, headers=mgr)
    assert r.status_code == 200
    assert r.json()["tagline"] is None


# ── validation ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("payload", [
    {"tagline": "x"},                                          # version missing
    {"version": 1, "contact_email": None},                     # required, can't clear
    {"version": 1, "contact_email": "not-an-email"},
    {"version": 1, "comment_guidelines": "Be kind"},           # no longer editable
    {"version": 1, "comment_guidelines": None},
    {"version": 1, "privacy_policy_url": "http://wateredgarden.org/privacy"},
    {"version": 1, "terms_of_use_url": "javascript:alert(1)"},
    {"version": 1, "website_url": "https://"},
    {"version": 1, "website_url": "https://example.com/a b"},
    {"version": 1, "website_url": "https://example.com/" + "a" * 2048},
    {"version": 1, "church_name": "c" * 201},
    {"version": 1, "updated_by_id": None},                    # not editable
    {"version": 0, "tagline": "x"},
])
async def test_invalid_patches_are_422(lite, payload):
    client, Session, mgr = lite
    r = await client.patch(ADMIN, json=payload, headers=mgr)
    assert r.status_code == 422, payload
    assert (await _row(Session)).version == 1


async def test_patch_carrying_guidelines_is_extra_forbidden(lite):
    client, Session, mgr = lite
    r = await client.patch(ADMIN, json={"version": 1, "comment_guidelines": "x"}, headers=mgr)
    assert r.status_code == 422
    err = r.json()["errors"][0]
    assert (err["field"], err["type"]) == ("comment_guidelines", "extra_forbidden")
    assert (await _row(Session)).version == 1


async def test_patch_without_guidelines_still_works_and_bumps_version(lite):
    client, _, mgr = lite
    r = await client.patch(ADMIN, json={"version": 1, "tagline": "Hi"}, headers=mgr)
    assert r.status_code == 200
    assert r.json()["version"] == 2
    assert r.json()["comment_guidelines"] == COMMENT_GUIDELINES


async def test_admin_get_returns_file_text(lite):
    client, _, mgr = lite
    r = await client.get(ADMIN, headers=mgr)
    assert r.status_code == 200
    assert r.json()["comment_guidelines"] == COMMENT_GUIDELINES


# ── the guidelines file is the source of truth ──────────────────────────────


async def test_guidelines_file_matches_mobile_fallback_byte_for_byte():
    assert COMMENT_GUIDELINES == _mobile_terms_text()


async def test_guidelines_file_shape():
    raw = (REPO_ROOT / "app/content/comment_guidelines.txt").read_bytes()
    assert raw.endswith(b"\n") and not raw.endswith(b"\n\n")
    assert raw.decode("utf-8").removesuffix("\n") == COMMENT_GUIDELINES
    assert COMMENT_GUIDELINES.split("\n", 1)[0] == "RhemaPod Comment Guidelines"
    assert re.search(r"^Last updated: .+$", COMMENT_GUIDELINES, re.M)
    assert COMMENT_GUIDELINES_DIGEST == hashlib.sha256(raw[:-1]).hexdigest()[:12]
