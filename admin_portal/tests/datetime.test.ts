import { describe, expect, it } from "vitest";

import { formatLocalDateTime, parseLocalDateTime } from "@/lib/datetime";

/* W13 (bugfix batch #7), extracted to `lib/datetime.ts` in round 2 once the
   sermon editor became a second consumer — the shared `<input
   type="datetime-local">` value (`YYYY-MM-DDTHH:mm`, local) ⇄ ISO helpers.
   Strict parsing so a malformed value shows an inline error instead of
   posting a 422. */

describe("parseLocalDateTime", () => {
  it("blank → ok with a null iso", () => {
    expect(parseLocalDateTime("")).toEqual({ ok: true, iso: null });
    expect(parseLocalDateTime("   ")).toEqual({ ok: true, iso: null });
  });

  it("a datetime-local value round-trips through formatLocalDateTime", () => {
    const parsed = parseLocalDateTime("2026-09-08T09:00");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.iso) throw new Error("expected an iso");
    expect(formatLocalDateTime(parsed.iso)).toBe("2026-09-08T09:00");
  });

  it("still accepts a space separator (an ISO-ish paste)", () => {
    expect(parseLocalDateTime("2026-09-08 09:00").ok).toBe(true);
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
