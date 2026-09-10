/**
 * "New listeners" chart data mapping (plan §A.2 / §W23).
 *
 * The backend (`GET /admin/analytics/new-listeners`) returns exactly 8
 * `{ week_start, count }` buckets, oldest first, zero-filled, with the
 * Monday-anchored ISO-week boundaries already computed in Python. The frontend
 * does NOT bucket, sort, or fill — it maps the response straight onto the W22
 * `BarChart`'s datum shape. No statistic is computed here (plan §W23): `value`
 * is the backend `count` verbatim; `label` is a rendering of the backend
 * `week_start`.
 *
 * The label is the ISO week number — `W29`, then bare `30`, `31`, … matching
 * the design's week-label row (`docs/design_admin_portal/README.md` §2, the
 * chart there mislabelled "Plays per week"). Across a year boundary the numbers
 * simply wrap (…, 52, 1, 2) — still legible, still in order.
 *
 * The word "plays" appears nowhere in this module or the strings it produces:
 * this series answers reach, not engagement (§A.2).
 */

import type { BarChartDatum } from "@/components/charts/BarChart";
import type { components } from "@/lib/api/schema";

export type NewListenersBucket = components["schemas"]["NewListenersBucket"];

/** Empty-state copy for the chart card (never the word "plays"). */
export const NEW_LISTENERS_EMPTY_LABEL = "No new listeners in this window";

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * ISO 8601 week number (1–53) for a date, computed in UTC. `week_start` is
 * already a Monday, so this is just "which ISO week is that Monday in".
 */
export function isoWeek(input: Date | string): number {
  const src = typeof input === "string" ? new Date(input) : input;
  // Work on a UTC-midnight copy so DST / local offset can't shift the day.
  const date = new Date(
    Date.UTC(src.getUTCFullYear(), src.getUTCMonth(), src.getUTCDate()),
  );
  // Shift to the Thursday of this week (ISO weeks are numbered by their Thursday).
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon = 0 … Sun = 6
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / MS_PER_WEEK);
}

/** One bucket → its axis label. First bar carries the `W` prefix, the rest are
    bare numbers, per the design's label row. */
export function weekLabel(weekStart: string, index: number): string {
  const week = isoWeek(weekStart);
  return index === 0 ? `W${week}` : String(week);
}

/**
 * The 8 backend buckets → `BarChart` data. Order is preserved verbatim
 * (backend guarantees oldest-first); `value` is `count` unchanged.
 */
export function toBarChartData(buckets: NewListenersBucket[]): BarChartDatum[] {
  return buckets.map((bucket, index) => ({
    label: weekLabel(bucket.week_start, index),
    value: bucket.count,
  }));
}
