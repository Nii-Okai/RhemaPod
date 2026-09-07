import { describe, it, expect } from "vitest";
import { nextSegmentIndex } from "@/components/portal/segmented-control";

/* SegmentedControl selection: the pure keyboard-navigation resolver. */

describe("nextSegmentIndex", () => {
  const count = 4;

  it("moves right and wraps past the end", () => {
    expect(nextSegmentIndex(0, "ArrowRight", count)).toBe(1);
    expect(nextSegmentIndex(3, "ArrowRight", count)).toBe(0);
    expect(nextSegmentIndex(1, "ArrowDown", count)).toBe(2);
  });

  it("moves left and wraps past the start", () => {
    expect(nextSegmentIndex(2, "ArrowLeft", count)).toBe(1);
    expect(nextSegmentIndex(0, "ArrowLeft", count)).toBe(3);
    expect(nextSegmentIndex(2, "ArrowUp", count)).toBe(1);
  });

  it("jumps to the ends with Home / End", () => {
    expect(nextSegmentIndex(2, "Home", count)).toBe(0);
    expect(nextSegmentIndex(1, "End", count)).toBe(count - 1);
  });

  it("is a no-op for non-navigation keys", () => {
    expect(nextSegmentIndex(2, "Enter", count)).toBe(2);
    expect(nextSegmentIndex(2, " ", count)).toBe(2);
    expect(nextSegmentIndex(2, "Tab", count)).toBe(2);
  });

  it("never returns an out-of-range index", () => {
    for (let i = 0; i < count; i++) {
      for (const key of ["ArrowLeft", "ArrowRight", "Home", "End", "x"]) {
        const next = nextSegmentIndex(i, key, count);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(count);
      }
    }
  });

  it("guards against a zero-length option list", () => {
    expect(nextSegmentIndex(0, "ArrowRight", 0)).toBe(0);
  });
});
