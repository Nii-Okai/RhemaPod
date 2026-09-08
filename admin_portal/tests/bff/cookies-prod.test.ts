import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseSetCookies } from "./helpers";

/**
 * `IS_PROD` (and therefore the cookie names + `Secure`) is resolved from
 * `NODE_ENV` at module load, so the prod branch has to be exercised by
 * re-importing the cookie module under a stubbed env. Paths (`/` vs `/api`) are
 * NOT env-gated, but they are pinned here too so the whole prod matrix lives in
 * one place.
 *
 * `setAuthCookies` / `clearAuthCookies` only mutate the response passed in, so a
 * statically-imported `NextResponse` is fine alongside the freshly-imported
 * module.
 */
describe("auth cookies — production branch", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("setAuthCookies: __Host-/__Secure- names, Secure, and the / vs /api path split", async () => {
    const { setAuthCookies } = await import("@/lib/auth/cookies");

    const res = NextResponse.json({});
    setAuthCookies(res, {
      accessToken: "at",
      refreshToken: "rt",
      accessMaxAge: 900,
    });

    const c = parseSetCookies(res);

    expect(c["__Host-rp_at"]).toBeDefined();
    expect(c["__Host-rp_at"].value).toBe("at");
    expect(c["__Host-rp_at"].attrs.secure).toBe(true);
    expect(c["__Host-rp_at"].attrs.httponly).toBe(true);
    expect(c["__Host-rp_at"].attrs.path).toBe("/");
    expect(String(c["__Host-rp_at"].attrs.samesite).toLowerCase()).toBe("lax");

    expect(c["__Secure-rp_rt"]).toBeDefined();
    expect(c["__Secure-rp_rt"].value).toBe("rt");
    expect(c["__Secure-rp_rt"].attrs.secure).toBe(true);
    expect(c["__Secure-rp_rt"].attrs.httponly).toBe(true);
    expect(c["__Secure-rp_rt"].attrs.path).toBe("/api");
    expect(String(c["__Secure-rp_rt"].attrs.samesite).toLowerCase()).toBe("strict");

    // the bare dev names must NOT also be emitted
    expect(c["rp_at"]).toBeUndefined();
    expect(c["rp_rt"]).toBeUndefined();
  });

  it("clearAuthCookies: same prod names + paths, Max-Age=0 on both", async () => {
    const { clearAuthCookies } = await import("@/lib/auth/cookies");

    const res = NextResponse.json({});
    clearAuthCookies(res);

    const c = parseSetCookies(res);

    expect(c["__Host-rp_at"].attrs.path).toBe("/");
    expect(c["__Host-rp_at"].attrs["max-age"]).toBe("0");
    expect(c["__Secure-rp_rt"].attrs.path).toBe("/api");
    expect(c["__Secure-rp_rt"].attrs["max-age"]).toBe("0");
  });
});
