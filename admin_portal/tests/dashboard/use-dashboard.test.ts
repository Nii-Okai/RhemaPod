import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";

import { createApiClient } from "@/lib/api/client";
import {
  TOP_SERMONS_LIMIT,
  loadInFlightUploads,
  loadNewListeners,
  loadOverview,
  loadTopSermons,
} from "@/lib/query/hooks/use-dashboard";

import { server } from "../msw/server";

/* W23 — the Dashboard analytics + in-flight reads, asserted on the wire through
   MSW (plan §A.11), never a mocked fetch. The WIP `created_by=me` scoping is
   asserted in the screen DOM test, where the sermons fetch actually fires. */

const ORIGIN = "http://localhost";
const client = createApiClient({ baseUrl: `${ORIGIN}/api/bff` });

let paths: string[];
let queries: URLSearchParams[];

const buckets = Array.from({ length: 8 }, (_, i) => ({
  week_start: `2026-06-${String(1 + i * 7).padStart(2, "0")}`,
  count: i === 5 ? 0 : 3,
}));

beforeEach(() => {
  paths = [];
  queries = [];
  const record = ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    paths.push(url.pathname);
    queries.push(url.searchParams);
  };
  server.use(
    http.get(`${ORIGIN}/api/bff/uploads/in-flight`, (info) => {
      record(info);
      return HttpResponse.json([]);
    }),
    http.get(`${ORIGIN}/api/bff/admin/analytics/overview`, (info) => {
      record(info);
      return HttpResponse.json({
        total_plays: 18402,
        completion_rate: 0.61,
        active_subscribers: 1240,
        published_sermons: 96,
        total_users: 5000,
        unique_viewers: 3100,
        completions: 200,
        plays_last_7_days: 400,
      });
    }),
    http.get(`${ORIGIN}/api/bff/admin/analytics/top-sermons`, (info) => {
      record(info);
      return HttpResponse.json([
        { sermon_id: "s-1", title: "Anchored: Part One", plays: 3102, completions: 1, completion_rate: 0.7, unique_viewers: 900 },
      ]);
    }),
    http.get(`${ORIGIN}/api/bff/admin/analytics/new-listeners`, (info) => {
      record(info);
      return HttpResponse.json(buckets);
    }),
  );
});

describe("loadInFlightUploads", () => {
  it("GETs /uploads/in-flight (no query params)", async () => {
    await loadInFlightUploads(client);
    expect(paths).toEqual(["/api/bff/uploads/in-flight"]);
    expect([...queries[0].keys()]).toEqual([]);
  });
});

describe("loadOverview", () => {
  it("GETs /admin/analytics/overview and returns the stats verbatim", async () => {
    const stats = await loadOverview(client);
    expect(paths).toEqual(["/api/bff/admin/analytics/overview"]);
    expect(stats.total_plays).toBe(18402);
    expect(stats.completion_rate).toBe(0.61);
    expect(stats.active_subscribers).toBe(1240);
    expect(stats.published_sermons).toBe(96);
  });
});

describe("loadTopSermons", () => {
  it("GETs /admin/analytics/top-sermons with the default limit", async () => {
    await loadTopSermons(undefined, client);
    expect(paths).toEqual(["/api/bff/admin/analytics/top-sermons"]);
    expect(queries[0].get("limit")).toBe(String(TOP_SERMONS_LIMIT));
  });
});

describe("loadNewListeners", () => {
  it("GETs /admin/analytics/new-listeners and returns 8 buckets oldest-first", async () => {
    const series = await loadNewListeners(client);
    expect(paths).toEqual(["/api/bff/admin/analytics/new-listeners"]);
    expect(series).toHaveLength(8);
    expect(series[0].week_start < series[7].week_start).toBe(true);
    expect(series[5].count).toBe(0);
  });
});
