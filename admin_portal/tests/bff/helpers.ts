import { NextRequest } from "next/server";

/** FastAPI base the BFF forwards to (the code default; no env needed in tests). */
export const API = "http://127.0.0.1:8000";
/** The portal's own origin (the code default) — what the CSRF check compares. */
export const ORIGIN = "http://localhost:3000";

/**
 * Build a throwaway unsigned JWT. Only the `exp` claim matters — the proxy
 * decodes it without verifying (it is our own cookie). `secondsFromNow`
 * negative → an already-expired token.
 */
export function makeJwt(secondsFromNow: number, claims: Record<string, unknown> = {}): string {
  const seg = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return [
    seg({ alg: "HS256", typ: "JWT" }),
    seg({ sub: "user-1", type: "access", exp: now + secondsFromNow, ...claims }),
    "not-a-real-signature",
  ].join(".");
}

export interface ReqInit {
  method?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  /** default: adds `sec-fetch-site: same-origin` so the CSRF check passes. */
  sameOrigin?: boolean;
}

export function makeRequest(url: string, init: ReqInit = {}): NextRequest {
  const {
    method = "GET",
    cookies = {},
    headers = {},
    body,
    sameOrigin = true,
  } = init;

  const h = new Headers(headers);
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  if (cookieHeader) h.set("cookie", cookieHeader);
  if (sameOrigin && !h.has("sec-fetch-site") && !h.has("origin")) {
    h.set("sec-fetch-site", "same-origin");
  }

  const hasBody = body !== undefined && method !== "GET" && method !== "HEAD";
  if (hasBody && !h.has("content-type")) h.set("content-type", "application/json");

  return new NextRequest(url, {
    method,
    headers: h,
    body: hasBody
      ? typeof body === "string"
        ? body
        : JSON.stringify(body)
      : undefined,
  });
}

/** Parse Set-Cookie strings off a response into `{ name: { value, attrs } }`. */
export function parseSetCookies(res: Response): Record<
  string,
  { value: string; raw: string; attrs: Record<string, string | true> }
> {
  const out: Record<
    string,
    { value: string; raw: string; attrs: Record<string, string | true> }
  > = {};
  for (const raw of res.headers.getSetCookie()) {
    const [pair, ...rest] = raw.split("; ");
    const eq = pair.indexOf("=");
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const attrs: Record<string, string | true> = {};
    for (const part of rest) {
      const i = part.indexOf("=");
      if (i === -1) attrs[part.toLowerCase()] = true;
      else attrs[part.slice(0, i).toLowerCase()] = part.slice(i + 1);
    }
    out[name] = { value, raw, attrs };
  }
  return out;
}
