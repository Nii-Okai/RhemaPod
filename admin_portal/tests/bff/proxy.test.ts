import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DELETE, GET, POST } from "@/app/api/bff/[...path]/route";
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

  it("403s a mutating request carrying neither Origin nor Sec-Fetch-Site (fail-closed)", async () => {
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
        body: { title: "x" },
        // no Origin, no Sec-Fetch-Site, sameOrigin not opted in
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(403);
    expect(called).toBe(false);
  });
});

describe("BFF proxy — null-body upstream statuses", () => {
  it("relays a 204 without throwing", async () => {
    server.use(
      http.delete(`${API}/api/v1/sermons/s-1`, () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );

    const res = await DELETE(
      makeRequest("http://localhost:3000/api/bff/sermons/s-1", {
        method: "DELETE",
        cookies: { rp_at: makeJwt(3600) },
        sameOrigin: true,
      }),
      ctx(["sermons", "s-1"]),
    );

    expect(res.status).toBe(204);
  });

  it("relays a 304 without throwing", async () => {
    server.use(
      http.get(`${API}/api/v1/sermons`, () =>
        new HttpResponse(null, { status: 304 }),
      ),
    );

    const res = await GET(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        cookies: { rp_at: makeJwt(3600) },
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(304);
  });
});

describe("BFF proxy — header hygiene", () => {
  it("strips inbound Authorization and Cookie; upstream sees only the BFF bearer", async () => {
    let seenAuth: string | null = null;
    let seenCookie: string | null = null;

    server.use(
      http.get(`${API}/api/v1/sermons`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        seenCookie = request.headers.get("cookie");
        return HttpResponse.json({ ok: true });
      }),
    );

    const at = makeJwt(3600);
    const res = await GET(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        cookies: { rp_at: at, rp_rt: "rt-secret" },
        headers: { authorization: "Bearer client-forged" },
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(200);
    expect(seenAuth).toBe(`Bearer ${at}`);
    expect(seenCookie).toBeNull();
  });

  it("forwards a client x-correlation-id only when it is UUID-shaped", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${API}/api/v1/sermons`, ({ request }) => {
        seen.push(request.headers.get("x-correlation-id"));
        return HttpResponse.json({ ok: true });
      }),
    );

    const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    await GET(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        cookies: { rp_at: makeJwt(3600) },
        headers: { "x-correlation-id": uuid },
      }),
      ctx(["sermons"]),
    );
    await GET(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        cookies: { rp_at: makeJwt(3600) },
        headers: { "x-correlation-id": "not-a-uuid; drop tables" },
      }),
      ctx(["sermons"]),
    );

    expect(seen[0]).toBe(uuid);
    expect(seen[1]).not.toBe("not-a-uuid; drop tables");
    expect(seen[1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

describe("BFF proxy — auth-path blocklist (security M1)", () => {
  it("404s POST /api/bff/auth/login and never calls upstream", async () => {
    let called = false;
    server.use(
      http.post(`${API}/api/v1/auth/login`, () => {
        called = true;
        return HttpResponse.json({ access_token: "leaked", refresh_token: "leaked" });
      }),
    );

    const res = await POST(
      makeRequest("http://localhost:3000/api/bff/auth/login", {
        method: "POST",
        cookies: { rp_at: makeJwt(3600) },
        body: { email: "a@b.c", password: "pw" },
        sameOrigin: true,
      }),
      ctx(["auth", "login"]),
    );

    expect(res.status).toBe(404);
    expect(called).toBe(false);
  });

  it("still lets GET /api/bff/auth/me through", async () => {
    let called = false;
    server.use(
      http.get(`${API}/api/v1/auth/me`, () => {
        called = true;
        return HttpResponse.json({ id: "u-1", email: "a@b.c", role: "editor" });
      }),
    );

    const res = await GET(
      makeRequest("http://localhost:3000/api/bff/auth/me", {
        cookies: { rp_at: makeJwt(3600) },
      }),
      ctx(["auth", "me"]),
    );

    expect(res.status).toBe(200);
    expect(called).toBe(true);
  });
});

describe("BFF proxy — refresh 5xx is not terminal", () => {
  it("recovers from a non-JWT rp_at by refreshing before forwarding", async () => {
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
        cookies: { rp_at: "not-a-jwt", rp_rt: "rt-old" },
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(200);
    expect(refreshCalls).toBe(1);
    expect(seenAuth).toBe("Bearer at-fresh");
  });

  it("relays 503 and keeps cookies when a preemptive refresh 5xxs and there is no usable access token", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/refresh`, () =>
        HttpResponse.json({ detail: "db down" }, { status: 500 }),
      ),
      http.get(`${API}/api/v1/sermons`, () => HttpResponse.json({ ok: true })),
    );

    const res = await GET(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        cookies: { rp_rt: "rt-live" }, // no rp_at at all
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(503);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("forwards with the still-valid rp_at when a preemptive refresh 5xxs", async () => {
    let refreshCalls = 0;
    let seenAuth: string | null = null;
    const at = makeJwt(30); // inside the 60s skew but not expired

    server.use(
      http.post(`${API}/api/v1/auth/refresh`, () => {
        refreshCalls += 1;
        return HttpResponse.json({ detail: "db down" }, { status: 503 });
      }),
      http.get(`${API}/api/v1/sermons`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json({ ok: true });
      }),
    );

    const res = await GET(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        cookies: { rp_at: at, rp_rt: "rt-live" },
      }),
      ctx(["sermons"]),
    );

    expect(refreshCalls).toBe(1);
    expect(res.status).toBe(200);
    expect(seenAuth).toBe(`Bearer ${at}`);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });
});
