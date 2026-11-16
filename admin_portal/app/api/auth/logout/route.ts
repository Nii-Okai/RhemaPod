/**
 * POST /api/auth/logout (plan §A.2 "Logout").
 *
 * Call `POST /api/v1/auth/logout` with the access token AND the refresh
 * token (as `refresh_token` in the body) — since the W0.4 multi-session
 * rework, sessions are per-device keyed by the `sid` the refresh token
 * carries, so the backend needs that token to know *which* session to
 * revoke; it no longer accepts a bearer-only, bodyless call (see status.md
 * "W0.4 multi-session refresh" / "logout route fix"). Then clear both
 * cookies with `Max-Age=0` on the exact same attributes, regardless of
 * whether the revoke succeeded. A failed revoke must not leave the user
 * signed in locally.
 */

import { NextResponse, type NextRequest } from "next/server";

import { clientIpFrom, forwardedForHeaders } from "@/lib/auth/client-ip";
import { API_BASE_URL, BACKEND_API_PREFIX } from "@/lib/auth/config";
import { clearAuthCookies, readAuthCookies } from "@/lib/auth/cookies";
import { csrfGuard } from "@/lib/auth/csrf";
import { userAgentFrom, userAgentHeaders } from "@/lib/auth/user-agent";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const blocked = csrfGuard(req);
  if (blocked) return blocked;

  const { accessToken, refreshToken } = readAuthCookies(req);
  if (accessToken && refreshToken) {
    try {
      const revoke = await fetch(
        `${API_BASE_URL}${BACKEND_API_PREFIX}/auth/logout`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
            ...forwardedForHeaders(clientIpFrom(req)),
            ...userAgentHeaders(userAgentFrom(req.headers)),
          },
          body: JSON.stringify({ refresh_token: refreshToken }),
          cache: "no-store",
        },
      );
      if (!revoke.ok) {
        logError("bff_logout_revoke_failed", { status: revoke.status });
      }
    } catch {
      // Swallowed by design — the local cookie clear below is what matters —
      // but a failing revoke means the session lives on server-side.
      logError("bff_logout_revoke_failed", { status: null });
    }
  } else if (accessToken) {
    // No `rp_rt` cookie to identify a session with — the backend now
    // requires one (`LogoutRequest.refresh_token`) and would just 422.
    // Nothing to revoke server-side; fall through to the local cookie clear.
    logError("bff_logout_revoke_skipped_no_refresh_token");
  }

  // Per-device sign-out since W0.4 (this session's `sid` only), not every
  // device — the backend no longer revokes by user id.
  const res = NextResponse.json(
    { message: "Signed out." },
    { status: 200 },
  );
  clearAuthCookies(res);
  return res;
}
