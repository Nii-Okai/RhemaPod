import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { createApiClient, unwrap } from "@/lib/api/client";
import { ApiError, isApiError } from "@/lib/api/errors";

import { server } from "../msw/server";

// Absolute origin so `fetch` resolves outside a browser; the client rewrites
// `/api/bff/api/v1/<path>` down to `/api/bff/<path>` before it hits the wire.
const ORIGIN = "http://localhost";
const api = createApiClient({ baseUrl: `${ORIGIN}/api/bff` });

describe("API client — success path", () => {
  it("returns typed data and strips the backend mount prefix", async () => {
    let seenUrl: string | undefined;

    server.use(
      http.get(`${ORIGIN}/api/bff/sermons`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json({
          items: [],
          total: 42,
          limit: 25,
          offset: 0,
        });
      }),
    );

    const { data, error } = await api.GET("/api/v1/sermons", {
      params: { query: { status: "draft", limit: 25 } },
    });

    expect(error).toBeUndefined();
    expect(data?.total).toBe(42);

    const url = new URL(seenUrl ?? "");
    expect(url.pathname).toBe("/api/bff/sermons");
    expect(url.searchParams.get("status")).toBe("draft");
    expect(url.searchParams.get("limit")).toBe("25");
  });

  it("unwrap() yields the payload directly", async () => {
    server.use(
      http.get(`${ORIGIN}/api/bff/catalog/sermons/:id`, () =>
        HttpResponse.json({ id: "s-1", title: "Grace Abounding" }),
      ),
    );

    const sermon = await unwrap(
      api.GET("/api/v1/catalog/sermons/{sermon_id}", {
        params: { path: { sermon_id: "s-1" } },
      }),
    );

    expect(sermon.title).toBe("Grace Abounding");
  });
});

describe("API client — error envelope", () => {
  it("throws ApiError with detail + correlation_id on a 404", async () => {
    server.use(
      http.get(`${ORIGIN}/api/bff/catalog/sermons/:id`, () =>
        HttpResponse.json(
          { detail: "Sermon not found", correlation_id: "cid-404-abc" },
          { status: 404 },
        ),
      ),
    );

    const thrown = await api
      .GET("/api/v1/catalog/sermons/{sermon_id}", {
        params: { path: { sermon_id: "missing" } },
      })
      .catch((e: unknown) => e);

    expect(isApiError(thrown)).toBe(true);
    expect(thrown).toBeInstanceOf(ApiError);
    const err = thrown as ApiError;
    expect(err.status).toBe(404);
    expect(err.detail).toBe("Sermon not found");
    expect(err.message).toBe("Sermon not found");
    expect(err.correlationId).toBe("cid-404-abc");
    expect(err.fieldErrors).toBeNull();
    expect(err.isValidation).toBe(false);
  });

  it("maps the 422 errors[] shape to field errors, body survives the rewrite", async () => {
    server.use(
      http.post(`${ORIGIN}/api/bff/sermons`, async ({ request }) => {
        const body = (await request.json()) as { title?: string };
        expect(body.title).toBe("");
        return HttpResponse.json(
          {
            detail: "Validation failed",
            errors: [
              {
                field: "title",
                message: "String should have at least 1 character",
                type: "string_too_short",
              },
            ],
            correlation_id: "cid-422-xyz",
          },
          { status: 422 },
        );
      }),
    );

    const err = (await api
      .POST("/api/v1/sermons", { body: { title: "" } })
      .catch((e: unknown) => e)) as ApiError;

    expect(err.status).toBe(422);
    expect(err.isValidation).toBe(true);
    expect(err.correlationId).toBe("cid-422-xyz");
    expect(err.fieldErrors).toEqual([
      {
        field: "title",
        message: "String should have at least 1 character",
        type: "string_too_short",
      },
    ]);
    expect(err.fieldErrorMap()).toEqual({
      title: "String should have at least 1 character",
    });
  });

  it("surfaces correlation_id on a 500", async () => {
    server.use(
      http.get(`${ORIGIN}/api/bff/sermons`, () =>
        HttpResponse.json(
          { detail: "Internal server error", correlation_id: "cid-500-oops" },
          { status: 500 },
        ),
      ),
    );

    const err = (await api
      .GET("/api/v1/sermons")
      .catch((e: unknown) => e)) as ApiError;

    expect(err.status).toBe(500);
    expect(err.detail).toBe("Internal server error");
    expect(err.correlationId).toBe("cid-500-oops");
  });

  it("degrades gracefully when the failure body is not the envelope", async () => {
    server.use(
      http.get(
        `${ORIGIN}/api/bff/sermons`,
        () => new HttpResponse("Bad Gateway", { status: 502 }),
      ),
    );

    const err = (await api
      .GET("/api/v1/sermons")
      .catch((e: unknown) => e)) as ApiError;

    expect(err.status).toBe(502);
    expect(err.correlationId).toBeNull();
    expect(err.detail).toBe("Server error");
    expect(err.fieldErrors).toBeNull();
  });
});
