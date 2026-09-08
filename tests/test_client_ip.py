"""Real client IP behind a trusted proxy (app.core.net.client_ip) and its
effect on the login rate-limit bucket.

Trust model: X-Forwarded-For is only consulted when the immediate peer
(request.client.host) is itself in settings.trusted_proxies. Then the client IP
is the right-most XFF entry that is not another trusted proxy. Otherwise the
peer IP is used unchanged — the pre-existing behaviour.

SECURITY — why trusting a single-token XFF from a trusted peer is safe HERE:
    In the portal deployment the *only* configured trusted proxy is the admin
    portal's Next BFF, and the BFF is contracted to forward exactly one
    net.isIP()-validated value that it sourced from a trusted hop it controls
    (CLIENT_IP_HEADER) or NO X-Forwarded-For at all — never raw, unverified
    client input. client_ip() therefore takes that one token verbatim.
    If a non-appending / header-spoofing proxy is ever added to trusted_proxies
    (one that relays a browser-supplied X-Forwarded-For unchanged), this same
    code path becomes a rate-limit bypass: the caller picks their own bucket by
    rotating the header. The safety is entirely in the proxy's forwarding
    discipline, not in this function. Keep trusted_proxies empty unless every
    listed peer meets that contract.
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


# ── adversarial: a trusted peer forwarding a SINGLE forged token ──────────────
def test_trusted_peer_takes_single_xff_token_verbatim(trusted):
    """A trusted peer that sends ONE X-Forwarded-For entry (no chain) → that
    entry is the resolved client IP, verbatim.

    This is the exact interaction that makes the BFF's forwarding discipline
    load-bearing. It is safe ONLY because the sole configured trusted proxy (the
    portal BFF) never forwards unverified client input — it forwards one
    net.isIP()-validated value from a trusted hop, or no XFF at all (see the
    module docstring). Put a non-appending proxy that relays a browser-set
    X-Forwarded-For behind this and it is a per-IP rate-limit bypass: the caller
    chooses their own bucket by rotating the token.
    """
    req = _request("127.0.0.1", xff="203.0.113.9")
    assert client_ip(req) == "203.0.113.9"


# ── F3: fallback to peer IP is logged, not silent ────────────────────────────
def _fallback_events(records):
    return [r for r in records if r["event"] == "client_ip_fallback"]


def test_trusted_peer_no_xff_logs_fallback(trusted):
    import structlog

    with structlog.testing.capture_logs() as logs:
        assert client_ip(_request("127.0.0.1")) == "127.0.0.1"
    events = _fallback_events(logs)
    assert len(events) == 1
    assert events[0]["reason"] == "no_xff"
    assert events[0]["xff_present"] is False
    assert events[0]["peer"] == "127.0.0.1"
    assert events[0]["log_level"] == "warning"


def test_trusted_peer_all_entries_trusted_logs_fallback(monkeypatch):
    import structlog

    monkeypatch.setattr(
        get_settings(), "trusted_proxies", ["127.0.0.1", "10.0.0.0/8"]
    )
    with structlog.testing.capture_logs() as logs:
        assert client_ip(_request("127.0.0.1", xff="10.1.1.1, 10.2.2.2")) == "127.0.0.1"
    events = _fallback_events(logs)
    assert len(events) == 1
    assert events[0]["reason"] == "all_entries_trusted"
    assert events[0]["xff_present"] is True


def test_trusted_peer_garbage_xff_logs_fallback(trusted):
    import structlog

    with structlog.testing.capture_logs() as logs:
        assert client_ip(_request("127.0.0.1", xff="not-an-ip")) == "127.0.0.1"
    events = _fallback_events(logs)
    assert len(events) == 1
    assert events[0]["reason"] == "malformed_xff"
    assert events[0]["xff_present"] is True


def test_resolved_xff_does_not_log_fallback(trusted):
    """The happy path (a usable forwarded IP) emits no fallback warning."""
    import structlog

    with structlog.testing.capture_logs() as logs:
        assert client_ip(_request("127.0.0.1", xff="203.0.113.9")) == "203.0.113.9"
    assert _fallback_events(logs) == []


def test_untrusted_peer_does_not_log_fallback(monkeypatch):
    """Only a *trusted* peer with no usable forward logs — the default
    (trust-nothing) path must stay quiet."""
    import structlog

    monkeypatch.setattr(get_settings(), "trusted_proxies", [])
    with structlog.testing.capture_logs() as logs:
        assert client_ip(_request("127.0.0.1", xff="203.0.113.9")) == "127.0.0.1"
    assert _fallback_events(logs) == []


# ── integration: the login: bucket keys on the resolved IP ────────────────────
async def _register(client, email="ratelimit@example.com"):
    await client.post("/api/v1/auth/register", json={"email": email, "password": PW})
    return email


async def test_login_bucket_partitions_by_distinct_upstream_client_ip(
    client, monkeypatch
):
    """Behind a trusted proxy, the login: bucket keys on the resolved upstream
    client IP: two distinct forwarded clients get two buckets, the same client
    twice shares one.

    This partitioning is correct ONLY for genuinely distinct upstream clients —
    i.e. when the trusted proxy forwards a value it verified from its own
    connection (the BFF contract: one net.isIP()-validated CLIENT_IP_HEADER
    value, or none). It is NOT a licence for a caller to mint buckets: if the
    proxy relayed a browser-chosen X-Forwarded-For, the "different client →
    different bucket" behaviour below is a brute-force throttle bypass. See the
    module docstring.
    """
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
