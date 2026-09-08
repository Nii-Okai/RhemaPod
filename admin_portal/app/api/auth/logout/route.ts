/**
 * POST /api/auth/logout (plan §A.2 "Logout").
 *
 * Call `POST /api/v1/auth/logout` with the access token (the backend revokes by
 * user id — every device), then clear both cookies with `Max-Age=0` on the
 * exact same attributes, regardless of whether the revoke succeeded. A failed
 * revoke must not leave the user signed in locally.
 */

import { NextResponse, type NextRequest } from "next/server";

import { API_BASE_URL, BACKEND_API_PREFIX } from "@/lib/auth/config";
import { clearAuthCookies, readAuthCookies } from "@/lib/auth/cookies";
import { csrfGuard } from "@/lib/auth/csrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const blocked = csrfGuard(req);
  if (blocked) return blocked;

  const { accessToken } = readAuthCookies(req);
  if (accessToken) {
    try {
      await fetch(`${API_BASE_URL}${BACKEND_API_PREFIX}/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
    } catch {
      // Swallowed by design — the local cookie clear below is what matters.
    }
  }

  // "Signed out of all devices" — the backend revokes by user id, so this is
  // accurate copy, not a device-scoped sign-out (resolved decision 6).
  const res = NextResponse.json(
    { message: "Signed out of all devices." },
    { status: 200 },
  );
  clearAuthCookies(res);
  return res;
}
