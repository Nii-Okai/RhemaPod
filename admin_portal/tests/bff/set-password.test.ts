import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/auth/set-password/route";

import { server } from "../msw/server";
import { API, makeRequest } from "./helpers";

function req(body: unknown) {
  return makeRequest("http://localhost:3000/api/auth/set-password", {
    method: "POST",
    body,
  });
}

describe("POST /api/auth/set-password", () => {
  it("on success returns {ok:true}, sets NO cookies, and does not auto-login", async () => {
    let seenBody: unknown;
    server.use(
      http.post(`${API}/api/v1/auth/reset-password`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json({ message: "Password updated. Please log in again." });
      }),
    );

    const res = await POST(req({ token: "invite-tok", password: "a-strong-passphrase-9" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // maps password -> new_password for the backend
    expect(seenBody).toEqual({ token: "invite-tok", new_password: "a-strong-passphrase-9" });
    // the whole point: no token pair is minted here
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("passes a 400 (invalid / used / expired token) straight through", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/reset-password`, () =>
        HttpResponse.json(
          { detail: "This reset link is invalid or has expired.", correlation_id: "cid-b" },
          { status: 400 },
        ),
      ),
    );

    const res = await POST(req({ token: "stale", password: "a-strong-passphrase-9" }));

    expect(res.status).toBe(400);
    expect((await res.json()).detail).toContain("invalid or has expired");
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("passes a 422 weak-password envelope through with its field errors", async () => {
    server.use(
      http.post(`${API}/api/v1/auth/reset-password`, () =>
        HttpResponse.json(
          {
            detail: "Validation failed",
            errors: [
              { field: "new_password", message: "Password is too weak.", type: "value_error" },
            ],
            correlation_id: null,
          },
          { status: 422 },
        ),
      ),
    );

    const res = await POST(req({ token: "ok", password: "weak" }));

    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: { field: string }[] };
    expect(body.errors[0].field).toBe("new_password");
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("400s when the token is missing from the body", async () => {
    const res = await POST(req({ password: "a-strong-passphrase-9" }));
    expect(res.status).toBe(400);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });
});
