import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApiClient } from "@/lib/api/client";
import {
  SUBSCRIPTIONS_PAGE_SIZE,
  loadSubscriptionCounts,
  loadSubscriptions,
  toStatusFilter,
  toTierFilter,
} from "@/lib/query/hooks/use-subscriptions";

import { server } from "../msw/server";

/* W21 / W20 — the Subscriptions read models, asserted on the wire through MSW
   (plan §A.11), never a mocked fetch. Covers: the `status` / `tier` / `limit` /
   `offset` params (and that the filters are omitted when unset), and the
   three-number counts shape that feeds the tiles. */

const ORIGIN = "http://localhost";
const client = createApiClient({ baseUrl: `${ORIGIN}/api/bff` });

const emptyPage = {
  items: [],
  total: 0,
  limit: SUBSCRIPTIONS_PAGE_SIZE,
  offset: 0,
};

let seen: { url: URLSearchParams; method: string }[];

beforeEach(() => {
  seen = [];
  server.use(
    http.get(`${ORIGIN}/api/bff/admin/subscriptions`, ({ request }) => {
      seen.push({
        url: new URL(request.url).searchParams,
        method: request.method,
      });
      return HttpResponse.json(emptyPage);
    }),
    http.get(`${ORIGIN}/api/bff/admin/subscriptions/counts`, () =>
      HttpResponse.json({ active_paid: 24, monthly: 15, annual: 9 }),
    ),
  );
});

afterEach(() => server.resetHandlers());

describe("toStatusFilter / toTierFilter", () => {
  it("keeps only real enum values, everything else is undefined (no filter)", () => {
    expect(toStatusFilter("active")).toBe("active");
    expect(toStatusFilter("past_due")).toBe("past_due");
    expect(toStatusFilter("cancelled")).toBe("cancelled");
    expect(toStatusFilter("expired")).toBe("expired");
    expect(toStatusFilter("all")).toBeUndefined();
    expect(toStatusFilter(null)).toBeUndefined();
    expect(toStatusFilter("garbage")).toBeUndefined();

    expect(toTierFilter("free")).toBe("free");
    expect(toTierFilter("monthly")).toBe("monthly");
    expect(toTierFilter("annual")).toBe("annual");
    expect(toTierFilter(null)).toBeUndefined();
    expect(toTierFilter("premium")).toBeUndefined();
  });
});

describe("loadSubscriptions", () => {
  it("omits status and tier when unset, sends the page window, GET only", async () => {
    await loadSubscriptions({ page: 1 }, client);

    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("GET");
    expect(seen[0].url.has("status")).toBe(false);
    expect(seen[0].url.has("tier")).toBe(false);
    expect(seen[0].url.get("limit")).toBe(String(SUBSCRIPTIONS_PAGE_SIZE));
    expect(seen[0].url.get("offset")).toBe("0");
  });

  it("puts status and tier on the wire when set, and offsets by page", async () => {
    await loadSubscriptions(
      { status: "past_due", tier: "annual", page: 3 },
      client,
    );

    expect(seen[0].url.get("status")).toBe("past_due");
    expect(seen[0].url.get("tier")).toBe("annual");
    expect(seen[0].url.get("offset")).toBe(String(SUBSCRIPTIONS_PAGE_SIZE * 2));
  });
});

describe("loadSubscriptionCounts", () => {
  it("returns the three-number aggregate as-is", async () => {
    const counts = await loadSubscriptionCounts(client);
    expect(counts).toEqual({ active_paid: 24, monthly: 15, annual: 9 });
  });
});
