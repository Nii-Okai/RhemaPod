import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { createApiClient } from "@/lib/api/client";
import { loadNavCounts } from "@/lib/query/hooks/use-nav-counts";

import { server } from "../msw/server";

/* W5 — the sidebar's trailing counts. Asserted on the wire through MSW (plan
   §A.11), including the role-tolerance rule: a 403 hides that one count, it
   does not error the nav. */

const ORIGIN = "http://localhost";
const client = createApiClient({ baseUrl: `${ORIGIN}/api/bff` });

const sermons = (status: number, body: unknown) =>
  http.get(`${ORIGIN}/api/bff/sermons`, () =>
    HttpResponse.json(body as never, { status }),
  );
const series = (status: number, body: unknown) =>
  http.get(`${ORIGIN}/api/bff/series`, () =>
    HttpResponse.json(body as never, { status }),
  );
const reviewQueue = (status: number, body: unknown) =>
  http.get(`${ORIGIN}/api/bff/approvals/sermons/review-queue`, () =>
    HttpResponse.json(body as never, { status }),
  );

const FORBIDDEN = { detail: "Forbidden", correlation_id: "test-cid" };

describe("loadNavCounts", () => {
  it("returns every count on success", async () => {
    server.use(
      sermons(200, { items: [], total: 128, limit: 1, offset: 0 }),
      series(200, new Array(14).fill({ id: "x" })),
      reviewQueue(200, { items: [], total: 3, limit: 1, offset: 0 }),
    );

    await expect(loadNavCounts(client)).resolves.toEqual({
      sermons: 128,
      series: 14,
      reviewQueue: 3,
    });
  });

  it("hides only the review-queue count when it 403s (the Editor case)", async () => {
    server.use(
      sermons(200, { items: [], total: 128, limit: 1, offset: 0 }),
      series(200, new Array(14).fill({ id: "x" })),
      reviewQueue(403, FORBIDDEN),
    );

    await expect(loadNavCounts(client)).resolves.toEqual({
      sermons: 128,
      series: 14,
      reviewQueue: null,
    });
  });

  it("hides only the sermons count when it 403s", async () => {
    server.use(
      sermons(403, FORBIDDEN),
      series(200, []),
      reviewQueue(200, { items: [], total: 0, limit: 1, offset: 0 }),
    );

    await expect(loadNavCounts(client)).resolves.toEqual({
      sermons: null,
      series: 0,
      reviewQueue: 0,
    });
  });

  it("rejects on a non-403 failure (a 500 is not swallowed)", async () => {
    server.use(
      sermons(500, { detail: "boom", correlation_id: "c" }),
      series(200, []),
      reviewQueue(200, { items: [], total: 0, limit: 1, offset: 0 }),
    );

    await expect(loadNavCounts(client)).rejects.toMatchObject({ status: 500 });
  });
});
