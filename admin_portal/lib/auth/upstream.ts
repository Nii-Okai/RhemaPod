/**
 * Small helpers shared by the `/api/auth/*` route handlers (plan §A.2
 * "Route families"). Each of those routes is a thin server-to-server call to
 * FastAPI with cookie handling layered on top.
 */

import { NextResponse } from "next/server";

import { logError } from "../log";
import { forwardedForHeaders } from "./client-ip";
import { API_BASE_URL, BACKEND_API_PREFIX } from "./config";

const CORRELATION_HEADER = "x-correlation-id";

export interface UpstreamResponse {
  status: number;
  ok: boolean;
  body: unknown;
  correlationId: string | null;
  retryAfter: string | null;
}

/**
 * POST JSON to `${API_BASE_URL}/api/v1<path>` and read the envelope back.
 * `clientIp` (the real browser IP — plan §A.10) is forwarded as
 * `X-Forwarded-For` / `X-Real-IP` so the backend rate limiter keys per staff
 * member, not per BFF instance.
 */
export async function postUpstream(
  path: string,
  payload: unknown,
  clientIp?: string | null,
): Promise<UpstreamResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${BACKEND_API_PREFIX}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...forwardedForHeaders(clientIp ?? null),
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    logError("bff_auth_upstream_unreachable", { path });
    return {
      status: 503,
      ok: false,
      body: { detail: "The service is unavailable. Try again shortly.", correlation_id: null },
      correlationId: null,
      retryAfter: null,
    };
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return {
    status: res.status,
    ok: res.ok,
    body,
    correlationId: res.headers.get(CORRELATION_HEADER),
    retryAfter: res.headers.get("retry-after"),
  };
}

/**
 * Relay an upstream failure to the browser verbatim — same status, same
 * `{detail, correlation_id}` envelope, the `X-Correlation-ID` header, and
 * `Retry-After` when the upstream sent one (the 429 case the Login screen
 * surfaces as a retry-window alert).
 */
export function relayUpstreamError(upstream: UpstreamResponse): NextResponse {
  const headers = new Headers();
  if (upstream.correlationId) {
    headers.set(CORRELATION_HEADER, upstream.correlationId);
  }
  if (upstream.retryAfter) {
    headers.set("retry-after", upstream.retryAfter);
  }
  const body =
    upstream.body && typeof upstream.body === "object"
      ? upstream.body
      : { detail: "Request failed.", correlation_id: upstream.correlationId };
  return NextResponse.json(body, { status: upstream.status, headers });
}
