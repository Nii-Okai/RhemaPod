import { describe, expect, it } from "vitest";

import {
  addDays,
  candidateWords,
  formatClock,
  isCovered,
  monthGrid,
  monthsIn,
  parseClock,
  rangeFor,
  rangeLabel,
  shiftAnchor,
  startOfWeek,
  wordInPassage,
} from "@/lib/devotionals/calendar";

/* Devotional dates are calendar dates (ADR 0022 §1); these pin the pure
   arithmetic the calendar, editor and import screens share. */

describe("date arithmetic", () => {
  it("adds days across month, year and DST boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30"); // EU DST change
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("starts weeks on Monday", () => {
    expect(startOfWeek("2026-11-09")).toBe("2026-11-09"); // Monday
    expect(startOfWeek("2026-11-15")).toBe("2026-11-09"); // Sunday
    expect(startOfWeek("2026-11-11")).toBe("2026-11-09");
  });

  it("computes week, month and quarter ranges", () => {
    expect(rangeFor("week", "2026-11-12")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(rangeFor("month", "2026-02-14")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(rangeFor("quarter", "2026-11-20")).toEqual({ from: "2026-11-01", to: "2027-01-31" });
  });

  it("shifts the anchor one view at a time", () => {
    expect(shiftAnchor("week", "2026-11-12", 1)).toBe("2026-11-16");
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftAnchor("quarter", "2026-11-20", -1)).toBe("2026-08-01");
  });

  it("lays out a Monday-first month grid in whole weeks", () => {
    const cells = monthGrid("2026-11-01"); // Sunday
    expect(cells.slice(0, 7)).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(cells.length % 7).toBe(0);
    expect(cells.filter(Boolean)).toHaveLength(30);
  });

  it("lists the months a range covers", () => {
    expect(monthsIn("2026-11-01", "2027-01-31")).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
  });

  it("labels ranges", () => {
    expect(rangeLabel("month", "2026-11-01", "2026-11-30")).toBe("November 2026");
    expect(rangeLabel("quarter", "2026-11-01", "2027-01-31")).toBe("Nov 2026 – Jan 2027");
    expect(rangeLabel("week", "2026-11-09", "2026-11-15")).toBe("9 Nov – 15 Nov 2026");
  });
});

describe("coverage", () => {
  it("counts only days that will go live", () => {
    expect(isCovered("scheduled")).toBe(true);
    expect(isCovered("published")).toBe(true);
    expect(isCovered("pending_review")).toBe(false);
    expect(isCovered("draft")).toBe(false);
    expect(isCovered(undefined)).toBe(false);
  });
});

describe("clock", () => {
  it("round-trips m:ss", () => {
    expect(formatClock(760)).toBe("12:40");
    expect(formatClock(null)).toBe("");
    expect(parseClock("12:40")).toBe(760);
    expect(parseClock("90")).toBe(90);
    expect(parseClock("")).toBeNull();
    expect(parseClock("1:75")).toBeNaN();
  });
});

describe("suggested word", () => {
  const text = "Be still, and know that I am God. God's refuge is still here.";
  it("matches whole words case-insensitively, like the server", () => {
    expect(wordInPassage("STILL", text)).toBe(true);
    expect(wordInPassage("know", text)).toBe(true);
    expect(wordInPassage("now", text)).toBe(false);
    expect(wordInPassage("God", "God's refuge")).toBe(false); // apostrophe joins the word, as on the server
    expect(wordInPassage("", text)).toBe(true);
  });

  it("offers each candidate word once, three letters or more", () => {
    const words = candidateWords("Be still, and know. Be STILL.");
    expect(words).toEqual(["still", "and", "know"]);
  });
});
