/**
 * POST /api/auth/set-password (plan §A.2 "Invite acceptance / set-password").
 *
 * `{token, password}` → `POST /api/v1/auth/reset-password {token, new_password}`.
 * The backend returns a `MessageResponse`, NOT a token pair — so on success we
 * return `{ok: true}` and set NO cookies. The UI then redirects to `/login`
 * with a success banner. Auto-login by replaying the password is deliberately
 * rejected: it would turn a reset endpoint into a token-minting path.
 *
 * Errors (invalid/used/expired token → 400; weak password → 422 with
 * `errors[]`) pass straight through so the form can render them.
 */

import { NextResponse, type NextRequest } from "next/server";

import { csrfGuard } from "@/lib/auth/csrf";
import { postUpstream, relayUpstreamError } from "@/lib/auth/upstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const blocked = csrfGuard(req);
  if (blocked) return blocked;

  let payload: { token?: unknown; password?: unknown };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json(
      { detail: "A JSON body with token and password is required.", correlation_id: null },
      { status: 400 },
    );
  }

  const { token, password } = payload;
  if (typeof token !== "string" || !token) {
    return NextResponse.json(
      { detail: "This link is missing its token.", correlation_id: null },
      { status: 400 },
    );
  }
  if (typeof password !== "string" || !password) {
    return NextResponse.json(
      { detail: "A new password is required.", correlation_id: null },
      { status: 400 },
    );
  }

  const upstream = await postUpstream("/auth/reset-password", {
    token,
    new_password: password,
  });
  if (!upstream.ok) {
    return relayUpstreamError(upstream);
  }

  // Success — no cookies, no auto-login.
  return NextResponse.json({ ok: true }, { status: 200 });
}
