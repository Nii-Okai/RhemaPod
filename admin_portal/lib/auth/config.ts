/**
 * BFF server-side configuration (plan §A.2 / §A.8).
 *
 * Both values are SERVER-ONLY — there is deliberately no `NEXT_PUBLIC_*` in
 * Phase 1. The browser never learns where FastAPI lives; it only ever talks to
 * this Next app, same-origin.
 */

/** FastAPI base URL. Server-to-server only. Local Docker stack default. */
export const API_BASE_URL: string =
  process.env.API_BASE_URL ?? "http://127.0.0.1:8000";

/**
 * The portal's own origin. The CSRF check on every mutating BFF request
 * compares the caller's `Origin` against this exact value (§A.2 "CSRF
 * posture"). `Sec-Fetch-Site: same-origin` is accepted as an alternative.
 */
export const PORTAL_ORIGIN: string =
  process.env.PORTAL_ORIGIN ?? "http://localhost:3000";

/**
 * `Secure` on the auth cookies is derived from `NODE_ENV`, never a flag — a
 * `Secure` cookie on `http://localhost` is silently dropped and login just
 * fails with no error (§A.8).
 */
export const IS_PROD: boolean = process.env.NODE_ENV === "production";

/** FastAPI mount prefix. The browser addresses the proxy without it; the BFF
 *  re-adds it when forwarding (§A.2). */
export const BACKEND_API_PREFIX = "/api/v1";
