/**
 * The one authenticated pass-through (plan §A.2 "Route families" +
 * "401 → refresh → retry"). Every browser data call reaches FastAPI through
 * here, and this is the only place an `Authorization` header is attached.
 *
 * handle(req):
 *   0. blocklist `auth/*` credential paths → 404 (security M1)
 *   1. Origin / Sec-Fetch-Site check on mutating methods → 403 if not same-origin
 *   2. read rp_at; if absent or within 60s of expiry and rp_rt exists →
 *      refresh preemptively (deduped)
 *   3. forward METHOD /api/v1/<path> with the bearer + a small header allowlist
 *   4. if the response is 401 and rp_rt exists and we have not refreshed yet →
 *      refresh once, forward once more
 *   5. return the upstream status + body + a header allowlist, plus Set-Cookie
 *      if a refresh rotated the pair
 *
 * A refresh that fails with a real auth error (401 — reuse/expired) clears both
 * cookies and returns 401. A refresh that fails with a 5xx (backend unreachable
 * / erroring) is a transient blip: relay 503, keep the cookies, and in the
 * preemptive path fall through with the current access token if it is still
 * present.
 */

import { NextResponse, type NextRequest } from "next/server";

import { logWarn } from "../log";
import { clientIpFrom, setForwardedFor } from "./client-ip";
import { setUserAgent, userAgentFrom } from "./user-agent";
import { API_BASE_URL, BACKEND_API_PREFIX } from "./config";
import {
  clearedUnauthorized,
  readAuthCookies,
  setAuthCookies,
} from "./cookies";
import { csrfGuard } from "./csrf";
import { refreshTokens, type RefreshOk } from "./exchange";
import { isExpiringSoon } from "./jwt";

const CORRELATION_HEADER = "x-correlation-id";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Request headers worth forwarding upstream. `cookie`, `host`, any inbound
 *  `authorization`, and an unvalidated `x-correlation-id` are deliberately
 *  dropped (the correlation id is handled separately — see `forward`). */
const FORWARDED_REQUEST_HEADERS = ["content-type", "accept"];

/** Response headers relayed back to the browser. */
const RELAYED_RESPONSE_HEADERS = [
  "content-type",
  "retry-after",
  "content-disposition", // for W9 downloads
];

/** Statuses whose responses must carry no body — `new NextResponse(buf, …)`
 *  throws on these, so the body has to be `null`. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** Real redirect statuses. 304 / 305 are NOT redirects (304 is handled as a
 *  null-body relay above). */
const REDIRECT_STATUSES = new Set([300, 301, 302, 303, 307, 308]);

/**
 * JSON-only through the BFF, buffered whole (the 401-replay path in step 4 has
 * to be able to re-send the body, which rules out streaming). Media PUTs go
 * browser → storage direct in W9 and never touch this route. 1 MB is a generous
 * ceiling for a JSON payload; anything larger is rejected 413.
 */
const MAX_BODY_BYTES = 1_000_000;

/**
 * Wall-clock ceiling on reading the request body off the stream. Without it a
 * slow drip that stays under `MAX_BODY_BYTES` parks a handler until Node's
 * ~300s `requestTimeout` — a cheap way to tie up this single-instance process.
 * Overridable via `BFF_BODY_READ_TIMEOUT_MS` (mainly so tests need not wait).
 * (security N1)
 */
const DEFAULT_BODY_READ_TIMEOUT_MS = 30_000;

function bodyReadTimeoutMs(): number {
  const raw = Number(process.env.BFF_BODY_READ_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BODY_READ_TIMEOUT_MS;
}

/** `auth/*` credential flows run ONLY through the dedicated `/api/auth/*`
 *  handlers. Blocked here so a same-origin/XSS caller cannot `POST
 *  /api/bff/auth/login` and read a raw `TokenPair` (incl. the 30-day refresh)
 *  out of a JS-readable body. `auth/me` stays allowed. (security M1) */
const BLOCKED_PROXY_PREFIXES = [
  "auth/login",
  "auth/refresh",
  "auth/register",
  "auth/reset-password",
  "auth/forgot-password",
  "auth/logout",
];

function isBlockedProxyPath(segments: string[]): boolean {
  // Normalize before matching so slash variants can't slip the blocklist —
  // nginx `merge_slashes` would collapse these upstream, so we must too:
  //   ["", "auth", "login"]        (leading //)      → "auth/login"
  //   ["auth", "", "login"]        (embedded //)     → "auth/login"
  //   ["auth//login"]              (%2F%2F decoded)  → "auth/login"
  //   ["/auth", "login"]           (leading-slash segment) → "auth/login"
  // Collapse runs of "/", strip a leading "/", then lowercase. (security N2)
  const path = segments
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/^\//, "")
    .toLowerCase();
  return BLOCKED_PROXY_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

function jsonError(status: number, detail: string): NextResponse {
  return NextResponse.json({ detail, correlation_id: null }, { status });
}

/** 503 for a transient backend failure — cookies are left intact. */
function serviceUnavailable(): NextResponse {
  return jsonError(503, "The service is unavailable. Try again shortly.");
}

/**
 * Read the request body, counting bytes off the stream and aborting the moment
 * the total passes `MAX_BODY_BYTES` — a `Content-Length` pre-check only stops
 * honest clients (a chunked or understated-length body would otherwise buffer
 * unbounded on this single-instance Node process). A wall-clock timeout
 * (`bodyReadTimeoutMs`) bounds a slow drip that never trips the size cap.
 * Returns the buffered body, `undefined` for an empty body, `"too-large"` to
 * reject with 413, or `"timeout"` to reject with 408. (security N1)
 */
async function readCappedBody(
  req: NextRequest,
): Promise<ArrayBuffer | undefined | "too-large" | "timeout"> {
  if (!req.body) {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_BODY_BYTES) return "too-large";
    return buf.byteLength > 0 ? buf : undefined;
  }

  const reader = req.body.getReader();
  const deadline = AbortSignal.timeout(bodyReadTimeoutMs());
  const onTimeout = () => {
    // Unblocks a pending reader.read() (it resolves { done: true }); the
    // deadline.aborted checks below turn that into a "timeout" result.
    void reader.cancel().catch(() => {});
  };
  deadline.addEventListener("abort", onTimeout, { once: true });

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return "too-large";
      }
      chunks.push(value);
    }
  } catch {
    if (deadline.aborted) return "timeout";
    throw new Error("bff_body_read_failed");
  } finally {
    deadline.removeEventListener("abort", onTimeout);
  }

  if (deadline.aborted) return "timeout";

  if (total === 0) return undefined;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

function buildTargetUrl(req: NextRequest, pathSegments: string[]): string {
  const path = pathSegments.map(encodeURIComponent).join("/");
  return `${API_BASE_URL}${BACKEND_API_PREFIX}/${path}${req.nextUrl.search}`;
}

/** Forward the client's `x-correlation-id` only when it is UUID-shaped;
 *  otherwise mint one so a forged / colliding id can't poison the audit
 *  trail. (security L3) */
function correlationIdFor(req: NextRequest): string {
  const inbound = req.headers.get(CORRELATION_HEADER);
  return inbound && UUID_RE.test(inbound) ? inbound : crypto.randomUUID();
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
  headers.set(CORRELATION_HEADER, correlationIdFor(req));
  headers.set("authorization", `Bearer ${accessToken}`);

  // Real client IP for the backend rate limiter (§A.10). Sourced only from the
  // configured trusted header (CLIENT_IP_HEADER) — never an inbound proxy
  // header the browser could have set — and forwarded as exactly one validated
  // X-Forwarded-For. Absent that config, nothing is forwarded and the backend
  // rate-limits per-BFF (and logs the fallback).
  setForwardedFor(headers, clientIpFrom(req));
  // Browser UA for the backend audit trail (staff mutations write it).
  setUserAgent(headers, userAgentFrom(req.headers));

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
  const headers = new Headers();
  for (const name of RELAYED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  const correlationId = upstream.headers.get(CORRELATION_HEADER);
  if (correlationId) headers.set(CORRELATION_HEADER, correlationId);

  const body = NULL_BODY_STATUSES.has(upstream.status)
    ? null
    : await upstream.arrayBuffer();

  const res = new NextResponse(body, { status: upstream.status, headers });
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
  if (isBlockedProxyPath(pathSegments)) {
    // 404, not 403 — do not confirm the route shape. (security M1)
    return jsonError(404, "Not found.");
  }

  const blocked = csrfGuard(req);
  if (blocked) return blocked;

  const { accessToken, refreshToken } = readAuthCookies(req);

  if (!accessToken && !refreshToken) {
    return jsonError(401, "Not authenticated.");
  }

  // Buffer the body once so the (rare) retry can replay it. JSON only, capped
  // by counting bytes off the stream (see `readCappedBody`).
  const method = req.method.toUpperCase();
  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const declaredLength = Number(req.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return jsonError(413, "Request body too large.");
    }
    const capped = await readCappedBody(req);
    if (capped === "too-large") {
      return jsonError(413, "Request body too large.");
    }
    if (capped === "timeout") {
      logWarn("bff_body_read_timeout", { path: pathSegments.join("/") });
      return jsonError(408, "Timed out reading the request body.");
    }
    body = capped;
  }

  const targetUrl = buildTargetUrl(req, pathSegments);

  let rotated: RefreshOk | null = null;
  let bearer = accessToken;

  const clientIp = clientIpFrom(req);

  // Step 2 — preemptive refresh.
  if ((!bearer || isExpiringSoon(bearer)) && refreshToken) {
    const result = await refreshTokens(refreshToken, clientIp);
    if (result.ok) {
      rotated = result;
      bearer = result.accessToken;
    } else if (result.status >= 500) {
      // Transient backend failure — do not end the session. Fall through with
      // the current access token if we still have one; otherwise this request
      // cannot proceed, but the cookies stay put.
      logWarn("bff_preemptive_refresh_unavailable", { status: result.status });
      if (!bearer) return serviceUnavailable();
    } else {
      return clearedUnauthorized();
    }
  }

  if (!bearer) {
    return jsonError(401, "Not authenticated.");
  }

  // Step 3 — forward.
  let upstream = await forward(req, targetUrl, bearer, body);

  // Step 4 — one reactive refresh + retry, only if we have not refreshed yet.
  if (upstream.status === 401 && refreshToken && !rotated) {
    const result = await refreshTokens(refreshToken, clientIp);
    if (result.ok) {
      rotated = result;
      upstream = await forward(req, targetUrl, result.accessToken, body);
    } else if (result.status >= 500) {
      logWarn("bff_reactive_refresh_unavailable", { status: result.status });
      return serviceUnavailable();
    } else {
      return clearedUnauthorized();
    }
  }

  // An unexpected upstream redirect: `redirect: "manual"` already stopped the
  // bearer from following it, but the bodyless 3xx is meaningless to the
  // browser here — map it to 502. (security L4)
  if (
    upstream.type === "opaqueredirect" ||
    REDIRECT_STATUSES.has(upstream.status)
  ) {
    logWarn("bff_unexpected_upstream_redirect", { status: upstream.status });
    return jsonError(502, "Unexpected upstream response.");
  }

  // Step 5 — relay.
  return toNextResponse(upstream, rotated);
}
