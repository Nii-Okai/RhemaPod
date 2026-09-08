/**
 * The two auth cookies and their attributes.
 *
 * Both tokens live in httpOnly cookies — the browser never holds a bearer
 * token and never reads one from `document.cookie`. The cookie *value* is a
 * backend-signed JWT; there is deliberately no second Next-side signature
 * (plan §A.2 "No Next-side cookie signing secret").
 *
 * ── Cookie spec (W4 fix pass — supersedes the plan §A.2 attribute table) ──
 * Ruled by the mandatory security-reviewer pass on W4:
 *
 *   | cookie  | name (prod)      | name (dev) | Path   | SameSite | Secure    |
 *   |---------|------------------|------------|--------|----------|-----------|
 *   | access  | `__Host-rp_at`   | `rp_at`    | `/`    | Lax      | prod only |
 *   | refresh | `__Secure-rp_rt` | `rp_rt`    | `/api` | Strict   | prod only |
 *
 *   • The `__Host-` / `__Secure-` prefixes are INVALID without `Secure`
 *     (`__Host-` also requires `Path=/` and no `Domain`). On `http://localhost`
 *     in dev a prefixed cookie is rejected outright by the browser, so the bare
 *     names are used there. Name and `Secure` are gated on the SAME `IS_PROD`
 *     condition.
 *   • The plan's `rp_at=/api, rp_rt=/api/auth` split broke the approved control
 *     flow — the RSC bootstrap reads `rp_at` on document navigations (not under
 *     `/api`) and the proxy reads `rp_rt` under `/api/bff/*` (not under
 *     `/api/auth`). `rp_at` widens to `/`; `rp_rt` sits at `/api`, which covers
 *     both `/api/bff/*` and `/api/auth/*` while keeping the 30-day credential
 *     off document navigations and the `/_next` asset stream.
 *   • The per-cookie `Path` is applied in BOTH `setAuthCookies` and
 *     `clearAuthCookies` (via the shared specs below) — a split in only one
 *     place means logout stops clearing `rp_rt`.
 *
 * Deployment assumption this rests on: the portal runs on a hostname with no
 * attacker-influenceable sibling subdomains under the registrable domain. If
 * that stops holding, revisit whether `rp_rt` should take `__Host-` (accepting
 * `Path=/`).
 */

import { NextResponse, type NextRequest } from "next/server";

import { IS_PROD } from "./config";

export const AT_COOKIE = IS_PROD ? "__Host-rp_at" : "rp_at";
export const RT_COOKIE = IS_PROD ? "__Secure-rp_rt" : "rp_rt";

/**
 * Per-cookie name + Path + SameSite, shared by set and clear so they can never
 * drift. `rp_at` at `/` (RSC reads it on navigations); `rp_rt` at `/api`
 * (covers `/api/bff/*` and `/api/auth/*`, nothing else).
 */
const AT_SPEC = { name: AT_COOKIE, path: "/", sameSite: "lax" as const };
const RT_SPEC = { name: RT_COOKIE, path: "/api", sameSite: "strict" as const };

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
   * only ever *shortens* the credential lifetime relative to the spec, so it
   * is a security-positive deviation. Defaults to `true`.
   */
  remember?: boolean;
}

/** Write `rp_at` + `rp_rt` onto a response with their fixed attributes. */
export function setAuthCookies(
  res: NextResponse,
  { accessToken, refreshToken, accessMaxAge, remember = true }: SetAuthCookiesInput,
): void {
  res.cookies.set(AT_SPEC.name, accessToken, {
    httpOnly: true,
    sameSite: AT_SPEC.sameSite,
    secure: IS_PROD,
    path: AT_SPEC.path,
    maxAge:
      accessMaxAge && accessMaxAge > 0
        ? accessMaxAge
        : ACCESS_MAX_AGE_FALLBACK_SECONDS,
  });

  res.cookies.set(RT_SPEC.name, refreshToken, {
    httpOnly: true,
    sameSite: RT_SPEC.sameSite,
    secure: IS_PROD,
    path: RT_SPEC.path,
    ...(remember ? { maxAge: REFRESH_MAX_AGE_SECONDS } : {}),
  });
}

/**
 * Clear both cookies with `Max-Age=0` on the exact same name / Path / SameSite
 * they were set with — a mismatched attribute leaves a live cookie behind
 * (plan §A.2 "Logout"). Called on logout and whenever a refresh fails with a
 * real auth error.
 */
export function clearAuthCookies(res: NextResponse): void {
  for (const spec of [AT_SPEC, RT_SPEC]) {
    res.cookies.set(spec.name, "", {
      httpOnly: true,
      sameSite: spec.sameSite,
      secure: IS_PROD,
      path: spec.path,
      maxAge: 0,
    });
  }
}

/**
 * A 401 that also clears both auth cookies — the response for a refresh that
 * failed with a real auth error (reuse detected / expired RT), and for a
 * missing refresh cookie. Extracted so the proxy and the `/api/auth/refresh`
 * route build it identically (a 5xx from `/auth/refresh` must NOT come here —
 * that is a transient backend blip, not a reason to end every session).
 */
export function clearedUnauthorized(
  detail = "Session expired. Please sign in again.",
): NextResponse {
  const res = NextResponse.json({ detail, correlation_id: null }, { status: 401 });
  clearAuthCookies(res);
  return res;
}
