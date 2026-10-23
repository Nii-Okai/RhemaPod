/**
 * Dashboard read models.
 *
 *   useSermonStatusCounts(mine)  GET /sermons/status-counts[?created_by=me]
 *     Every role. An editor's counts cover their own sermons (server-scoped);
 *     a manager/admin sees everyone's. Feeds the content pipeline card.
 *
 *   useOverview()                GET /admin/analytics/overview
 *     Manager/admin only (`require_role(MANAGER, ADMIN)`). All-time figures
 *     counted from the live tables at request time.
 *
 *   The period figures (last 30 days, and the 30 before it for the change
 *   line) come from the same `GET /admin/analytics/report` the Settings ›
 *   Reports screen reads (`useUsageReport`), so the Dashboard and Reports
 *   can never disagree about the same period.
 *
 * The analytics hooks are only called from `<DashboardAnalytics>`, which the
 * Server Component renders solely for managers and admins, so an editor's
 * token never hits those routes. Nothing here computes a statistic: every
 * number is a backend field; the screen only formats and compares them.
 */

"use client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap, type ApiClient } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";
import { REPORT_REFRESH_MS } from "@/lib/query/hooks/use-usage-report";

export type OverviewStats = components["schemas"]["OverviewStats"];
export type SermonStatusCounts = components["schemas"]["SermonStatusCounts"];

export async function loadSermonStatusCounts(
  mine = false,
  client: ApiClient = api,
): Promise<SermonStatusCounts> {
  return unwrap(
    client.GET("/api/v1/sermons/status-counts", {
      params: { query: mine ? { created_by: "me" } : {} },
    }),
  );
}

export function useSermonStatusCounts(mine = false) {
  return useQuery({
    queryKey: queryKeys.sermons.statusCounts(mine),
    queryFn: () => loadSermonStatusCounts(mine),
    staleTime: 30_000,
    refetchInterval: REPORT_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export async function loadOverview(
  client: ApiClient = api,
): Promise<OverviewStats> {
  return unwrap(client.GET("/api/v1/admin/analytics/overview"));
}

export function useOverview() {
  return useQuery({
    queryKey: queryKeys.analytics.overview(),
    queryFn: () => loadOverview(),
    staleTime: 30_000,
    refetchInterval: REPORT_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}
