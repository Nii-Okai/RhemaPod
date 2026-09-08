import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/auth/login/route";

import { server } from "../msw/server";
import { API, makeRequest, parseSetCookies } from "./helpers";

const ME = {
  id: "user-1",
  email: "ada@grace.church",
  full_name: "Ada Editor",
  role: "editor",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
};

function loginRequest(body: unknown, sameOrigin = true) {
  return makeRequest("http://localhost:3000/api/auth/login", {
    method: "POST",
    body,
    sameOrigin,
    headers: sameOrigin ? {} : { origin: "https://evil.example" },
  });
}

describe("POST /api/auth/login", () => {
  it("sets rp_at + rp_rt with the right attributes and returns the user", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/login`, () =>
        HttpResponse.json({
          access_token: "at-1",
          refresh_token: "rt-1",
          token_type: "bearer",
          expires_in: 900,
        }),
      ),
      http.get(`${API}/api/v1/auth/me`, ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer at-1");
        return HttpResponse.json(ME);
      }),
    );

    const res = await POST(
      loginRequest({ email: "ada@grace.church", password: "pw" }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "user-1",
      email: "ada@grace.church",
      name: "Ada Editor",
      role: "editor",
    });

    const c = parseSetCookies(res);
    expect(c.rp_at.value).toBe("at-1");
    expect(c.rp_at.attrs.httponly).toBe(true);
    expect(String(c.rp_at.attrs.samesite).toLowerCase()).toBe("lax");
    expect(c.rp_at.attrs.path).toBe("/");
    expect(c.rp_at.attrs["max-age"]).toBe("900");
    // dev (NODE_ENV=test) → not Secure, so http://localhost works
    expect(c.rp_at.attrs.secure).toBeUndefined();

    expect(c.rp_rt.value).toBe("rt-1");
    expect(c.rp_rt.attrs.httponly).toBe(true);
    expect(String(c.rp_rt.attrs.samesite).toLowerCase()).toBe("strict");
    // refresh cookie is scoped to /api (covers /api/bff/* and /api/auth/*),
    // not / — security-reviewer ruling, W4 fix pass
    expect(c.rp_rt.attrs.path).toBe("/api");
    expect(c.rp_rt.attrs["max-age"]).toBe(String(60 * 60 * 24 * 30));
  });

  it("writes rp_rt as a session cookie when 'remember' is false", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/login`, () =>
        HttpResponse.json({ access_token: "at-1", refresh_token: "rt-1", expires_in: 900 }),
      ),
      http.get(`${API}/api/v1/auth/me`, () => HttpResponse.json(ME)),
    );

    const res = await POST(
      loginRequest({ email: "ada@grace.church", password: "pw", remember: false }),
    );

    const c = parseSetCookies(res);
    expect(c.rp_rt.attrs["max-age"]).toBeUndefined();
    expect(c.rp_rt.attrs.expires).toBeUndefined();
    expect(c.rp_at.attrs["max-age"]).toBe("900"); // access cookie unaffected
  });

  it("passes a 401 envelope straight through with no cookies", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/login`, () =>
        HttpResponse.json(
          { detail: "Invalid email or password", correlation_id: "cid-401" },
          { status: 401, headers: { "x-correlation-id": "cid-401" } },
        ),
      ),
    );

    const res = await POST(loginRequest({ email: "x@y.z", password: "nope" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      detail: "Invalid email or password",
      correlation_id: "cid-401",
    });
    expect(res.headers.get("x-correlation-id")).toBe("cid-401");
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("passes a 429 through with its Retry-After window", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/login`, () =>
        HttpResponse.json(
          { detail: "Too many login attempts. Try again shortly.", correlation_id: null },
          { status: 429, headers: { "retry-after": "42" } },
        ),
      ),
    );

    const res = await POST(loginRequest({ email: "x@y.z", password: "pw" }));

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect((await res.json()).detail).toContain("Too many");
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("400s a body missing email or password", async () => {
    const res = await POST(loginRequest({ email: "x@y.z" }));
    expect(res.status).toBe(400);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("403s a cross-origin login attempt (forced-login CSRF)", async () => {
    const res = await POST(
      loginRequest({ email: "x@y.z", password: "pw" }, false),
    );
    expect(res.status).toBe(403);
  });
});
