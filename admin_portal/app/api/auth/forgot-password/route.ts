/**
 * POST /api/auth/forgot-password (plan §A.2).
 *
 * Straight pass-through to `POST /api/v1/auth/forgot-password`, but the
 * response shape is *always* the same generic 200 — the whole point of the
 * endpoint is to not be an account-enumeration oracle, so a bad body, a 4xx,
 * or a backend outage all answer identically.
 */

import { NextResponse, type NextRequest } from "next/server";

import { csrfGuard } from "@/lib/auth/csrf";
import { postUpstream } from "@/lib/auth/upstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERIC = {
  message: "If that email exists, a reset link has been sent.",
} as const;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const blocked = csrfGuard(req);
  if (blocked) return blocked;

  let email: unknown;
  try {
    ({ email } = (await req.json()) as { email?: unknown });
  } catch {
    // Malformed body — still answer generically. Never leak a parse error here.
    return NextResponse.json(GENERIC, { status: 200 });
  }

  if (typeof email === "string" && email) {
    const upstream = await postUpstream("/auth/forgot-password", { email });
    const headers = new Headers();
    if (upstream.correlationId) {
      headers.set("x-correlation-id", upstream.correlationId);
    }
    return NextResponse.json(GENERIC, { status: 200, headers });
  }

  return NextResponse.json(GENERIC, { status: 200 });
}
