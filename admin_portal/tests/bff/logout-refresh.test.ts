import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as LOGOUT } from "@/app/api/auth/logout/route";
import { POST as REFRESH } from "@/app/api/auth/refresh/route";
import { __resetRefreshDedupe } from "@/lib/auth/exchange";

import { server } from "../msw/server";
import { API, makeJwt, makeRequest, parseSetCookies } from "./helpers";

beforeEach(() => __resetRefreshDedupe());
afterEach(() => __resetRefreshDedupe());

describe("POST /api/auth/logout", () => {
  it("revokes upstream, then clears both cookies", async () => {
    let revoked = false;
    server.use(
      http.post(`${API}/api/v1/auth/logout`, ({ request }) => {
        revoked = request.headers.get("authorization") === `Bearer ${"at"}`;
        return HttpResponse.json({ message: "Logged out" });
      }),
    );

    const res = await LOGOUT(
      makeRequest("http://localhost:3000/api/auth/logout", {
        method: "POST",
        cookies: { rp_at: "at", rp_rt: "rt" },
      }),
    );

    expect(res.status).toBe(200);
    expect(revoked).toBe(true);
    const c = parseSetCookies(res);
    expect(c.rp_at.attrs["max-age"]).toBe("0");
    expect(c.rp_rt.attrs["max-age"]).toBe("0");
  });

  it("clears cookies even when the upstream revoke fails", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/logout`, () =>
        HttpResponse.json({ detail: "boom" }, { status: 500 }),
      ),
    );

    const res = await LOGOUT(
      makeRequest("http://localhost:3000/api/auth/logout", {
        method: "POST",
        cookies: { rp_at: "at", rp_rt: "rt" },
      }),
    );

    expect(res.status).toBe(200);
    const c = parseSetCookies(res);
    expect(c.rp_at.attrs["max-age"]).toBe("0");
    expect(c.rp_rt.attrs["max-age"]).toBe("0");
  });

  it("403s a cross-origin logout", async () => {
    const res = await LOGOUT(
      makeRequest("http://localhost:3000/api/auth/logout", {
        method: "POST",
        cookies: { rp_at: "at" },
        headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
        sameOrigin: false,
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/auth/refresh", () => {
  it("rotates the pair and resets both cookies", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/refresh`, () =>
        HttpResponse.json({ access_token: "at-2", refresh_token: "rt-2", expires_in: 900 }),
      ),
    );

    const res = await REFRESH(
      makeRequest("http://localhost:3000/api/auth/refresh", {
        method: "POST",
        cookies: { rp_at: makeJwt(-5), rp_rt: "rt-1" },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const c = parseSetCookies(res);
    expect(c.rp_at.value).toBe("at-2");
    expect(c.rp_rt.value).toBe("rt-2");
  });

  it("clears cookies and 401s when there is no rp_rt", async () => {
    const res = await REFRESH(
      makeRequest("http://localhost:3000/api/auth/refresh", { method: "POST" }),
    );
    expect(res.status).toBe(401);
    const c = parseSetCookies(res);
    expect(c.rp_at.attrs["max-age"]).toBe("0");
    expect(c.rp_rt.attrs["max-age"]).toBe("0");
  });

  it("clears cookies and 401s when the upstream refresh is rejected", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/refresh`, () =>
        HttpResponse.json({ detail: "reuse detected" }, { status: 401 }),
      ),
    );

    const res = await REFRESH(
      makeRequest("http://localhost:3000/api/auth/refresh", {
        method: "POST",
        cookies: { rp_rt: "rt-burned" },
      }),
    );

    expect(res.status).toBe(401);
    expect(parseSetCookies(res).rp_rt.attrs["max-age"]).toBe("0");
  });
});
