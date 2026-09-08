/**
 * Real-client-IP extraction for the backend rate limiter (plan §A.10).
 *
 * Behind the BFF every FastAPI request otherwise arrives from the Next server's
 * single IP, so the backend's per-IP throttles (`login:<ip>:<email>`,
 * `global:<ip>`) would bucket all staff as one. The backend consults
 * `X-Forwarded-For` only from a configured trusted proxy (`trusted_proxies`) and
 * takes the value verbatim — so whatever the BFF forwards IS the rate-limit key.
 *
 * TRUST MODEL — the BFF is the edge here.
 * In the dev / docker-compose topology the browser talks to this Next app
 * directly. Any inbound `X-Forwarded-For` / `X-Real-IP` on a browser request is
 * therefore 100% attacker-fabricated: trusting it would let any caller pick
 * their own rate-limit bucket (rotate the header to dodge a brute-force
 * throttle; pin a victim's IP to get them a targeted 429). So we NEVER read an
 * inbound proxy header the browser could have set.
 *
 * Instead the real client IP is read from ONE configured header,
 * `CLIENT_IP_HEADER`, which names the header the portal's *own* infrastructure
 * (a fronting nginx, a platform load balancer) sets from the TCP connection it
 * terminated. That value is `net.isIP()`-validated and forwarded as a single
 * `X-Forwarded-For` to FastAPI.
 *
 * When `CLIENT_IP_HEADER` is unset (pure `npm run dev`, nothing in front of the
 * BFF) we forward NO `X-Forwarded-For` at all. The backend then falls back to
 * the BFF's peer IP and rate-limits per-BFF — acceptable for single-user dev,
 * and `app.core.net.client_ip` logs a `client_ip_fallback` warning each time so
 * the degradation is visible.
 *
 * ⚠️ DEPLOYMENT REQUIREMENT: any real multi-user deployment MUST set
 * `CLIENT_IP_HEADER` to a header populated by a trusted hop it controls.
 * Without it, per-user rate limiting degrades to per-BFF (one shared bucket for
 * every staff member behind this instance).
 */

import type { NextRequest } from "next/server";
import { isIP } from "node:net";

const FORWARDED_FOR = "x-forwarded-for";

/**
 * Name of the inbound header the portal's own infra sets from the real client
 * connection, lower-cased. `null` when `CLIENT_IP_HEADER` is unset — in which
 * case the BFF forwards no client IP at all.
 */
function trustedClientIpHeaderName(): string | null {
  const configured = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  return configured ? configured : null;
}

/**
 * `value` iff it is a bare IPv4 / IPv6 literal, else `null`. Rejects anything
 * that is not a single address — a comma list, a `host:port`, a bracketed
 * `[::1]`, and (critically) any value carrying whitespace, CR or LF that could
 * split or inject a downstream header.
 */
function sanitizedIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || /[\s,]/.test(trimmed)) return null;
  return isIP(trimmed) !== 0 ? trimmed : null;
}

/**
 * The real client IP for this request, taken ONLY from the configured trusted
 * header (`CLIENT_IP_HEADER`). `null` when that env var is unset, the header is
 * absent, or its value is not a bare IP literal. Inbound `X-Forwarded-For` /
 * `X-Real-IP` are never consulted (see the module trust model).
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const headerName = trustedClientIpHeaderName();
  if (!headerName) return null;
  return sanitizedIp(headers.get(headerName));
}

/**
 * As `clientIpFromHeaders`, from a `NextRequest`. There is no runtime fallback:
 * `NextRequest.ip` was removed in Next 15, so the configured header is the only
 * source.
 */
export function clientIpFrom(req: NextRequest): string | null {
  return clientIpFromHeaders(req.headers);
}

/**
 * The single header to attach to an upstream FastAPI call so the backend's
 * trusted-proxy resolution sees the real client: exactly one, validated,
 * `X-Forwarded-For`. Empty when there is no trusted IP — the backend then falls
 * back to the BFF peer IP (and logs it). `X-Real-IP` is deliberately not
 * emitted; the contract is one value from one trusted source.
 */
export function forwardedForHeaders(ip: string | null): Record<string, string> {
  const safe = sanitizedIp(ip);
  return safe ? { [FORWARDED_FOR]: safe } : {};
}

/**
 * Set exactly one validated `X-Forwarded-For` on an outbound `Headers`, or
 * nothing when `ip` is not a bare IP literal. The only place the BFF writes a
 * forwarded-client header onto a `Headers` object (`Headers.set` throws on
 * CR/LF, but validating first keeps a bad value from ever reaching it).
 */
export function setForwardedFor(headers: Headers, ip: string | null): void {
  const safe = sanitizedIp(ip);
  if (safe) headers.set(FORWARDED_FOR, safe);
}
