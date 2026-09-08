/**
 * Refresh-token exchange with per-process in-flight dedupe (plan §A.2, the
 * "concurrency hazard", mitigation 2; resolved decision 7).
 *
 * FastAPI rotates the refresh token on every `/auth/refresh` and burns the old
 * `jti` in Redis. A Sermons page load fires several parallel proxy requests; if
 * each independently found an expired access token and called `/auth/refresh`,
 * all but the first would present an already-burned `jti` → cascading 401 → the
 * user is logged out mid-session.
 *
 * Two things prevent that here:
 *   1. Preemptive refresh with a 60s skew (see `isExpiringSoon`) means the
 *      reactive path is rare — most refreshes happen on a single request.
 *   2. This module keeps a module-scope `Map<refreshToken, Promise<Result>>`.
 *      Concurrent callers presenting the same refresh token await the *same*
 *      promise, so exactly one `/auth/refresh` call goes out.
 *
 * A resolved rotation is also kept in the map keyed by the *old* refresh token
 * for a short window (`RESULT_TTL_MS`) rather than being dropped the instant it
 * settles: a straggler tab — or a second parallel page load — that still holds
 * the pre-rotation token then gets handed the new pair instead of racing into a
 * backend reuse-detection 401 that would clear cookies for the whole browser.
 *
 * ⚠️ SINGLE NEXT INSTANCE ONLY. The dedupe map and the short-lived result
 * retention are both per Node process. Phase 1 ships as a single instance (or
 * sticky sessions) by resolved decision 7; a move to multi-instance reopens
 * GATE 3 #9 (a backend reuse-grace window) and must be taken *before* the
 * topology changes, not after users get logged out.
 */

import { API_BASE_URL, BACKEND_API_PREFIX } from "./config";
import { logError, logWarn } from "../log";

export interface RefreshOk {
  ok: true;
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds (`expires_in` from the token pair). */
  accessMaxAge: number;
}

export interface RefreshFail {
  ok: false;
  /** Upstream status, or 503 when `/auth/refresh` could not be reached. */
  status: number;
}

export type RefreshResult = RefreshOk | RefreshFail;

/** How long a resolved rotation stays addressable by the old refresh token. */
const RESULT_TTL_MS = 10_000;

const inFlight = new Map<string, Promise<RefreshResult>>();

async function callRefresh(refreshToken: string): Promise<RefreshResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${BACKEND_API_PREFIX}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    });
  } catch {
    logError("bff_refresh_upstream_unreachable");
    return { ok: false, status: 503 };
  }

  if (!res.ok) {
    if (res.status >= 500) {
      logWarn("bff_refresh_upstream_5xx", { status: res.status });
    }
    return { ok: false, status: res.status };
  }

  try {
    const body = (await res.json()) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
    };
    if (
      typeof body.access_token !== "string" ||
      typeof body.refresh_token !== "string"
    ) {
      logError("bff_refresh_upstream_bad_response");
      return { ok: false, status: 502 };
    }
    return {
      ok: true,
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      accessMaxAge:
        typeof body.expires_in === "number" && body.expires_in > 0
          ? body.expires_in
          : 15 * 60,
    };
  } catch {
    logError("bff_refresh_upstream_bad_response");
    return { ok: false, status: 502 };
  }
}

/**
 * Rotate the token pair. Concurrent calls with the same `refreshToken` in this
 * process share one upstream request and one result; a *successful* result then
 * stays cached under that same (now-rotated) token for `RESULT_TTL_MS` so a
 * straggler caller is served the new pair instead of a reuse-detection 401.
 *
 * NB: there is no `await` between the map lookup and the map set, so the first
 * synchronous caller always wins the race — the dedupe is real, not best-effort.
 */
export function refreshTokens(refreshToken: string): Promise<RefreshResult> {
  const existing = inFlight.get(refreshToken);
  if (existing) return existing;

  const pending = callRefresh(refreshToken).then((result) => {
    if (result.ok) {
      // Keep serving this resolved pair to stragglers for a short window. The
      // timer must not hold the process open on its own.
      const timer = setTimeout(
        () => inFlight.delete(refreshToken),
        RESULT_TTL_MS,
      ) as unknown as { unref?: () => void };
      timer.unref?.();
    } else {
      inFlight.delete(refreshToken);
    }
    return result;
  });
  inFlight.set(refreshToken, pending);
  return pending;
}

/** Test hook — clears the dedupe map between cases. Not used in app code. */
export function __resetRefreshDedupe(): void {
  inFlight.clear();
}
