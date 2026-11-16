import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { createApiClient } from "@/lib/api/client";
import { loadOverview, loadSermonStatusCounts } from "@/lib/query/hooks/use-dashboard";

import { server } from "../msw/server";

/* The Dashboard reads, asserted on the wire through MSW (plan §A.11). */

const ORIGIN = "http://localhost";
const client = createApiClient({ baseUrl: `${ORIGIN}/api/bff` });

let queries: URLSearchParams[];

beforeEach(() => {
  queries = [];
  server.use(
    http.get(`${ORIGIN}/api/bff/sermons/status-counts`, ({ request }) => {
      queries.push(new URL(request.url).searchParams);
      return HttpResponse.json({
        draft: 2, pending_review: 1, under_review: 0, approved: 0,
        published: 5, rejected: 1, unpublished: 0, total: 9,
      });
    }),
    http.get(`${ORIGIN}/api/bff/admin/analytics/overview`, () =>
      HttpResponse.json({
        total_users: 10, members: 8, active_members: 7, active_subscribers: 3,
        published_sermons: 5, total_plays: 40, unique_viewers: 6, completions: 4,
        completion_rate: 0.25, plays_last_7_days: 9, watch_hours: 3.5,
      }),
    ),
  );
});

describe("loadSermonStatusCounts", () => {
  it("GETs /sermons/status-counts with no scope by default", async () => {
    const counts = await loadSermonStatusCounts(false, client);
    expect(counts.total).toBe(9);
    expect(queries[0].get("created_by")).toBeNull();
  });

  it("sends created_by=me for the caller's own sermons", async () => {
    await loadSermonStatusCounts(true, client);
    expect(queries[0].get("created_by")).toBe("me");
  });
});

describe("loadOverview", () => {
  it("passes the backend fields through unchanged", async () => {
    const o = await loadOverview(client);
    expect(o.members).toBe(8);
    expect(o.watch_hours).toBe(3.5);
  });
});
