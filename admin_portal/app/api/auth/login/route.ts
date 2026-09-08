/**
 * POST /api/auth/login (plan §A.2).
 *
 * Credentials → `POST /api/v1/auth/login` → on 200 set `rp_at` + `rp_rt` as
 * httpOnly cookies and return the user (from a follow-up `/auth/me`, since the
 * token pair does not carry it). 401 and 429 pass straight through with the
 * `{detail, correlation_id}` envelope and, for 429, the `Retry-After` window
 * the Login screen shows as a warning alert.
 */

import { NextResponse, type NextRequest } from "next/server";

import { isApiError } from "@/lib/api/errors";
import { createServerApiClient } from "@/lib/api/server";
import { setAuthCookies } from "@/lib/auth/cookies";
import { csrfGuard } from "@/lib/auth/csrf";
import { postUpstream, relayUpstreamError } from "@/lib/auth/upstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(detail: string): NextResponse {
  return NextResponse.json({ detail, correlation_id: null }, { status: 400 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const blocked = csrfGuard(req);
  if (blocked) return blocked;

  let payload: { email?: unknown; password?: unknown; remember?: unknown };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return badRequest("A JSON body with email and password is required.");
  }

  const { email, password } = payload;
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return badRequest("Email and password are required.");
  }
  const remember = payload.remember !== false;

  const upstream = await postUpstream("/auth/login", { email, password });
  if (!upstream.ok) {
    return relayUpstreamError(upstream);
  }

  const tokens = upstream.body as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };
  if (
    typeof tokens.access_token !== "string" ||
    typeof tokens.refresh_token !== "string"
  ) {
    return NextResponse.json(
      { detail: "The sign-in service returned an unexpected response.", correlation_id: null },
      { status: 502 },
    );
  }
  const accessMaxAge =
    typeof tokens.expires_in === "number" ? tokens.expires_in : undefined;

  // The token pair carries no user — fetch it with the fresh access token.
  let user: { id: string; email: string; name: string | null; role: string };
  try {
    const client = await createServerApiClient(tokens.access_token);
    const { data } = await client.GET("/api/v1/auth/me");
    if (!data) throw new Error("empty /auth/me");
    user = {
      id: String(data.id),
      email: data.email,
      name: data.full_name ?? null,
      role: String(data.role),
    };
  } catch (err) {
    void isApiError(err);
    return NextResponse.json(
      { detail: "Signed in, but could not load your profile. Try again.", correlation_id: null },
      { status: 502 },
    );
  }

  const res = NextResponse.json(user, { status: 200 });
  setAuthCookies(res, {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessMaxAge,
    remember,
  });
  return res;
}
