/**
 * The one authenticated pass-through (plan §A.2 "Route families" +
 * "401 → refresh → retry"). Every browser data call reaches FastAPI through
 * here, and this is the only place an `Authorization` header is attached.
 *
 * handle(req):
 *   1. Origin / Sec-Fetch-Site check on mutating methods → 403 if not same-origin
 *   2. read rp_at; if absent or within 60s of expiry and rp_rt exists →
 *      refresh preemptively (deduped)
 *   3. forward METHOD /api/v1/<path> with the bearer + a small header allowlist
 *   4. if the response is 401 and rp_rt exists and we have not refreshed yet →
 *      refresh once, forward once more
 *   5. return the upstream status + body + X-Correlation-ID, plus Set-Cookie if
 *      a refresh rotated the pair; a failed refresh clears both cookies and
 *      returns 401
 */

import { NextResponse, type NextRequest } from "next/server";

import { API_BASE_URL, BACKEND_API_PREFIX } from "./config";
import { clearAuthCookies, readAuthCookies, setAuthCookies } from "./cookies";
import { csrfGuard } from "./csrf";
import { refreshTokens, type RefreshOk } from "./exchange";
import { isExpiringSoon } from "./jwt";

const CORRELATION_HEADER = "x-correlation-id";

/** Request headers worth forwarding upstream. `cookie`, `host` and any inbound
 *  `authorization` are deliberately dropped. */
const FORWARDED_REQUEST_HEADERS = ["content-type", "accept", CORRELATION_HEADER];

function unauthenticated(detail: string): NextResponse {
  return NextResponse.json({ detail, correlation_id: null }, { status: 401 });
}

function buildTargetUrl(req: NextRequest, pathSegments: string[]): string {
  const path = pathSegments.map(encodeURIComponent).join("/");
  return `${API_BASE_URL}${BACKEND_API_PREFIX}/${path}${req.nextUrl.search}`;
}

async function forward(
  req: NextRequest,
  targetUrl: string,
  accessToken: string,
  body: ArrayBuffer | undefined,
): Promise<Response> {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${accessToken}`);

  return fetch(targetUrl, {
    method: req.method,
    headers,
    body: body && body.byteLength > 0 ? body : undefined,
    redirect: "manual",
    cache: "no-store",
  });
}

async function toNextResponse(
  upstream: Response,
  rotated: RefreshOk | null,
): Promise<NextResponse> {
  const buffer = await upstream.arrayBuffer();
  const headers = new Headers();

  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const correlationId = upstream.headers.get(CORRELATION_HEADER);
  if (correlationId) headers.set(CORRELATION_HEADER, correlationId);

  const res = new NextResponse(buffer, { status: upstream.status, headers });
  if (rotated) {
    setAuthCookies(res, {
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      accessMaxAge: rotated.accessMaxAge,
    });
  }
  return res;
}

export async function handleBffRequest(
  req: NextRequest,
  pathSegments: string[],
): Promise<NextResponse> {
  const blocked = csrfGuard(req);
  if (blocked) return blocked;

  const { accessToken, refreshToken } = readAuthCookies(req);

  if (!accessToken && !refreshToken) {
    return unauthenticated("Not authenticated.");
  }

  // Buffer the body once so the (rare) retry can replay it.
  const method = req.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : await req.arrayBuffer();

  const targetUrl = buildTargetUrl(req, pathSegments);

  let rotated: RefreshOk | null = null;
  let bearer = accessToken;

  // Step 2 — preemptive refresh.
  if ((!bearer || isExpiringSoon(bearer)) && refreshToken) {
    const result = await refreshTokens(refreshToken);
    if (!result.ok) {
      const res = unauthenticated("Session expired. Please sign in again.");
      clearAuthCookies(res);
      return res;
    }
    rotated = result;
    bearer = result.accessToken;
  }

  if (!bearer) {
    return unauthenticated("Not authenticated.");
  }

  // Step 3 — forward.
  let upstream = await forward(req, targetUrl, bearer, body);

  // Step 4 — one reactive refresh + retry, only if we have not refreshed yet.
  if (upstream.status === 401 && refreshToken && !rotated) {
    const result = await refreshTokens(refreshToken);
    if (!result.ok) {
      const res = unauthenticated("Session expired. Please sign in again.");
      clearAuthCookies(res);
      return res;
    }
    rotated = result;
    upstream = await forward(req, targetUrl, result.accessToken, body);
  }

  // Step 5 — relay.
  return toNextResponse(upstream, rotated);
}
