import { describe, expect, it } from "vitest";

import { daysSince, hoursSince } from "@/lib/format";
import {
  OVERDUE_HOURS,
  oldestWaitDays,
  overdueAlertText,
  overdueItems,
  provenanceLine,
  reviewCountLine,
} from "@/lib/review/summary";

/* Pure derivations behind the Review queue header, the >48h alert and the
   per-card provenance line (W10). No render — plan §A.11. */

const NOW = Date.parse("2026-09-09T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

describe("daysSince / hoursSince", () => {
  it("floors whole days elapsed", () => {
    expect(daysSince(daysAgo(3), NOW)).toBe(3);
    expect(daysSince(hoursAgo(3 * 24 + 23), NOW)).toBe(3); // 3d23h → 3
  });

  it("clamps a null, unparseable or future timestamp to 0", () => {
    expect(daysSince(null, NOW)).toBe(0);
    expect(daysSince("not a date", NOW)).toBe(0);
    expect(daysSince(new Date(NOW + 86_400_000), NOW)).toBe(0);
    expect(hoursSince(null, NOW)).toBe(0);
  });

  it("hoursSince is fractional", () => {
    expect(hoursSince(hoursAgo(1.5), NOW)).toBeCloseTo(1.5, 5);
  });
});

describe("overdueItems", () => {
  const item = (submitted_at: string | null) => ({ submitted_at });

  it("selects only items past the 48h threshold; null never counts", () => {
    const items = [
      item(hoursAgo(47)), // under
      item(hoursAgo(49)), // over
      item(daysAgo(6)), // over
      item(null), // never
    ];
    const out = overdueItems(items, NOW);
    expect(out).toHaveLength(2);
    expect(out).toEqual([items[1], items[2]]);
  });

  it("is a strict boundary at exactly 48h", () => {
    expect(overdueItems([item(hoursAgo(OVERDUE_HOURS))], NOW)).toHaveLength(0);
  });
});

describe("oldestWaitDays", () => {
  it("is the max whole-day wait across the visible page", () => {
    expect(
      oldestWaitDays([{ submitted_at: daysAgo(1) }, { submitted_at: daysAgo(4) }], NOW),
    ).toBe(4);
  });

  it("is 0 for an empty page or a page with no submitted_at", () => {
    expect(oldestWaitDays([], NOW)).toBe(0);
    expect(oldestWaitDays([{ submitted_at: null }], NOW)).toBe(0);
  });
});

describe("reviewCountLine", () => {
  it("pluralises and joins the wait clause", () => {
    expect(reviewCountLine(3, 3)).toBe("3 submissions · oldest waiting 3 days");
    expect(reviewCountLine(1, 1)).toBe("1 submission · oldest waiting 1 day");
  });

  it("reads 'oldest submitted today' at a zero wait", () => {
    expect(reviewCountLine(2, 0)).toBe("2 submissions · oldest submitted today");
  });

  it("drops the wait clause entirely at zero total", () => {
    expect(reviewCountLine(0, 0)).toBe("0 submissions");
  });
});

describe("overdueAlertText", () => {
  it("matches the design copy, singular and plural", () => {
    expect(overdueAlertText(1)).toBe(
      "1 submission has been waiting more than 2 days.",
    );
    expect(overdueAlertText(4)).toBe(
      "4 submissions have been waiting more than 2 days.",
    );
  });
});

describe("provenanceLine", () => {
  it("renders submitted date, wait and rendition count", () => {
    expect(provenanceLine(daysAgo(6), 2, NOW)).toBe(
      "submitted Sep 3 · waiting 6 days · 2 renditions ready",
    );
    expect(provenanceLine(daysAgo(1), 1, NOW)).toBe(
      "submitted Sep 8 · waiting 1 day · 1 rendition ready",
    );
  });

  it("degrades a null submitted_at instead of printing Invalid Date", () => {
    expect(provenanceLine(null, 0, NOW)).toBe(
      "submission date unknown · 0 renditions ready",
    );
  });
});
