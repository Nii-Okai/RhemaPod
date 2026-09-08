/**
 * The generic authenticated pass-through (plan §A.2). Every browser data call
 * routes through here; `lib/auth/proxy.ts` carries the logic (CSRF on mutating
 * methods, preemptive + reactive refresh with per-process dedupe, the single
 * `Authorization` header, X-Correlation-ID relay).
 */

import type { NextRequest } from "next/server";

import { handleBffRequest } from "@/lib/auth/proxy";

// Node runtime: the refresh dedupe map is module-scope process state, which the
// Edge runtime does not give us (§A.2, resolved decision 7 — single instance).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return handleBffRequest(req, path);
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PATCH,
  proxy as DELETE,
};
