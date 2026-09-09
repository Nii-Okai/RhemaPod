import { describe, expect, it } from "vitest";

import {
  formatLocalDateTime,
  parseLocalDateTime,
} from "@/components/announcements/datetime";

/* W13 — the editor's `YYYY-MM-DD HH:mm` (local) ⇄ ISO helpers. Strict parsing
   so a malformed value shows an inline error instead of posting a 422. */

describe("parseLocalDateTime", () => {
  it("blank → ok with a null iso", () => {
    expect(parseLocalDateTime("")).toEqual({ ok: true, iso: null });
    expect(parseLocalDateTime("   ")).toEqual({ ok: true, iso: null });
  });

  it("a well-formed local time round-trips through formatLocalDateTime", () => {
    const parsed = parseLocalDateTime("2026-09-08 09:00");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.iso) throw new Error("expected an iso");
    expect(formatLocalDateTime(parsed.iso)).toBe("2026-09-08 09:00");
  });

  it("accepts a `T` separator too", () => {
    expect(parseLocalDateTime("2026-09-08T09:00").ok).toBe(true);
  });

  it("rejects a malformed value", () => {
    for (const bad of [
      "2026/09/08 09:00",
      "8 Sep 2026",
      "2026-09-08",
      "2026-09-08 9:00",
      "2026-13-01 09:00",
      "2026-09-31 09:00",
      "2026-09-08 24:00",
      "garbage",
    ]) {
      expect(parseLocalDateTime(bad), bad).toEqual({ ok: false });
    }
  });
});

describe("formatLocalDateTime", () => {
  it("blank / invalid input → empty string", () => {
    expect(formatLocalDateTime(null)).toBe("");
    expect(formatLocalDateTime(undefined)).toBe("");
    expect(formatLocalDateTime("not-a-date")).toBe("");
  });
});
