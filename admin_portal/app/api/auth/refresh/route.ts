/**
 * POST /api/auth/refresh (plan §A.2).
 *
 * Explicit rotate endpoint. Same shared implementation the proxy uses
 * (`lib/auth/exchange.ts`): read `rp_rt`, rotate the pair (deduped per
 * process), reset both cookies. On failure, clear both cookies and return 401
 * so the client falls back to `/login`.
 */

import { NextResponse, type NextRequest } from "next/server";

import { clearAuthCookies, readAuthCookies, setAuthCookies } from "@/lib/auth/cookies";
import { csrfGuard } from "@/lib/auth/csrf";
import { refreshTokens } from "@/lib/auth/exchange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const blocked = csrfGuard(req);
  if (blocked) return blocked;

  const { refreshToken } = readAuthCookies(req);
  if (!refreshToken) {
    const res = NextResponse.json(
      { detail: "Not authenticated.", correlation_id: null },
      { status: 401 },
    );
    clearAuthCookies(res);
    return res;
  }

  const result = await refreshTokens(refreshToken);
  if (!result.ok) {
    const res = NextResponse.json(
      { detail: "Session expired. Please sign in again.", correlation_id: null },
      { status: 401 },
    );
    clearAuthCookies(res);
    return res;
  }

  const res = NextResponse.json({ ok: true }, { status: 200 });
  setAuthCookies(res, {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    accessMaxAge: result.accessMaxAge,
  });
  return res;
}
