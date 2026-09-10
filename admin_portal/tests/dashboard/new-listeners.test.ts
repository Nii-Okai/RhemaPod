import { describe, expect, it } from "vitest";

import {
  isoWeek,
  toBarChartData,
  weekLabel,
  type NewListenersBucket,
} from "@/lib/dashboard/new-listeners";

/* W23 — the "New listeners" chart data mapping (plan §A.2 / §W23). The frontend
   does not bucket or sort: it maps the 8 backend `{week_start, count}` buckets
   straight onto the W22 `BarChart`, oldest-first, `count` verbatim. The only
   computation is the ISO-week axis label — tested here including a year
   boundary, since that is exactly where naive week math drifts. */

describe("isoWeek", () => {
  it("numbers a mid-year Monday", () => {
    expect(isoWeek("2026-01-05")).toBe(2);
    expect(isoWeek("2026-07-13")).toBe(29);
  });

  it("puts a late-December Monday into ISO week 1 of the next year", () => {
    // 2025-12-29 is the Monday that opens ISO week 1 of 2026.
    expect(isoWeek("2025-12-29")).toBe(1);
  });

  it("puts a late-December Monday into ISO week 53 when the year has one", () => {
    // 2020-12-28 is the Monday of ISO week 53/2020.
    expect(isoWeek("2020-12-28")).toBe(53);
  });
});

describe("weekLabel", () => {
  it("prefixes only the first bar with W, the rest are bare numbers", () => {
    expect(weekLabel("2026-07-13", 0)).toBe("W29");
    expect(weekLabel("2026-07-20", 1)).toBe("30");
    expect(weekLabel("2026-07-27", 2)).toBe("31");
  });
});

describe("toBarChartData", () => {
  const buckets: NewListenersBucket[] = [
    { week_start: "2026-06-01", count: 3 },
    { week_start: "2026-06-08", count: 3 },
    { week_start: "2026-06-15", count: 3 },
    { week_start: "2026-06-22", count: 3 },
    { week_start: "2026-06-29", count: 3 },
    { week_start: "2026-07-06", count: 0 },
    { week_start: "2026-07-13", count: 3 },
    { week_start: "2026-07-20", count: 3 },
  ];

  it("maps 8 buckets to 8 data points, order and counts preserved verbatim", () => {
    const data = toBarChartData(buckets);
    expect(data).toHaveLength(8);
    expect(data.map((d) => d.value)).toEqual([3, 3, 3, 3, 3, 0, 3, 3]);
  });

  it("keeps the zero bucket as an explicit 0, not a gap", () => {
    const data = toBarChartData(buckets);
    expect(data[5]).toEqual({ label: expect.any(String), value: 0 });
  });

  it("labels the first bar with a W prefix and the rest bare", () => {
    const labels = toBarChartData(buckets).map((d) => d.label);
    expect(labels[0].startsWith("W")).toBe(true);
    expect(labels.slice(1).every((l) => /^\d+$/.test(l))).toBe(true);
  });
});
