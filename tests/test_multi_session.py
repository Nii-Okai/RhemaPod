"""Multi-session refresh-token rework (plan §A.3, W0.4).

Maps to qa-strategist's W0.3 test matrix (status.md), read against architect's
W0.4 kickoff decisions (D1-D3, status.md) and the grace/reuse design worked
out during implementation — see the module docstring in
`app/core/token_store.py` for the state machine this file exercises. Matrix
IDs are noted in each test's docstring so a reviewer can cross-reference
status.md directly. Cases the matrix maps to §A.3 items already covered
elsewhere are not duplicated here:

  - GR5 (second presentation of a grace-eligible jti is reuse, not grace
    again) is covered end-to-end in `tests/test_auth.py::test_refresh_rotates`.
  - F1/F2/F5 (Redis-down at login/refresh) are covered in
    `tests/test_auth_hardening.py`; F4 (set_active's deferred-revoke
    exception) in `tests/test_user_lifecycle.py`.
  - D1 (logout kills the presented session) is covered in
    `tests/test_auth.py::test_logout_revokes_refresh` and
    `tests/test_auth_hardening.py`'s Redis-down variant.

Design note this file's grace/expiry tests depend on: grace-window and
session-expiry timing are APPLICATION-level state (an explicit `now` argument
threaded through to both the Lua script and its FakeRedis mirror), not
Redis-native TTL. That means — unlike qa's original W0.3 assumption that
"grace-window and reuse-timing cases need real Redis via Testcontainers...
FakeRedis has no TTL/expiry mechanism at all" — the state machine, including
every grace/expiry case below, is provable deterministically against
FakeRedis by controlling `token_store`'s own `time` reference, with no real
sleep and no Redis TTL involved. What FakeRedis's Python mirror can NOT
prove is that the actual Lua script (cjson encode/decode, HGET/HSET,
EVALSHA-caching) behaves identically to it — that needs a real Redis server
running the real script, which is the second half of this file (the
`real_redis` fixture), gated the same way `test_last_admin_concurrent.py`
gates real PostgreSQL: skipped, with a reason, when none is reachable.
"""
from __future__ import annotations

import asyncio
import os
import uuid

import pytest
import pytest_asyncio

from tests.conftest import _fake
from tests.test_auth_hardening import _RecordingLogger

pytestmark = pytest.mark.asyncio

PW = "correct-horse-battery"
NEW_PW = "brand-new-passphrase-9"


# ── shared helpers ────────────────────────────────────────────────────────
async def _register(client, email, password=PW):
    return await client.post(
        "/api/v1/auth/register", json={"email": email, "password": password}
    )


async def _login(client, email, password=PW) -> dict:
    r = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    return r.json()


async def _refresh(client, token):
    return await client.post("/api/v1/auth/refresh", json={"refresh_token": token})


async def _logout(client, tokens):
    return await client.post(
        "/api/v1/auth/logout",
        json={"refresh_token": tokens["refresh_token"]},
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )


def _sid(token: str) -> str:
    from app.core import security

    payload = security.decode_token(token, security.REFRESH)
    assert payload is not None, "expected a decodable refresh token"
    return payload["sid"]


async def _set_role(engine, email, role):
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await s.execute(
            text("UPDATE users SET role = :r WHERE email = :e"),
            {"r": role.upper(), "e": email},
        )
        await s.commit()


async def _db_user_id(engine, email) -> str:
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import User

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        row = (await s.execute(select(User).where(User.email == email))).scalar_one()
        return str(row.id)


async def _staff_headers(client, engine, email, role) -> dict:
    """Register `email`, force its role via the DB, return one login's
    auth headers (a single session — the actor doesn't need more than one
    for these tests)."""
    await _register(client, email)
    if role != "viewer":
        await _set_role(engine, email, role)
    tokens = await _login(client, email)
    return {"Authorization": f"Bearer {tokens['access_token']}"}


# ── M1/M2/U1/G-scope — multi-session storage (§A.3 #1) ───────────────────────
async def test_m1_three_concurrent_sessions_all_stay_live(client):
    """M1: phone, tablet, and the admin portal log in as the same user
    (three concurrent sessions) — none evicts another. The literal
    regression this rework fixes."""
    await _register(client, "user@example.com")
    phone = await _login(client, "user@example.com")
    tablet = await _login(client, "user@example.com")
    portal = await _login(client, "user@example.com")

    assert len({_sid(t["refresh_token"]) for t in (phone, tablet, portal)}) == 3

    for tokens in (phone, tablet, portal):
        r = await _refresh(client, tokens["refresh_token"])
        assert r.status_code == 200


async def test_m2_refresh_on_one_device_does_not_disturb_siblings(client):
    """M2: refreshing device A leaves B and the portal's own sessions
    untouched and independently refreshable afterward."""
    await _register(client, "user@example.com")
    a = await _login(client, "user@example.com")
    b = await _login(client, "user@example.com")
    portal = await _login(client, "user@example.com")

    assert (await _refresh(client, a["refresh_token"])).status_code == 200
    assert (await _refresh(client, b["refresh_token"])).status_code == 200
    assert (await _refresh(client, portal["refresh_token"])).status_code == 200


async def test_u1_g_scope_second_login_does_not_overwrite_first(client):
    """U1/G-scope: token-store level — session A's own hash field survives
    session B's login untouched, and both are addressable by their own
    session id (not just user_id)."""
    from app.core import token_store

    await _register(client, "user@example.com")
    tokens_a = await _login(client, "user@example.com")
    sid_a = _sid(tokens_a["refresh_token"])
    tokens_b = await _login(client, "user@example.com")
    sid_b = _sid(tokens_b["refresh_token"])
    assert sid_a != sid_b

    me = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {tokens_a['access_token']}"},
    )
    user_id = me.json()["id"]

    h = await _fake.hgetall(token_store._key(user_id))
    assert sid_a in h and sid_b in h


# ── GR1/GR2 — grace window (§A.3 #2) ──────────────────────────────────────────
class _FakeClock:
    """Stand-in for the `time` module `token_store` calls `time.time()` on.
    Swapped in via `monkeypatch.setattr(token_store, "time", clock)` so only
    token_store's own notion of "now" is controlled — nothing global (e.g.
    structlog's own timestamps) is affected."""

    def __init__(self, t: float) -> None:
        self._t = t

    def time(self) -> float:
        return self._t

    def set(self, t: float) -> None:
        self._t = t


async def test_gr1_grace_accepts_the_immediately_prior_jti(client, monkeypatch):
    """GR1: the jti issued immediately prior to the current one is still
    accepted within the grace TTL — the 'app killed mid-refresh, retried
    later' recovery case."""
    import app.core.token_store as ts

    await _register(client, "user@example.com")
    tokens = await _login(client, "user@example.com")
    old_refresh = tokens["refresh_token"]

    clock = _FakeClock(1_000_000)
    monkeypatch.setattr(ts, "time", clock)

    r1 = await _refresh(client, old_refresh)
    assert r1.status_code == 200

    clock.set(1_000_000 + 10)  # well within the default 60s grace window
    r2 = await _refresh(client, old_refresh)
    assert r2.status_code == 200


async def test_gr2_grace_expires_after_the_window(client, monkeypatch):
    """GR2: the caller waits past the grace TTL before presenting the old
    jti — rejected, same as reuse, because grace is a brief tolerance, not a
    second long-lived valid token."""
    import app.core.token_store as ts
    from app.core.config import get_settings

    settings = get_settings()
    await _register(client, "user@example.com")
    tokens = await _login(client, "user@example.com")
    old_refresh = tokens["refresh_token"]

    clock = _FakeClock(2_000_000)
    monkeypatch.setattr(ts, "time", clock)

    r1 = await _refresh(client, old_refresh)
    assert r1.status_code == 200

    clock.set(2_000_000 + settings.refresh_grace_seconds + 1)
    r2 = await _refresh(client, old_refresh)
    assert r2.status_code == 401


# ── GR3/GR4 — reuse of a pre-grace jti revokes the family, scoped (§A.3 #3) ──
async def test_gr3_gr4_two_generations_stale_jti_revokes_only_that_session(client):
    """GR3: a jti two rotations old (never granted grace) is reuse — both
    the current live jti and the grace-eligible predecessor of THAT session
    stop working. GR4: a sibling session is untouched — family revoke is
    scoped (D2), not global."""
    await _register(client, "user@example.com")
    a = await _login(client, "user@example.com")  # under attack
    b = await _login(client, "user@example.com")  # sibling, must survive

    gen0 = a["refresh_token"]
    gen1 = (await _refresh(client, gen0)).json()["refresh_token"]
    gen2 = (await _refresh(client, gen1)).json()["refresh_token"]

    # GR3: gen0 is two generations stale now (current is gen2's jti, prev is
    # gen1's jti) — reuse, revokes this session's family.
    stale = await _refresh(client, gen0)
    assert stale.status_code == 401

    # The family revoke killed the current live jti too, not just gen0.
    also_dead = await _refresh(client, gen2)
    assert also_dead.status_code == 401

    # GR4: sibling session B is untouched.
    sibling = await _refresh(client, b["refresh_token"])
    assert sibling.status_code == 200


# ── R1 — concurrent presentation of the same still-valid jti ─────────────────
async def test_r1_concurrent_refresh_same_jti_no_silent_death(client):
    """R1 (qa's W0.3 finding, the pre-existing TOCTOU: two concurrent
    /auth/refresh calls on the same still-valid jti could both pass a
    check-then-write and the second write would silently orphan the first's
    freshly-minted pair). Closed by D3's claim-first Lua design.

    Under the grace-window state machine this resolves to: the racing call
    falls into the grace slot the winner just opened and ALSO gets a 200 —
    but the property R1 actually protects ("not silently dead") holds by
    construction either way, since grace is exactly the mechanism that keeps
    a one-generation-behind jti alive. Assert that property directly (both
    pairs are genuinely usable) rather than an exact 200/401 split, since
    asyncio.gather does not guarantee which of the two racers the atomic
    claim treats as the direct match."""
    await _register(client, "user@example.com")
    tokens = await _login(client, "user@example.com")
    shared = tokens["refresh_token"]

    r1, r2 = await asyncio.gather(_refresh(client, shared), _refresh(client, shared))
    assert r1.status_code == 200
    assert r2.status_code == 200
    pair1, pair2 = r1.json(), r2.json()
    assert pair1["refresh_token"] != pair2["refresh_token"]

    # Neither returned refresh token is silently dead — sequential checks so
    # this assertion itself doesn't race. This is stronger than an "or": the
    # state machine guarantees both racers land usable tokens regardless of
    # which one Redis serializes first (one becomes the live jti, the other
    # the live prev_jti with a fresh grace window) — so both must succeed.
    follow1 = await _refresh(client, pair1["refresh_token"])
    follow2 = await _refresh(client, pair2["refresh_token"])
    assert follow1.status_code == 200, (
        f"racer 1's rotated token should still be usable, got {follow1.status_code}"
    )
    assert follow2.status_code == 200, (
        f"racer 2's rotated token should still be usable, got {follow2.status_code}"
    )


# ── D2 — per-device logout does not over-reach into siblings (§A.3 #4) ───────
async def test_d2_logout_does_not_evict_sibling_sessions(client):
    await _register(client, "user@example.com")
    a = await _login(client, "user@example.com")
    b = await _login(client, "user@example.com")

    await _logout(client, a)

    assert (await _refresh(client, a["refresh_token"])).status_code == 401
    assert (await _refresh(client, b["refresh_token"])).status_code == 200


# ── refresh_reuse_detected — the log event D2 depends on ─────────────────────
async def test_refresh_reuse_detected_log_event_fires(client, monkeypatch):
    """Load-bearing for D2 (status.md, architect's own words): a scoped
    revoke on reuse is only defensible alongside this being observable."""
    import app.services.auth_service as auth_module

    recorder = _RecordingLogger()
    monkeypatch.setattr(auth_module, "log", recorder)

    await _register(client, "user@example.com")
    tokens = await _login(client, "user@example.com")
    old = tokens["refresh_token"]
    await _refresh(client, old)  # direct rotation
    await _refresh(client, old)  # grace accept (consumes the one grace use)
    await _refresh(client, old)  # third presentation -> reuse

    events = [r for r in recorder.records if r["event"] == "refresh_reuse_detected"]
    assert len(events) == 1
    assert events[0]["user_id"]
    assert events[0]["sid"]


# ── G1-G4b — global revoke stays global, across ALL four call sites, with
#             THREE live sessions each (§A.3 #4) ─────────────────────────────
async def test_g1_reset_password_revokes_every_session(client):
    from app.core import security, token_store

    await _register(client, "user@example.com")
    a = await _login(client, "user@example.com")
    b = await _login(client, "user@example.com")
    portal = await _login(client, "user@example.com")

    me = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {a['access_token']}"}
    )
    user_id = me.json()["id"]
    reset_token, jti = security.create_reset_token(user_id)
    await token_store.register_single_use(jti, 3600)

    r = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": reset_token, "new_password": NEW_PW},
    )
    assert r.status_code == 200

    for tokens in (a, b, portal):
        assert (await _refresh(client, tokens["refresh_token"])).status_code == 401


async def test_g2_change_password_revokes_every_session(client):
    await _register(client, "user@example.com")
    a = await _login(client, "user@example.com")
    b = await _login(client, "user@example.com")
    portal = await _login(client, "user@example.com")

    r = await client.post(
        "/api/v1/auth/change-password",
        json={"current_password": PW, "new_password": NEW_PW},
        headers={"Authorization": f"Bearer {a['access_token']}"},
    )
    assert r.status_code == 200

    for tokens in (a, b, portal):
        assert (await _refresh(client, tokens["refresh_token"])).status_code == 401


async def test_g3_change_role_revokes_target_leaves_actor_untouched(client, engine):
    admin_headers = await _staff_headers(client, engine, "admin@example.com", "admin")
    await _register(client, "target@example.com")
    a = await _login(client, "target@example.com")
    b = await _login(client, "target@example.com")
    portal = await _login(client, "target@example.com")
    tid = await _db_user_id(engine, "target@example.com")

    # Actor's own session, to prove change_role on someone ELSE doesn't
    # collaterally revoke the actor.
    admin_login = await _login(client, "admin@example.com")

    r = await client.patch(
        f"/api/v1/users/{tid}/role", json={"role": "editor"}, headers=admin_headers
    )
    assert r.status_code == 200

    for tokens in (a, b, portal):
        assert (await _refresh(client, tokens["refresh_token"])).status_code == 401

    assert (await _refresh(client, admin_login["refresh_token"])).status_code == 200


async def test_g3b_change_role_refused_409_still_revokes_target_sessions(client, engine):
    """The last-admin invariant's 409 refusal still revokes the target's
    sessions first (deliberate, existing ordering, auth_service.py:402-411)
    — a regression pin so a refactor doesn't silently change it.

    The HTTP surface can't reach this branch: self-demotion is intercepted
    earlier (400, see test_user_lifecycle.py::
    test_last_admin_cannot_be_demoted_via_change_role), and any OTHER actor
    who can pass `_may_assign` for an admin target is necessarily itself a
    second active admin, which means the guard's count is >1 and it never
    409s. auth_service.py's own comment names this the "near-unreachable 409
    path" for exactly this reason. This calls the service directly instead,
    with a second, deactivated admin as the actor — the only way `target`
    can be demoted by someone other than themselves while still being the
    sole ACTIVE admin the guard counts — mirroring
    test_user_lifecycle.py::test_shared_last_admin_guard_blocks_then_allows'
    existing precedent for exercising this guard below the HTTP layer."""
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.models.models import User, UserRole
    from app.services import auth_service
    from app.services.auth_service import ContentError

    await _register(client, "solo-admin@example.com")
    await _set_role(engine, "solo-admin@example.com", "admin")
    target_session = await _login(client, "solo-admin@example.com")
    target_id = uuid.UUID(await _db_user_id(engine, "solo-admin@example.com"))

    await _register(client, "stale-admin@example.com")
    await _set_role(engine, "stale-admin@example.com", "admin")
    actor_id = uuid.UUID(await _db_user_id(engine, "stale-admin@example.com"))

    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as s:
        await s.execute(
            text("UPDATE users SET is_active = false WHERE email = :e"),
            {"e": "stale-admin@example.com"},
        )
        await s.commit()

        target = await s.get(User, target_id)
        actor = await s.get(User, actor_id)
        assert actor.role == UserRole.ADMIN and actor.is_active is False

        with pytest.raises(ContentError) as ei:
            await auth_service.change_role(s, target.id, UserRole.EDITOR, actor)
        assert ei.value.status_code == 409

    assert (await _refresh(client, target_session["refresh_token"])).status_code == 401


async def test_g4a_deactivate_revokes_every_session(client, engine):
    admin_headers = await _staff_headers(client, engine, "admin@example.com", "admin")
    await _register(client, "ed@example.com")
    await _set_role(engine, "ed@example.com", "editor")
    a = await _login(client, "ed@example.com")
    b = await _login(client, "ed@example.com")
    portal = await _login(client, "ed@example.com")
    eid = await _db_user_id(engine, "ed@example.com")

    r = await client.patch(
        f"/api/v1/users/{eid}/active", json={"is_active": False}, headers=admin_headers
    )
    assert r.status_code == 200
    assert r.json()["revocation_deferred"] is False

    for tokens in (a, b, portal):
        assert (await _refresh(client, tokens["refresh_token"])).status_code == 401


async def test_g4b_reactivate_clears_a_stale_deferred_revoke_across_all_sessions(
    client, engine
):
    """CWE-613: if deactivation's own revoke was deferred (Redis was down),
    reactivating must not resurrect ANY of the pre-deactivation sessions —
    not just the one existing coverage in test_user_lifecycle.py already
    pins down for a single session."""
    admin_headers = await _staff_headers(client, engine, "admin@example.com", "admin")
    await _register(client, "ed@example.com")
    await _set_role(engine, "ed@example.com", "editor")
    a = await _login(client, "ed@example.com")
    b = await _login(client, "ed@example.com")
    eid = await _db_user_id(engine, "ed@example.com")

    with _fake.failing():
        deactivate = await client.patch(
            f"/api/v1/users/{eid}/active",
            json={"is_active": False},
            headers=admin_headers,
        )
    assert deactivate.status_code == 200
    assert deactivate.json()["revocation_deferred"] is True

    reactivate = await client.patch(
        f"/api/v1/users/{eid}/active", json={"is_active": True}, headers=admin_headers
    )
    assert reactivate.status_code == 200
    assert reactivate.json()["revocation_deferred"] is False

    for tokens in (a, b):
        assert (await _refresh(client, tokens["refresh_token"])).status_code == 401


async def test_set_active_idempotent_noop_does_not_touch_sessions(client, engine):
    """§A.3 #4 idempotency: `set_active` targeting the state the account is
    already in is a no-op — no sessions touched."""
    admin_headers = await _staff_headers(client, engine, "admin@example.com", "admin")
    await _register(client, "ed@example.com")
    await _set_role(engine, "ed@example.com", "editor")
    a = await _login(client, "ed@example.com")
    eid = await _db_user_id(engine, "ed@example.com")

    r = await client.patch(
        f"/api/v1/users/{eid}/active", json={"is_active": True}, headers=admin_headers
    )
    assert r.status_code == 200

    assert (await _refresh(client, a["refresh_token"])).status_code == 200


# ── Real Redis — the actual Lua script, not the FakeRedis Python mirror ──────
_TEST_REDIS_DB = os.environ.get("TEST_REDIS_DB", "15")
_CANDIDATE_REDIS_URLS = [
    os.environ.get("TEST_REDIS_URL"),
    f"redis://localhost:6379/{_TEST_REDIS_DB}",
]


def _reachable_redis_url() -> str | None:
    import redis as redis_sync

    for url in _CANDIDATE_REDIS_URLS:
        if not url:
            continue
        try:
            c = redis_sync.Redis.from_url(url, socket_connect_timeout=2)
            c.ping()
            c.close()
        except Exception:
            continue
        else:
            return url
    return None


_REAL_REDIS_URL = _reachable_redis_url()


@pytest_asyncio.fixture
async def real_redis():
    if _REAL_REDIS_URL is None:
        pytest.skip(
            "no Redis reachable (set TEST_REDIS_URL) — the real Lua script and "
            "genuine cross-request concurrency are provable only against a real "
            "Redis server (status.md 'W0.4 multi-session refresh'); a dedicated "
            f"DB index ({_TEST_REDIS_DB}) is used so this never touches dev data"
        )
    import redis.asyncio as redis_lib

    client = redis_lib.Redis.from_url(_REAL_REDIS_URL, decode_responses=True)
    await client.flushdb()
    try:
        yield client
    finally:
        await client.flushdb()
        await client.aclose()


async def test_real_redis_rotated_grace_reuse_no_session(real_redis, monkeypatch):
    """Proves the actual Lua script (not the FakeRedis mirror) implements
    the ROTATED -> ROTATED_VIA_GRACE -> REUSE_REVOKED -> NO_SESSION chain."""
    import app.core.token_store as ts

    monkeypatch.setattr(ts, "get_redis", lambda: real_redis)

    user_id = "11111111-1111-1111-1111-111111111111"
    sid = "session-a"
    await ts.create_session(user_id, sid, "jti-0")

    assert await ts.claim_and_rotate(user_id, sid, "jti-0", "jti-1") is ts.ClaimOutcome.ROTATED
    assert (
        await ts.claim_and_rotate(user_id, sid, "jti-0", "jti-2")
        is ts.ClaimOutcome.ROTATED_VIA_GRACE
    )
    assert (
        await ts.claim_and_rotate(user_id, sid, "jti-0", "jti-3")
        is ts.ClaimOutcome.REUSE_REVOKED
    )
    assert (
        await ts.claim_and_rotate(user_id, sid, "jti-2", "jti-4")
        is ts.ClaimOutcome.NO_SESSION
    )


async def test_real_redis_concurrent_claim_same_jti(real_redis, monkeypatch):
    """R1 against a genuine Redis server — real network round trips, not
    just single-threaded Python control flow with no internal `await` —
    proves the EVALSHA/Lua path is atomic, not just the Python mirror."""
    import app.core.token_store as ts

    monkeypatch.setattr(ts, "get_redis", lambda: real_redis)

    user_id = "22222222-2222-2222-2222-222222222222"
    sid = "session-a"
    await ts.create_session(user_id, sid, "jti-0")

    o1, o2 = await asyncio.gather(
        ts.claim_and_rotate(user_id, sid, "jti-0", "jti-a"),
        ts.claim_and_rotate(user_id, sid, "jti-0", "jti-b"),
    )
    outcomes = {o1, o2}
    assert outcomes == {ts.ClaimOutcome.ROTATED, ts.ClaimOutcome.ROTATED_VIA_GRACE}


async def test_real_redis_revoke_session_scoped_revoke_refresh_global(
    real_redis, monkeypatch
):
    import app.core.token_store as ts

    monkeypatch.setattr(ts, "get_redis", lambda: real_redis)

    user_id = "33333333-3333-3333-3333-333333333333"
    await ts.create_session(user_id, "sid-a", "jti-a")
    await ts.create_session(user_id, "sid-b", "jti-b")

    await ts.revoke_session(user_id, "sid-a")
    assert (
        await ts.claim_and_rotate(user_id, "sid-a", "jti-a", "x")
        is ts.ClaimOutcome.NO_SESSION
    )
    assert (
        await ts.claim_and_rotate(user_id, "sid-b", "jti-b", "y")
        is ts.ClaimOutcome.ROTATED
    )

    await ts.create_session(user_id, "sid-a", "jti-a2")
    await ts.revoke_refresh(user_id)
    assert (
        await ts.claim_and_rotate(user_id, "sid-a", "jti-a2", "z")
        is ts.ClaimOutcome.NO_SESSION
    )
    assert (
        await ts.claim_and_rotate(user_id, "sid-b", "y", "still-dead")
        is ts.ClaimOutcome.NO_SESSION
    )
