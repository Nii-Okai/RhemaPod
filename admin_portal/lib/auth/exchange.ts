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
 * ⚠️ SINGLE NEXT INSTANCE ONLY. The dedupe map is per Node process. Phase 1
 * ships as a single instance (or sticky sessions) by resolved decision 7; a
 * move to multi-instance reopens GATE 3 #9 (a backend reuse-grace window) and
 * must be taken *before* the topology changes, not after users get logged out.
 */

import { API_BASE_URL, BACKEND_API_PREFIX } from "./config";

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
    return { ok: false, status: 503 };
  }

  if (!res.ok) {
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
    return { ok: false, status: 502 };
  }
}

/**
 * Rotate the token pair. Concurrent calls with the same `refreshToken` in this
 * process share one upstream request and one result.
 *
 * NB: there is no `await` between the map lookup and the map set, so the first
 * synchronous caller always wins the race — the dedupe is real, not best-effort.
 */
export function refreshTokens(refreshToken: string): Promise<RefreshResult> {
  const existing = inFlight.get(refreshToken);
  if (existing) return existing;

  const pending = callRefresh(refreshToken).finally(() => {
    inFlight.delete(refreshToken);
  });
  inFlight.set(refreshToken, pending);
  return pending;
}

/** Test hook — clears the dedupe map between cases. Not used in app code. */
export function __resetRefreshDedupe(): void {
  inFlight.clear();
}
