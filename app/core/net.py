"""Resolve the real client IP when the app sits behind a trusted reverse proxy.

Every rate-limit bucket in this service keys on a client IP. When a proxy (the
admin portal's Next BFF, an nginx/ALB in front of the API) terminates the
connection, ``request.client.host`` is the *proxy's* IP, not the caller's — so
every request through that proxy shares one bucket. One abuser then exhausts
the shared ``login:`` / ``forgot-password`` window and locks out everyone.

The fix is to trust ``X-Forwarded-For`` — but only from a peer we have been
explicitly told is a proxy (``settings.trusted_proxies``). ``X-Forwarded-For``
is a client-settable header; trusting it from an arbitrary peer lets that peer
forge its own source IP and bypass (or poison) rate limiting entirely. So:

* If the immediate peer (``request.client.host``) is NOT in ``trusted_proxies``,
  the header is ignored and the peer IP is the client IP. This is the default
  (empty ``trusted_proxies``) and reproduces the pre-existing behaviour exactly.
* If the peer IS trusted, walk ``X-Forwarded-For`` from the right and return the
  first entry that is not itself a trusted proxy — that is the furthest hop we
  still have a chain of trusted forwarders back to. If there is no such entry
  (header absent, unparseable, or every entry is a trusted proxy) fall back to
  the peer IP.
"""

from __future__ import annotations

import ipaddress
from functools import lru_cache

from starlette.requests import Request

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger("net")

_XFF_HEADER = "x-forwarded-for"


@lru_cache(maxsize=32)
def _parse_networks(trusted: tuple[str, ...]) -> tuple[ipaddress._BaseNetwork, ...]:
    """Parse the configured trusted-proxy list into networks, once per list.

    Accepts plain IPs (``10.0.0.5``) and CIDRs (``10.0.0.0/8``); a bare IP is a
    /32 (or /128). Unparseable entries are dropped with a warning rather than
    taking the process down — a rate limiter must not be a boot blocker.
    """
    networks: list[ipaddress._BaseNetwork] = []
    for entry in trusted:
        entry = entry.strip()
        if not entry:
            continue
        try:
            networks.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            log.warning("trusted_proxy_unparseable", entry=entry)
    return tuple(networks)


def _ip_in(host: str, networks: tuple[ipaddress._BaseNetwork, ...]) -> bool:
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(addr.version == net.version and addr in net for net in networks)


def _log_fallback(peer: str, *, reason: str, xff_present: bool) -> None:
    """Record that a *trusted* peer produced no usable forwarded client IP.

    Without this the "every portal user collapses into one rate-limit bucket"
    regression (the original lockout bug this module exists to prevent) is
    silent: ``client_ip()`` just returns the proxy's own IP and every
    ``login:`` / ``global:`` bucket keys on it. One warning per fallback makes
    that observable — the volume itself is the signal that the forwarding chain
    (BFF / LB) is misconfigured or has stopped appending. Unconditional on
    purpose: sampling here would blunt exactly the signal we want.
    """
    log.warning(
        "client_ip_fallback",
        peer=peer,
        reason=reason,
        xff_present=xff_present,
    )


def client_ip(request: Request) -> str:
    """The best available client IP for rate-limiting purposes.

    Never raises. Falls back to ``request.client.host`` (or ``"unknown"`` if
    even that is absent) whenever the forwarded chain cannot be trusted.
    """
    peer = request.client.host if request.client else "unknown"

    networks = _parse_networks(tuple(get_settings().trusted_proxies))
    if not networks or not _ip_in(peer, networks):
        # Immediate peer is not a declared proxy — X-Forwarded-For is untrusted.
        return peer

    forwarded = request.headers.get(_XFF_HEADER)
    if not forwarded:
        _log_fallback(peer, reason="no_xff", xff_present=False)
        return peer

    # Right-most first: entries are appended by each hop, so the right-most is
    # the closest to us. The first one that is not itself a trusted proxy is the
    # client as seen by our trust boundary.
    for token in reversed([p.strip() for p in forwarded.split(",")]):
        if not token or _ip_in(token, networks):
            continue
        try:
            ipaddress.ip_address(token)
        except ValueError:
            # A non-IP token in the chain means the header is malformed or
            # spoofed past the last trusted hop — do not trust it.
            _log_fallback(peer, reason="malformed_xff", xff_present=True)
            return peer
        return token

    _log_fallback(peer, reason="all_entries_trusted", xff_present=True)
    return peer
