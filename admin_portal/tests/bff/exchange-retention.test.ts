import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRefreshDedupe, refreshTokens } from "@/lib/auth/exchange";

import { server } from "../msw/server";
import { API } from "./helpers";

/**
 * The resolved-pair retention window (security L1 hardening, cut to 2s per N3):
 * a straggler presenting the just-rotated old refresh token is served the new
 * pair from the map rather than racing into a backend reuse-detection 401 — but
 * only for ~2s, after which the token is evicted and a genuine refresh runs.
 */
describe("refresh dedupe — resolved-pair retention", () => {
  beforeEach(() => {
    __resetRefreshDedupe();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetRefreshDedupe();
  });

  it("serves the rotated pair to a straggler for ~2s, then refreshes again", async () => {
    let calls = 0;
    server.use(
      http.post(`${API}/api/v1/auth/refresh`, () => {
        calls += 1;
        return HttpResponse.json({
          access_token: `at-${calls}`,
          refresh_token: `rt-${calls}`,
          expires_in: 900,
        });
      }),
    );

    const first = await refreshTokens("rt-old");
    expect(first.ok).toBe(true);
    expect(calls).toBe(1);

    // straggler inside the window — cache hit, no second upstream call
    const straggler = await refreshTokens("rt-old");
    expect(straggler).toEqual(first);
    expect(calls).toBe(1);

    // window elapses (2000ms TTL)
    await vi.advanceTimersByTimeAsync(2001);

    const afterWindow = await refreshTokens("rt-old");
    expect(afterWindow.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("does not retain a failed refresh", async () => {
    let calls = 0;
    server.use(
      http.post(`${API}/api/v1/auth/refresh`, () => {
        calls += 1;
        return HttpResponse.json({ detail: "reuse detected" }, { status: 401 });
      }),
    );

    const first = await refreshTokens("rt-burned");
    expect(first.ok).toBe(false);

    const second = await refreshTokens("rt-burned");
    expect(second.ok).toBe(false);
    expect(calls).toBe(2); // no caching of the failure
  });
});
