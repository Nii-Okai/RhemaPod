/**
 * The two auth cookies and their attributes (plan §A.2 "Token storage").
 *
 * Both tokens live in httpOnly cookies — the browser never holds a bearer
 * token and never reads one from `document.cookie`. The cookie *value* is a
 * backend-signed JWT; there is deliberately no second Next-side signature
 * (§A.2 "No Next-side cookie signing secret").
 *
 * ── Path reconciliation (flagged for the mandatory security-reviewer) ──
 * The GATE 2 attribute table scopes `rp_at` to `Path=/api` and `rp_rt` to
 * `Path=/api/auth`. Cookie `Path` is a *browser send-filter*, not server-side
 * scoping, and two pieces of the same approved design cannot work under those
 * paths:
 *
 *   • `(portal)/layout.tsx` reads `rp_at` server-side on document navigations
 *     to `/sermons`, `/review`, … — none of which match `Path=/api`.
 *   • the `/api/bff/[...path]` proxy must read `rp_rt` to self-refresh on a
 *     401 and to dedupe concurrent refreshes (a GATE 2 acceptance criterion) —
 *     `/api/bff/*` never matches `Path=/api/auth`.
 *
 * Widening both to `Path=/` is the smallest change that makes the approved
 * control flow function. The load-bearing protections are unchanged: HttpOnly,
 * SameSite (Lax on the access cookie, Strict on the refresh cookie),
 * Secure in production, and no JS readability. `rp_rt` keeping `SameSite=Strict`
 * is what actually defends the long-lived credential here.
 */

import type { NextRequest, NextResponse } from "next/server";

import { IS_PROD } from "./config";

export const AT_COOKIE = "rp_at";
export const RT_COOKIE = "rp_rt";

/** See the Path reconciliation note above. */
const COOKIE_PATH = "/";

/**
 * Refresh-token lifetime. FastAPI's `refresh_token_expire_days` is 30 and the
 * BFF is not told it over the wire, so it is pinned here to match
 * `app/core/config.py`. If that backend default changes, change this too.
 */
export const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Fallback access-cookie lifetime if a login response omits `expires_in`
 *  (FastAPI's `access_token_expire_minutes` is 15). */
export const ACCESS_MAX_AGE_FALLBACK_SECONDS = 15 * 60;

export interface AuthCookieValues {
  accessToken?: string;
  refreshToken?: string;
}

/** Read both auth cookies off an incoming request. */
export function readAuthCookies(req: NextRequest): AuthCookieValues {
  return {
    accessToken: req.cookies.get(AT_COOKIE)?.value,
    refreshToken: req.cookies.get(RT_COOKIE)?.value,
  };
}

export interface SetAuthCookiesInput {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds, from the login/refresh `expires_in`. */
  accessMaxAge?: number;
  /**
   * "Keep me signed in". When `false`, the refresh cookie is written as a
   * session cookie (no `Max-Age`) so it clears when the browser closes. This
   * only ever *shortens* the credential lifetime relative to the GATE 2 table,
   * so it is a security-positive deviation. Defaults to `true`.
   */
  remember?: boolean;
}

/** Write `rp_at` + `rp_rt` onto a response with their fixed attributes. */
export function setAuthCookies(
  res: NextResponse,
  { accessToken, refreshToken, accessMaxAge, remember = true }: SetAuthCookiesInput,
): void {
  res.cookies.set(AT_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PROD,
    path: COOKIE_PATH,
    maxAge: accessMaxAge && accessMaxAge > 0
      ? accessMaxAge
      : ACCESS_MAX_AGE_FALLBACK_SECONDS,
  });

  res.cookies.set(RT_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: IS_PROD,
    path: COOKIE_PATH,
    ...(remember ? { maxAge: REFRESH_MAX_AGE_SECONDS } : {}),
  });
}

/**
 * Clear both cookies with `Max-Age=0` on the exact same attributes they were
 * set with — a mismatched attribute leaves a live cookie behind (§A.2
 * "Logout"). Called on logout and whenever a refresh fails.
 */
export function clearAuthCookies(res: NextResponse): void {
  for (const name of [AT_COOKIE, RT_COOKIE] as const) {
    res.cookies.set(name, "", {
      httpOnly: true,
      sameSite: name === RT_COOKIE ? "strict" : "lax",
      secure: IS_PROD,
      path: COOKIE_PATH,
      maxAge: 0,
    });
  }
}
