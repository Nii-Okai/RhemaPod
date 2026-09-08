import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/auth/forgot-password/route";

import { server } from "../msw/server";
import { API, makeRequest } from "./helpers";

const GENERIC = { message: "If that email exists, a reset link has been sent." };

function req(body: unknown, sameOrigin = true) {
  return makeRequest("http://localhost:3000/api/auth/forgot-password", {
    method: "POST",
    body,
    sameOrigin,
    headers: sameOrigin ? {} : { origin: "https://evil.example" },
  });
}

describe("POST /api/auth/forgot-password", () => {
  it("returns the generic 200 for a known address", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/forgot-password`, () =>
        HttpResponse.json({ message: "sent" }),
      ),
    );
    const res = await POST(req({ email: "real@grace.church" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(GENERIC);
  });

  it("returns the SAME generic 200 when the backend 500s (no oracle)", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/forgot-password`, () =>
        HttpResponse.json({ detail: "db down" }, { status: 500 }),
      ),
    );
    const res = await POST(req({ email: "real@grace.church" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(GENERIC);
  });

  it("returns the generic 200 for a malformed body without calling upstream", async () => {
    let called = false;
    server.use(
      http.post(`${API}/api/v1/auth/forgot-password`, () => {
        called = true;
        return HttpResponse.json({});
      }),
    );
    const res = await POST(
      makeRequest("http://localhost:3000/api/auth/forgot-password", {
        method: "POST",
        body: "not json",
        headers: { "content-type": "text/plain" },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(GENERIC);
    expect(called).toBe(false);
  });

  it("403s a cross-origin request", async () => {
    const res = await POST(req({ email: "x@y.z" }, false));
    expect(res.status).toBe(403);
  });
});
