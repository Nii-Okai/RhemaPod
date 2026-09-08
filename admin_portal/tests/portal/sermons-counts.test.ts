import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiClient } from "@/lib/api/client";
import {
  loadSermonCounts,
  sermonCountLine,
} from "@/lib/query/hooks/use-sermon-counts";

import { server } from "../msw/server";

/* W7 — the header count line ("128 total · 96 published · 12 awaiting review").
   The contract has no status-breakdown endpoint, so the line is derived from
   four `limit=1` `total` probes (plan §A.9). Asserted on the wire through MSW
   (§A.11), never a mocked fetch. */

const ORIGIN = "http://localhost";
const client = createApiClient({ baseUrl: `${ORIGIN}/api/bff` });

let seen: Array<{ status: string | null; limit: string | null }>;

beforeEach(() => {
  seen = [];
  server.use(
    http.get(`${ORIGIN}/api/bff/sermons`, ({ request }) => {
      const params = new URL(request.url).searchParams;
      const status = params.get("status");
      seen.push({ status, limit: params.get("limit") });
      const total =
        status === "published"
          ? 96
          : status === "pending_review"
            ? 9
            : status === "under_review"
              ? 3
              : 128;
      return HttpResponse.json({ items: [], total, limit: 1, offset: 0 });
    }),
  );
});

afterEach(() => server.resetHandlers());

describe("loadSermonCounts", () => {
  it("probes total / published / pending_review / under_review, each at limit=1", async () => {
    const counts = await loadSermonCounts(client);

    expect(counts).toEqual({ total: 128, published: 96, awaitingReview: 12 });
    expect(seen).toHaveLength(4);
    expect(seen.every((s) => s.limit === "1")).toBe(true);
    expect(new Set(seen.map((s) => s.status))).toEqual(
      new Set([null, "published", "pending_review", "under_review"]),
    );
  });
});

describe("sermonCountLine", () => {
  it("formats the derived counts with thousands separators", () => {
    expect(
      sermonCountLine({ total: 1284, published: 963, awaitingReview: 12 }),
    ).toBe("1,284 total · 963 published · 12 awaiting review");
  });

  it("falls back to a neutral subhead before the counts load", () => {
    expect(sermonCountLine(undefined)).toBe(
      "Draft, review and publish the spoken word.",
    );
  });
});
