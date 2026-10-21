/**
 * Usage reports — the Settings › Reports screen (plan-admin-settings S17).
 *
 *   useUsageReport({ from, to, granularity })
 *     GET /api/v1/admin/analytics/report → UsageReport
 *   reportExportHref(params, kind)
 *     the BFF URL for GET /api/v1/admin/analytics/report/export — a plain
 *     link, so the browser downloads the server's CSV as a file. Admin only;
 *     the screen renders the link only for admins and FastAPI 403s anyone
 *     else.
 *
 * Periods are half-open `[from, to)` UTC dates, at most 366 days.
 */

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, BFF_BASE_URL, unwrap, type ApiClient } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys, type UsageReportParams } from "@/lib/query/keys";

export type UsageReport = components["schemas"]["UsageReport"];
export type Granularity = "day" | "week" | "month";
export type ReportExportKind = "timeseries" | "top_sermons";

export const REPORT_PRESETS = [
  { value: "7d", label: "Last 7 days", days: 7, granularity: "day" },
  { value: "30d", label: "Last 30 days", days: 30, granularity: "day" },
  { value: "90d", label: "Last 90 days", days: 90, granularity: "week" },
  { value: "12m", label: "Last 12 months", days: 365, granularity: "month" },
] as const satisfies ReadonlyArray<{
  value: string;
  label: string;
  days: number;
  granularity: Granularity;
}>;
export type ReportPreset = (typeof REPORT_PRESETS)[number]["value"];

export function toPreset(raw: string | null | undefined): ReportPreset {
  return REPORT_PRESETS.some((p) => p.value === raw) ? (raw as ReportPreset) : "30d";
}

export function toGranularity(
  raw: string | null | undefined,
  preset: ReportPreset,
): Granularity {
  if (raw === "day" || raw === "week" || raw === "month") return raw;
  return REPORT_PRESETS.find((p) => p.value === preset)!.granularity;
}

/** `[from, to)` for a preset, ending with today (UTC) included. */
export function presetRange(
  preset: ReportPreset,
  now: Date = new Date(),
): { from: string; to: string } {
  const days = REPORT_PRESETS.find((p) => p.value === preset)!.days;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export async function loadUsageReport(
  params: UsageReportParams,
  client: ApiClient = api,
): Promise<UsageReport> {
  return unwrap(client.GET("/api/v1/admin/analytics/report", { params: { query: params } }));
}

export function useUsageReport(params: UsageReportParams) {
  return useQuery({
    queryKey: queryKeys.settings.report(params),
    queryFn: () => loadUsageReport(params),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function reportExportHref(
  params: UsageReportParams,
  kind: ReportExportKind,
): string {
  const q = new URLSearchParams({
    from: params.from,
    to: params.to,
    granularity: params.granularity ?? "week",
    kind,
  });
  return `${BFF_BASE_URL}/admin/analytics/report/export?${q.toString()}`;
}
