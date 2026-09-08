/**
 * Real-client-IP extraction for the backend rate limiter (plan §A.10).
 *
 * Behind the BFF every FastAPI request otherwise arrives from the Next server's
 * single IP, so `GlobalRateLimitMiddleware` (300/60s, keyed on the peer address)
 * would throttle all staff as one. The backend's trusted-proxy XFF handling
 * (rate-limiter batch) trusts `X-Forwarded-For` only from configured proxies;
 * the portal deployment registers the BFF as one, and every upstream call the
 * BFF makes carries the real browser IP in that header.
 *
 * Until that backend batch lands this is inert — the current middleware ignores
 * proxy headers entirely — so it is safe to ship ahead of it.
 */

import type { NextRequest } from "next/server";

const FORWARDED_FOR = "x-forwarded-for";
const REAL_IP = "x-real-ip";

/**
 * The real browser IP from an inbound request's proxy headers. Preference:
 * left-most entry of `x-forwarded-for` (an upstream nginx / platform LB
 * prepends the client), then `x-real-ip`. `null` when neither is present
 * (local `npm run dev` with no proxy in front).
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const xff = headers.get(FORWARDED_FOR);
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get(REAL_IP)?.trim();
  return realIp ? realIp : null;
}

/** As `clientIpFromHeaders`, plus the `NextRequest`'s runtime `ip` as a last
 *  resort (the platform adapter populates it in some deployments). */
export function clientIpFrom(req: NextRequest): string | null {
  const fromHeaders = clientIpFromHeaders(req.headers);
  if (fromHeaders) return fromHeaders;
  const runtimeIp = (req as { ip?: string }).ip;
  return runtimeIp && runtimeIp.length > 0 ? runtimeIp : null;
}

/** Header pair to attach to an upstream FastAPI call so the backend's
 *  trusted-proxy XFF handling sees the real client. Empty when `ip` is null. */
export function forwardedForHeaders(ip: string | null): Record<string, string> {
  return ip ? { [FORWARDED_FOR]: ip, [REAL_IP]: ip } : {};
}
