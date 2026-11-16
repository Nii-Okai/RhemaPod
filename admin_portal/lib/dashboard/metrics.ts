/**
 * Dashboard figures — pure helpers, unit-tested without a DOM.
 *
 * Nothing here invents a number. `periodChange` compares two backend totals
 * and returns `undefined` whenever the comparison would mislead (the earlier
 * period predates the daily rollups, so its zeros mean "not recorded", not
 * "nobody listened").
 */

import type { components } from "@/lib/api/schema";

type UsageReport = components["schemas"]["UsageReport"];
type SermonStatus = components["schemas"]["SermonStatus"];

/** Length of the Dashboard's reporting window, in days (ending today, UTC). */
export const DASHBOARD_DAYS = 30;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `[from, to)` for the last `days` days ending with today (UTC), and the
    same-length window just before it. */
export function dashboardRanges(
  now: Date = new Date(),
  days: number = DASHBOARD_DAYS,
): { current: { from: string; to: string }; previous: { from: string; to: string } } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  const prevStart = new Date(start);
  prevStart.setUTCDate(prevStart.getUTCDate() - days);
  return {
    current: { from: ymd(start), to: ymd(end) },
    previous: { from: ymd(prevStart), to: ymd(start) },
  };
}

export type Change = { direction: "up" | "down" | "neutral"; text: string };

/** "▲ 12% vs previous 30 days" style comparison, or `undefined` when there is
    no fair comparison to make. `rollupCovered` is false when the previous
    window starts before the rollups began (plays, completions, watch time). */
export function periodChange(
  current: number,
  previous: number,
  { rollupCovered = true, days = DASHBOARD_DAYS }: { rollupCovered?: boolean; days?: number } = {},
): Change | undefined {
  if (!rollupCovered) return undefined;
  const suffix = `vs previous ${days} days`;
  if (current === previous) return { direction: "neutral", text: `No change ${suffix}` };
  if (previous === 0) return { direction: "up", text: `Up from 0 ${suffix}` };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) {
    return { direction: current > previous ? "up" : "down", text: `Under 1% ${suffix}` };
  }
  return {
    direction: pct > 0 ? "up" : "down",
    text: `${Math.abs(pct)}% ${suffix}`,
  };
}

/** Whether the daily rollups cover all of `report`'s period. */
export function rollupsCover(report: UsageReport | undefined): boolean {
  if (!report) return false;
  const since = report.data_available_from;
  return since != null && since <= report.period.from;
}

/** The content pipeline, in workflow order. `href` opens the matching view. */
export const PIPELINE_STAGES: ReadonlyArray<{
  status: SermonStatus;
  label: string;
  href: string;
}> = [
  { status: "draft", label: "Drafts", href: "/sermons?status=drafts" },
  { status: "pending_review", label: "Waiting for review", href: "/sermons?status=in-review" },
  { status: "under_review", label: "In review", href: "/sermons?status=in-review" },
  { status: "rejected", label: "Changes requested", href: "/sermons" },
  { status: "approved", label: "Approved, not live", href: "/sermons" },
  { status: "published", label: "Published", href: "/sermons?status=published" },
  { status: "unpublished", label: "Unpublished", href: "/sermons" },
];
