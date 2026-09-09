import { describe, expect, it } from "vitest";

import {
  clampPage,
  formatBytes,
  formatDuration,
  formatRelativeTime,
} from "@/lib/format";

/* W8 added `formatRelativeTime` (the autosave "saved N min ago" stamp) and
   `formatBytes` (read-only upload-job rows). `formatDuration` is W7's. */

describe("formatRelativeTime", () => {
  const now = Date.UTC(2026, 8, 8, 12, 0, 0);

  it("clamps sub-minute (and a future timestamp) to 'just now'", () => {
    expect(formatRelativeTime(now - 5_000, now)).toBe("just now");
    expect(formatRelativeTime(now + 60_000, now)).toBe("just now");
  });

  it("rounds to whole minutes then hours", () => {
    expect(formatRelativeTime(now - 60_000, now)).toBe("1 min ago");
    expect(formatRelativeTime(now - 42 * 60_000, now)).toBe("42 min ago");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3 hr ago");
  });

  it("uses days up to a week, then an absolute short date", () => {
    expect(formatRelativeTime(now - 24 * 3_600_000, now)).toBe("1 day ago");
    expect(formatRelativeTime(now - 3 * 24 * 3_600_000, now)).toBe(
      "3 days ago",
    );
    // 10 days back → no "10 days ago"
    expect(formatRelativeTime(now - 10 * 24 * 3_600_000, now)).toMatch(
      /[A-Z][a-z]{2} \d+/,
    );
  });

  it("accepts a Date and returns '' for nullish / non-finite", () => {
    expect(formatRelativeTime(new Date(now - 60_000), now)).toBe("1 min ago");
    expect(formatRelativeTime(null)).toBe("");
    expect(formatRelativeTime(Number.NaN, now)).toBe("");
  });
});

describe("formatBytes", () => {
  it("scales into binary units with one decimal below 100", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1_500_000)).toBe("1.4 MB");
    expect(formatBytes(2.2 * 1024 ** 3)).toBe("2.2 GB");
    expect(formatBytes(512 * 1024 ** 3)).toBe("512 GB");
  });

  it("returns an em dash for nullish / negative", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
  });
});

describe("clampPage", () => {
  it("passes through a valid 1-based page", () => {
    expect(clampPage(1)).toBe(1);
    expect(clampPage(7)).toBe(7);
    expect(clampPage("3")).toBe(3);
  });

  it("floors a fraction and clamps anything sub-1 / non-finite / junk to 1", () => {
    expect(clampPage(2.9)).toBe(2);
    expect(clampPage(0)).toBe(1);
    expect(clampPage(-4)).toBe(1);
    expect(clampPage(Number.NaN)).toBe(1);
    expect(clampPage("not a page")).toBe(1);
    expect(clampPage(null)).toBe(1);
    expect(clampPage(undefined)).toBe(1);
  });
});

describe("formatDuration (regression)", () => {
  it("keeps its W7 shape", () => {
    expect(formatDuration(1862)).toBe("31:02");
    expect(formatDuration(3909)).toBe("1:05:09");
    expect(formatDuration(null)).toBe("—");
  });
});
