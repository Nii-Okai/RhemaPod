import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET, POST } from "@/app/api/bff/[...path]/route";
import { __resetRefreshDedupe } from "@/lib/auth/exchange";

import { server } from "../msw/server";
import { API, makeJwt, makeRequest, parseSetCookies } from "./helpers";

function ctx(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

beforeEach(() => __resetRefreshDedupe());
afterEach(() => __resetRefreshDedupe());

describe("BFF proxy — forwarding", () => {
  it("injects the rp_at bearer, re-adds /api/v1, and relays X-Correlation-ID", async () => {
    let seenAuth: string | null = null;
    let seenPath: string | null = null;
    let seenQuery: string | null = null;

    server.use(
      http.get(`${API}/api/v1/sermons`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        const u = new URL(request.url);
        seenPath = u.pathname;
        seenQuery = u.searchParams.get("status");
        return HttpResponse.json(
          { items: [], total: 0 },
          { headers: { "x-correlation-id": "cid-proxy-1" } },
        );
      }),
    );

    const at = makeJwt(3600);
    const res = await GET(
      makeRequest("http://localhost:3000/api/bff/sermons?status=draft", {
        cookies: { rp_at: at },
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(200);
    expect(seenAuth).toBe(`Bearer ${at}`);
    expect(seenPath).toBe("/api/v1/sermons");
    expect(seenQuery).toBe("draft");
    expect(res.headers.get("x-correlation-id")).toBe("cid-proxy-1");
  });

  it("returns 401 with no cookies present and never calls upstream", async () => {
    let called = false;
    server.use(
      http.get(`${API}/api/v1/sermons`, () => {
        called = true;
        return HttpResponse.json({});
      }),
    );

    const res = await GET(
      makeRequest("http://localhost:3000/api/bff/sermons", {}),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(401);
    expect(called).toBe(false);
  });
});

describe("BFF proxy — refresh", () => {
  it("on a 401, refreshes once, retries, and rotates both cookies", async () => {
    let sermonCalls = 0;
    let refreshCalls = 0;

    server.use(
      http.get(`${API}/api/v1/sermons`, ({ request }) => {
        sermonCalls += 1;
        const auth = request.headers.get("authorization");
        if (auth === "Bearer at-new") {
          return HttpResponse.json({ items: [], total: 1 });
        }
        return HttpResponse.json({ detail: "expired" }, { status: 401 });
      }),
      http.post(`${API}/api/v1/auth/refresh`, async ({ request }) => {
        refreshCalls += 1;
        const body = (await request.json()) as { refresh_token: string };
        expect(body.refresh_token).toBe("rt-old");
        return HttpResponse.json({
          access_token: "at-new",
          refresh_token: "rt-new",
          expires_in: 900,
        });
      }),
    );

    const res = await GET(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        cookies: { rp_at: makeJwt(3600), rp_rt: "rt-old" },
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(200);
    expect(refreshCalls).toBe(1);
    expect(sermonCalls).toBe(2); // initial 401 + one retry

    const cookies = parseSetCookies(res);
    expect(cookies.rp_at.value).toBe("at-new");
    expect(cookies.rp_rt.value).toBe("rt-new");
  });

  it("preemptively refreshes an access token within the 60s skew before forwarding", async () => {
    let refreshCalls = 0;
    let seenAuth: string | null = null;

    server.use(
      http.post(`${API}/api/v1/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({
          access_token: "at-fresh",
          refresh_token: "rt-fresh",
          expires_in: 900,
        });
      }),
      http.get(`${API}/api/v1/sermons`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json({ ok: true });
      }),
    );

    const res = await GET(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        cookies: { rp_at: makeJwt(30), rp_rt: "rt-old" }, // 30s left < 60s skew
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(200);
    expect(refreshCalls).toBe(1);
    expect(seenAuth).toBe("Bearer at-fresh");
    expect(parseSetCookies(res).rp_at.value).toBe("at-fresh");
  });

  it("clears both cookies and returns 401 when the refresh itself fails", async () => {
    server.use(
      http.get(`${API}/api/v1/sermons`, () =>
        HttpResponse.json({ detail: "expired" }, { status: 401 }),
      ),
      http.post(`${API}/api/v1/auth/refresh`, () =>
        HttpResponse.json({ detail: "reuse detected" }, { status: 401 }),
      ),
    );

    const res = await GET(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        cookies: { rp_at: makeJwt(3600), rp_rt: "rt-burned" },
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(401);
    const cookies = parseSetCookies(res);
    expect(cookies.rp_at.value).toBe("");
    expect(cookies.rp_at.attrs["max-age"]).toBe("0");
    expect(cookies.rp_rt.value).toBe("");
    expect(cookies.rp_rt.attrs["max-age"]).toBe("0");
  });

  it("dedupes concurrent refreshes to a single upstream call", async () => {
    let refreshCalls = 0;

    server.use(
      http.post(`${API}/api/v1/auth/refresh`, async () => {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 20)); // widen the race window
        return HttpResponse.json({
          access_token: "at-new",
          refresh_token: "rt-new",
          expires_in: 900,
        });
      }),
      http.get(`${API}/api/v1/sermons`, () => HttpResponse.json({ ok: true })),
    );

    const fire = () =>
      GET(
        makeRequest("http://localhost:3000/api/bff/sermons", {
          cookies: { rp_at: makeJwt(-10), rp_rt: "rt-old" }, // expired → refresh
        }),
        ctx(["sermons"]),
      );

    const results = await Promise.all([fire(), fire(), fire(), fire(), fire()]);

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(refreshCalls).toBe(1);
  });
});

describe("BFF proxy — CSRF", () => {
  it("403s a cross-origin mutating request and never calls upstream", async () => {
    let called = false;
    server.use(
      http.post(`${API}/api/v1/sermons`, () => {
        called = true;
        return HttpResponse.json({});
      }),
    );

    const res = await POST(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        method: "POST",
        cookies: { rp_at: makeJwt(3600) },
        headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
        body: { title: "x" },
        sameOrigin: false,
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(403);
    expect(called).toBe(false);
  });

  it("allows a same-origin mutating request through", async () => {
    server.use(
      http.post(`${API}/api/v1/sermons`, () =>
        HttpResponse.json({ id: "s-1" }, { status: 201 }),
      ),
    );

    const res = await POST(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        method: "POST",
        cookies: { rp_at: makeJwt(3600) },
        headers: { origin: "http://localhost:3000" },
        body: { title: "x" },
        sameOrigin: false,
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(201);
  });
});
