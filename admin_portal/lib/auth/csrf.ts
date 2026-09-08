/**
 * Origin / Sec-Fetch-Site CSRF check (plan §A.2 "CSRF posture", risk D7).
 *
 * The proxy attaches the bearer token itself, so any request that reaches it
 * with a valid cookie is fully authenticated. `SameSite` is a browser
 * behaviour, not a spec guarantee, and does not stop a same-site subdomain
 * attacker. So on every *mutating* method we require the request to prove it
 * originated from the portal's own origin:
 *
 *   • `Sec-Fetch-Site: same-origin`  (sent by all current browsers), OR
 *   • an `Origin` header exactly equal to `PORTAL_ORIGIN`.
 *
 * Anything else → 403. This applies to `/api/auth/*` too, including login,
 * which makes forced-login CSRF a non-issue. ~15 lines, no token plumbing,
 * no per-form wiring.
 */

import { NextResponse } from "next/server";

import { PORTAL_ORIGIN } from "./config";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isMutating(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase());
}

/**
 * True when the request demonstrably came from the portal's own origin:
 * `Sec-Fetch-Site: same-origin`, or an `Origin` header exactly equal to
 * `PORTAL_ORIGIN`. Nothing else counts.
 */
export function isSameOrigin(req: Request): boolean {
  if (req.headers.get("sec-fetch-site") === "same-origin") return true;

  const origin = req.headers.get("origin");
  if (origin && origin === PORTAL_ORIGIN) return true;

  return false;
}

/**
 * Returns a 403 `NextResponse` when a mutating request cannot prove
 * same-origin, or `null` when the request may proceed.
 */
export function csrfGuard(req: Request): NextResponse | null {
  if (!isMutating(req.method)) return null;
  if (isSameOrigin(req)) return null;
  return NextResponse.json(
    {
      detail: "Cross-origin request rejected.",
      correlation_id: null,
    },
    { status: 403 },
  );
}
