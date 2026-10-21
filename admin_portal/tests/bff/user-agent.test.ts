/**
 * Browser `User-Agent` forwarding to FastAPI (plans/plan-admin-settings.md S8):
 * every BFF → backend call is a server-side fetch, so without this the audit
 * trail would record Node's UA. Covers the sanitiser and each call path whose
 * backend handler writes an audit row: login, logout, set-password, and the
 * generic proxy (staff mutations).
 */
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { POST as LOGIN } from "@/app/api/auth/login/route";
import { POST as LOGOUT } from "@/app/api/auth/logout/route";
import { POST as SET_PASSWORD } from "@/app/api/auth/set-password/route";
import { PATCH } from "@/app/api/bff/[...path]/route";
import { __resetRefreshDedupe } from "@/lib/auth/exchange";
import { userAgentFrom } from "@/lib/auth/user-agent";

import { server } from "../msw/server";
import { API, makeJwt, makeRequest } from "./helpers";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Safari/605.1.15";

beforeEach(() => __resetRefreshDedupe());

describe("userAgentFrom", () => {
  it("returns the inbound UA unchanged when it is clean", () => {
    expect(userAgentFrom(new Headers({ "user-agent": BROWSER_UA }))).toBe(BROWSER_UA);
  });

  it("returns null when the header is absent or blank", () => {
    expect(userAgentFrom(new Headers())).toBeNull();
    expect(userAgentFrom(new Headers({ "user-agent": "   " }))).toBeNull();
  });

  it("truncates to the audit column's 512 characters", () => {
    const long = "A".repeat(600);
    expect(userAgentFrom(new Headers({ "user-agent": long }))).toHaveLength(512);
  });

  it("strips control characters so the value cannot split a header", () => {
    // `Headers` itself refuses CR/LF on construction, so feed the raw string
    // through a stub carrying what a lenient upstream parser could hand over.
    const stub = { get: () => "Agent\r\nX-Injected: 1\u0000" } as unknown as Headers;
    expect(userAgentFrom(stub)).toBe("AgentX-Injected: 1");
  });
});

describe("forwarding to FastAPI", () => {
  it("login forwards the browser UA", async () => {
    let seen: string | null = null;
    server.use(
      http.post(`${API}/api/v1/auth/login`, ({ request }) => {
        seen = request.headers.get("user-agent");
        return HttpResponse.json(
          { detail: "Invalid email or password", correlation_id: "c" },
          { status: 401 },
        );
      }),
    );

    const res = await LOGIN(
      makeRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
        body: { email: "ada@grace.church", password: "pw" },
        sameOrigin: true,
        headers: { "user-agent": BROWSER_UA },
      }),
    );

    expect(res.status).toBe(401);
    expect(seen).toBe(BROWSER_UA);
  });

  it("logout forwards the browser UA", async () => {
    let seen: string | null = null;
    server.use(
      http.post(`${API}/api/v1/auth/logout`, ({ request }) => {
        seen = request.headers.get("user-agent");
        return HttpResponse.json({ message: "Logged out" });
      }),
    );

    await LOGOUT(
      makeRequest("http://localhost:3000/api/auth/logout", {
        method: "POST",
        cookies: { rp_at: "at", rp_rt: "rt" },
        sameOrigin: true,
        headers: { "user-agent": BROWSER_UA },
      }),
    );

    expect(seen).toBe(BROWSER_UA);
  });

  it("set-password forwards the browser UA", async () => {
    let seen: string | null = null;
    server.use(
      http.post(`${API}/api/v1/auth/reset-password`, ({ request }) => {
        seen = request.headers.get("user-agent");
        return HttpResponse.json({ message: "ok" });
      }),
    );

    const res = await SET_PASSWORD(
      makeRequest("http://localhost:3000/api/auth/set-password", {
        method: "POST",
        body: { token: "t", password: "a-long-password" },
        sameOrigin: true,
        headers: { "user-agent": BROWSER_UA },
      }),
    );

    expect(res.status).toBe(200);
    expect(seen).toBe(BROWSER_UA);
  });

  it("the generic proxy forwards the browser UA on a staff mutation", async () => {
    let seen: string | null = null;
    server.use(
      http.patch(`${API}/api/v1/users/u-1/role`, ({ request }) => {
        seen = request.headers.get("user-agent");
        return HttpResponse.json({ id: "u-1" });
      }),
    );

    const res = await PATCH(
      makeRequest("http://localhost:3000/api/bff/users/u-1/role", {
        method: "PATCH",
        cookies: { rp_at: makeJwt(3600) },
        body: { role: "manager" },
        sameOrigin: true,
        headers: { "user-agent": BROWSER_UA },
      }),
      { params: Promise.resolve({ path: ["users", "u-1", "role"] }) },
    );

    expect(res.status).toBe(200);
    expect(seen).toBe(BROWSER_UA);
  });
});
