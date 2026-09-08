/**
 * POST /api/auth/refresh (plan §A.2).
 *
 * Explicit rotate endpoint. Same shared implementation the proxy uses
 * (`lib/auth/exchange.ts`): read `rp_rt`, rotate the pair (deduped per
 * process), reset both cookies. On failure, clear both cookies and return 401
 * so the client falls back to `/login`.
 */

import { NextResponse, type NextRequest } from "next/server";

import { clientIpFrom } from "@/lib/auth/client-ip";
import {
  clearedUnauthorized,
  readAuthCookies,
  setAuthCookies,
} from "@/lib/auth/cookies";
import { csrfGuard } from "@/lib/auth/csrf";
import { refreshTokens } from "@/lib/auth/exchange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const blocked = csrfGuard(req);
  if (blocked) return blocked;

  const { refreshToken } = readAuthCookies(req);
  if (!refreshToken) {
    return clearedUnauthorized("Not authenticated.");
  }

  const result = await refreshTokens(refreshToken, clientIpFrom(req));
  if (!result.ok) {
    // A 5xx is a transient backend blip — relay 503 and KEEP the cookies so a
    // retry can still succeed. Only a real auth failure (401 — reuse/expired)
    // clears the session.
    if (result.status >= 500) {
      return NextResponse.json(
        { detail: "The session service is unavailable. Try again shortly.", correlation_id: null },
        { status: 503 },
      );
    }
    return clearedUnauthorized();
  }

  const res = NextResponse.json({ ok: true }, { status: 200 });
  setAuthCookies(res, {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    accessMaxAge: result.accessMaxAge,
  });
  return res;
}
