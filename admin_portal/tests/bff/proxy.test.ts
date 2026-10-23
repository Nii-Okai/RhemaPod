import { NextRequest } from "next/server";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE, GET, POST } from "@/app/api/bff/[...path]/route";
import { __resetRefreshDedupe } from "@/lib/auth/exchange";

import { server } from "../msw/server";
import { API, makeJwt, makeRequest, parseSetCookies } from "./helpers";

function ctx(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

beforeEach(() => __resetRefreshDedupe());
afterEach(() => {
  __resetRefreshDedupe();
  vi.unstubAllEnvs();
});

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

  it("ignores an inbound browser X-Forwarded-For — no CLIENT_IP_HEADER, no forwarded IP", async () => {
    let seenXff: string | null = "unset";
    let seenRealIp: string | null = "unset";
    server.use(
      http.get(`${API}/api/v1/sermons`, ({ request }) => {
        seenXff = request.headers.get("x-forwarded-for");
        seenRealIp = request.headers.get("x-real-ip");
        return HttpResponse.json({ ok: true });
      }),
    );

    const res = await GET(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        cookies: { rp_at: makeJwt(3600) },
        // 100% attacker-controlled in the dev/compose topology — must not leak
        // through to the backend rate-limit key.
        headers: {
          "x-forwarded-for": "203.0.113.9, 10.0.0.1",
          "x-real-ip": "203.0.113.9",
        },
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(200);
    expect(seenXff).toBeNull();
    expect(seenRealIp).toBeNull();
  });

  it("forwards ONE validated X-Forwarded-For from the configured CLIENT_IP_HEADER, and no X-Real-IP", async () => {
    vi.stubEnv("CLIENT_IP_HEADER", "x-real-ip");
    let seenXff: string | null = "unset";
    let seenRealIp: string | null = "unset";
    server.use(
      http.get(`${API}/api/v1/sermons`, ({ request }) => {
        seenXff = request.headers.get("x-forwarded-for");
        seenRealIp = request.headers.get("x-real-ip");
        return HttpResponse.json({ ok: true });
      }),
    );

    const res = await GET(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        cookies: { rp_at: makeJwt(3600) },
        headers: {
          "x-real-ip": "198.51.100.7", // the trusted-hop value
          "x-forwarded-for": "203.0.113.9", // attacker noise — still ignored
        },
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(200);
    expect(seenXff).toBe("198.51.100.7");
    expect(seenRealIp).toBeNull();
  });

  it("forwards nothing when the configured CLIENT_IP_HEADER holds a non-IP value", async () => {
    vi.stubEnv("CLIENT_IP_HEADER", "x-real-ip");
    let seenXff: string | null = "unset";
    server.use(
      http.get(`${API}/api/v1/sermons`, ({ request }) => {
        seenXff = request.headers.get("x-forwarded-for");
        return HttpResponse.json({ ok: true });
      }),
    );

    const res = await GET(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        cookies: { rp_at: makeJwt(3600) },
        headers: { "x-real-ip": "not-an-ip" },
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(200);
    expect(seenXff).toBeNull();
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

  it.each([
    ["auth", "login"],
    ["auth", "refresh"],
    ["auth", "register"],
    ["auth", "reset-password"],
    ["auth", "forgot-password"],
    ["auth", "logout"],
  ])("404s the blocked prefix %s/%s", async (...segments) => {
    const res = await GET(
      makeRequest("http://localhost:3000/api/bff/x", {
        cookies: { rp_at: makeJwt(3600) },
      }),
      ctx(segments),
    );
    expect(res.status).toBe(404);
  });

  it("404s a case-variant blocked path (AUTH/Login)", async () => {
    const res = await GET(
      makeRequest("http://localhost:3000/api/bff/x", {
        cookies: { rp_at: makeJwt(3600) },
      }),
      ctx(["AUTH", "Login"]),
    );
    expect(res.status).toBe(404);
  });

  it("404s an empty-segment bypass (['', 'auth', 'login']) and never calls upstream (N2)", async () => {
    let called = false;
    server.use(
      http.post(`${API}/api/v1/auth/login`, () => {
        called = true;
        return HttpResponse.json({ access_token: "leaked", refresh_token: "leaked" });
      }),
    );

    const res = await POST(
      makeRequest("http://localhost:3000/api/bff/x", {
        method: "POST",
        cookies: { rp_at: makeJwt(3600) },
        body: { email: "a@b.c", password: "pw" },
        sameOrigin: true,
      }),
      ctx(["", "auth", "login"]),
    );

    expect(res.status).toBe(404);
    expect(called).toBe(false);
  });

  it("404s an encoded-slash segment (['auth//login'] from %2F%2F) and never calls upstream (N2)", async () => {
    let called = false;
    server.use(
      http.post(`${API}/api/v1/auth/login`, () => {
        called = true;
        return HttpResponse.json({ access_token: "leaked", refresh_token: "leaked" });
      }),
    );

    const res = await POST(
      makeRequest("http://localhost:3000/api/bff/x", {
        method: "POST",
        cookies: { rp_at: makeJwt(3600) },
        body: { email: "a@b.c", password: "pw" },
        sameOrigin: true,
      }),
      ctx(["auth//login"]),
    );

    expect(res.status).toBe(404);
    expect(called).toBe(false);
  });

  it("404s a leading-slash first segment (['/auth', 'login']) (N2)", async () => {
    let called = false;
    server.use(
      http.post(`${API}/api/v1/auth/login`, () => {
        called = true;
        return HttpResponse.json({ access_token: "leaked", refresh_token: "leaked" });
      }),
    );

    const res = await POST(
      makeRequest("http://localhost:3000/api/bff/x", {
        method: "POST",
        cookies: { rp_at: makeJwt(3600) },
        body: { email: "a@b.c", password: "pw" },
        sameOrigin: true,
      }),
      ctx(["/auth", "login"]),
    );

    expect(res.status).toBe(404);
    expect(called).toBe(false);
  });
});

describe("BFF proxy — dot-segment traversal", () => {
  it.each([
    [["x", "..", "auth", "login"]],
    [["sermons", "..", "..", "auth", "refresh"]],
    [[".", "auth", "login"]],
    [["x/../auth", "login"]],
  ])("404s %j and never calls upstream", async (segments) => {
    let called = false;
    server.use(
      http.post(`${API}/api/v1/auth/login`, () => {
        called = true;
        return HttpResponse.json({ access_token: "leaked", refresh_token: "leaked" });
      }),
      http.post(`${API}/api/v1/auth/refresh`, () => {
        called = true;
        return HttpResponse.json({ access_token: "leaked", refresh_token: "leaked" });
      }),
    );

    const res = await POST(
      makeRequest("http://localhost:3000/api/bff/x", {
        method: "POST",
        cookies: { rp_at: makeJwt(3600) },
        body: { email: "a@b.c", password: "pw" },
        sameOrigin: true,
      }),
      ctx(segments),
    );

    expect(res.status).toBe(404);
    expect(called).toBe(false);
  });
});

describe("BFF proxy — slow-body read timeout (security N1)", () => {
  it("408s a body that drips under the size cap, and never calls upstream", async () => {
    vi.stubEnv("BFF_BODY_READ_TIMEOUT_MS", "50");
    let called = false;
    server.use(
      http.post(`${API}/api/v1/sermons`, () => {
        called = true;
        return HttpResponse.json({});
      }),
    );

    // One chunk, then the stream neither pushes more nor closes — the read loop
    // would park indefinitely without the timeout.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
      },
    });
    const init = {
      method: "POST",
      headers: {
        cookie: `rp_at=${makeJwt(3600)}`,
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
      },
      body: stream,
      duplex: "half", // required for a stream body; absent from the lib types
    } as unknown as ConstructorParameters<typeof NextRequest>[1];
    const req = new NextRequest("http://localhost:3000/api/bff/sermons", init);

    const started = Date.now();
    const res = await POST(req, ctx(["sermons"]));

    expect(res.status).toBe(408);
    expect(called).toBe(false);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("lets a normal body through well inside the timeout", async () => {
    vi.stubEnv("BFF_BODY_READ_TIMEOUT_MS", "2000");
    let seenBody: string | null = null;
    server.use(
      http.post(`${API}/api/v1/sermons`, async ({ request }) => {
        seenBody = await request.text();
        return HttpResponse.json({ id: "s-1" }, { status: 201 });
      }),
    );

    const res = await POST(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        method: "POST",
        cookies: { rp_at: makeJwt(3600) },
        body: { title: "quick" },
        sameOrigin: true,
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(201);
    expect(seenBody).toBe(JSON.stringify({ title: "quick" }));
  });
});

describe("BFF proxy — request body size cap (security N1)", () => {
  it("413s a body over the cap and never calls upstream", async () => {
    let called = false;
    server.use(
      http.post(`${API}/api/v1/sermons`, () => {
        called = true;
        return HttpResponse.json({});
      }),
    );

    const huge = "x".repeat(1_000_001);
    const res = await POST(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        method: "POST",
        cookies: { rp_at: makeJwt(3600) },
        headers: { "content-type": "application/json" },
        body: huge,
        sameOrigin: true,
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(413);
    expect(called).toBe(false);
  });

  it("413s even when Content-Length understates the real body (stream-counted)", async () => {
    let called = false;
    server.use(
      http.post(`${API}/api/v1/sermons`, () => {
        called = true;
        return HttpResponse.json({});
      }),
    );

    const huge = "x".repeat(1_000_001);
    const res = await POST(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        method: "POST",
        cookies: { rp_at: makeJwt(3600) },
        headers: { "content-type": "application/json", "content-length": "10" },
        body: huge,
        sameOrigin: true,
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(413);
    expect(called).toBe(false);
  });

  it("allows the admin data import a larger body, and only that path", async () => {
    let seenBytes = 0;
    server.use(
      http.post(`${API}/api/v1/admin/data/import`, async ({ request }) => {
        seenBytes = (await request.arrayBuffer()).byteLength;
        return HttpResponse.json({ mode: "merge", dry_run: true, tables: [] });
      }),
    );

    const big = "x".repeat(2_000_000);
    const res = await POST(
      makeRequest("http://localhost:3000/api/bff/admin/data/import", {
        method: "POST",
        cookies: { rp_at: makeJwt(3600) },
        headers: { "content-type": "application/json" },
        body: big,
        sameOrigin: true,
      }),
      ctx(["admin", "data", "import"]),
    );
    expect(res.status).toBe(200);
    expect(seenBytes).toBe(2_000_000);

    const tooBig = "x".repeat(25 * 1024 * 1024 + 1);
    const refused = await POST(
      makeRequest("http://localhost:3000/api/bff/admin/data/import", {
        method: "POST",
        cookies: { rp_at: makeJwt(3600) },
        headers: { "content-type": "application/json" },
        body: tooBig,
        sameOrigin: true,
      }),
      ctx(["admin", "data", "import"]),
    );
    expect(refused.status).toBe(413);
  });

  it("lets a normal-sized body through", async () => {
    let seenBody: string | null = null;
    server.use(
      http.post(`${API}/api/v1/sermons`, async ({ request }) => {
        seenBody = await request.text();
        return HttpResponse.json({ id: "s-1" }, { status: 201 });
      }),
    );

    const res = await POST(
      makeRequest("http://localhost:3000/api/bff/sermons", {
        method: "POST",
        cookies: { rp_at: makeJwt(3600) },
        body: { title: "a normal sermon" },
        sameOrigin: true,
      }),
      ctx(["sermons"]),
    );

    expect(res.status).toBe(201);
    expect(seenBody).toBe(JSON.stringify({ title: "a normal sermon" }));
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
