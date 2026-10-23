import { describe, expect, it } from "vitest";

import { greetingFor } from "@/lib/dashboard/greeting";
import { dashboardRanges, periodChange, rollupsCover } from "@/lib/dashboard/metrics";

describe("dashboardRanges", () => {
  it("covers the last 30 days including today, and the 30 before", () => {
    const r = dashboardRanges(new Date("2026-10-23T22:00:00Z"));
    expect(r.current).toEqual({ from: "2026-09-24", to: "2026-10-24" });
    expect(r.previous).toEqual({ from: "2026-08-25", to: "2026-09-24" });
  });
});

describe("periodChange", () => {
  it("states the percentage change", () => {
    expect(periodChange(150, 100)).toEqual({ direction: "up", text: "50% vs previous 30 days" });
    expect(periodChange(75, 100)).toEqual({ direction: "down", text: "25% vs previous 30 days" });
  });
  it("handles equal values and a zero baseline", () => {
    expect(periodChange(5, 5)?.direction).toBe("neutral");
    expect(periodChange(4, 0)?.text).toBe("Up from 0 vs previous 30 days");
  });
  it("makes no claim when the earlier window wasn't recorded", () => {
    expect(periodChange(10, 0, { rollupCovered: false })).toBeUndefined();
  });
});

describe("rollupsCover", () => {
  const report = (from: string, since: string | null) =>
    ({ period: { from, to: "2026-10-24", granularity: "day" }, data_available_from: since }) as never;
  it("is true only when rollups started on or before the period", () => {
    expect(rollupsCover(report("2026-09-24", "2026-09-01"))).toBe(true);
    expect(rollupsCover(report("2026-09-24", "2026-09-24"))).toBe(true);
    expect(rollupsCover(report("2026-09-24", "2026-10-01"))).toBe(false);
    expect(rollupsCover(report("2026-09-24", null))).toBe(false);
    expect(rollupsCover(undefined)).toBe(false);
  });
});

describe("greetingFor", () => {
  it("follows the time of day in Ghana", () => {
    expect(greetingFor(new Date("2026-10-23T08:00:00Z"))).toBe("Good morning");
    expect(greetingFor(new Date("2026-10-23T13:00:00Z"))).toBe("Good afternoon");
    expect(greetingFor(new Date("2026-10-23T19:00:00Z"))).toBe("Good evening");
  });
});
