"""Real client IP behind a trusted proxy (app.core.net.client_ip) and its
effect on the login rate-limit bucket.

Trust model: X-Forwarded-For is only consulted when the immediate peer
(request.client.host) is itself in settings.trusted_proxies. Then the client IP
is the right-most XFF entry that is not another trusted proxy. Otherwise the
peer IP is used unchanged — the pre-existing behaviour.
"""
import pytest

from app.core.config import get_settings
from app.core.net import client_ip

# asyncio_mode = "auto" runs the async tests; the sync client_ip unit tests
# must stay unmarked, so no module-level asyncio mark here.

PW = "correct-horse-battery"


def _request(peer: str | None, xff: str | None = None):
    from starlette.requests import Request

    headers = []
    if xff is not None:
        headers.append((b"x-forwarded-for", xff.encode()))
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "path": "/",
        "headers": headers,
        "client": (peer, 55555) if peer is not None else None,
    }
    return Request(scope)


@pytest.fixture
def trusted(monkeypatch):
    """Trust 127.0.0.1 (the httpx ASGI transport's peer) as a proxy."""
    monkeypatch.setattr(get_settings(), "trusted_proxies", ["127.0.0.1"])


# ── unit: client_ip ──────────────────────────────────────────────────────────
def test_peer_not_trusted_ignores_xff(monkeypatch):
    monkeypatch.setattr(get_settings(), "trusted_proxies", [])
    req = _request("127.0.0.1", xff="203.0.113.7")
    assert client_ip(req) == "127.0.0.1"


def test_peer_not_in_trust_list_ignores_xff(monkeypatch):
    monkeypatch.setattr(get_settings(), "trusted_proxies", ["10.9.9.9"])
    req = _request("127.0.0.1", xff="203.0.113.7")
    assert client_ip(req) == "127.0.0.1"


def test_trusted_peer_takes_rightmost_untrusted_xff(trusted):
    # Client -> edge(203.0.113.7) -> our proxy(127.0.0.1). The client is the
    # left entry; the right entry is the edge, which is untrusted -> it wins.
    req = _request("127.0.0.1", xff="198.51.100.4, 203.0.113.7")
    assert client_ip(req) == "203.0.113.7"


def test_trusted_peer_skips_trailing_trusted_proxies(monkeypatch):
    monkeypatch.setattr(
        get_settings(), "trusted_proxies", ["127.0.0.1", "10.0.0.0/8"]
    )
    # ... -> real client 198.51.100.4 -> 10.1.2.3 (trusted) -> 127.0.0.1 (peer)
    req = _request("127.0.0.1", xff="198.51.100.4, 10.1.2.3")
    assert client_ip(req) == "198.51.100.4"


def test_trusted_peer_no_xff_falls_back_to_peer(trusted):
    assert client_ip(_request("127.0.0.1")) == "127.0.0.1"


def test_trusted_peer_all_entries_trusted_falls_back_to_peer(monkeypatch):
    monkeypatch.setattr(
        get_settings(), "trusted_proxies", ["127.0.0.1", "10.0.0.0/8"]
    )
    req = _request("127.0.0.1", xff="10.1.1.1, 10.2.2.2")
    assert client_ip(req) == "127.0.0.1"


def test_trusted_peer_garbage_xff_falls_back_to_peer(trusted):
    req = _request("127.0.0.1", xff="not-an-ip")
    assert client_ip(req) == "127.0.0.1"


def test_cidr_entry_matches_peer(monkeypatch):
    monkeypatch.setattr(get_settings(), "trusted_proxies", ["127.0.0.0/24"])
    req = _request("127.0.0.1", xff="203.0.113.7")
    assert client_ip(req) == "203.0.113.7"


# ── integration: the login: bucket keys on the resolved IP ────────────────────
async def _register(client, email="ratelimit@example.com"):
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    return email


async def test_login_bucket_keys_on_resolved_ip_behind_trusted_proxy(
    client, monkeypatch
):
    """Two XFF values behind a trusted proxy are two buckets; the same XFF twice
    is one bucket."""
    monkeypatch.setattr(get_settings(), "trusted_proxies", ["127.0.0.1"])
    monkeypatch.setattr(get_settings(), "login_rate_limit", 1)
    email = await _register(client)

    def login(xff):
        return client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "wrong-password-here"},
            headers={"X-Forwarded-For": xff},
        )

    # First hit for 1.1.1.1 is allowed through to auth (401), second is throttled.
    assert (await login("1.1.1.1")).status_code == 401
    assert (await login("1.1.1.1")).status_code == 429
    # A different forwarded client is a different bucket -> not throttled.
    assert (await login("2.2.2.2")).status_code == 401


async def test_login_bucket_ignores_xff_when_peer_untrusted(client, monkeypatch):
    """No trusted proxy: every request shares the peer's bucket regardless of
    XFF, so a second (spoofed) XFF value is still throttled."""
    monkeypatch.setattr(get_settings(), "trusted_proxies", [])
    monkeypatch.setattr(get_settings(), "login_rate_limit", 1)
    email = await _register(client)

    def login(xff):
        return client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "wrong-password-here"},
            headers={"X-Forwarded-For": xff},
        )

    assert (await login("1.1.1.1")).status_code == 401
    assert (await login("2.2.2.2")).status_code == 429
