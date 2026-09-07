import { describe, it, expect } from "vitest";
import { paginationRange } from "@/components/portal/pagination";

describe("paginationRange", () => {
  it("lists every page when the count fits the window", () => {
    expect(paginationRange(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(paginationRange(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("collapses the far side with a single ellipsis near the start", () => {
    expect(paginationRange(2, 22)).toEqual([1, 2, 3, "ellipsis", 22]);
  });

  it("collapses both sides in the middle", () => {
    expect(paginationRange(11, 22)).toEqual([
      1,
      "ellipsis",
      10,
      11,
      12,
      "ellipsis",
      22,
    ]);
  });

  it("collapses the near side at the end", () => {
    expect(paginationRange(22, 22)).toEqual([1, "ellipsis", 21, 22]);
  });

  it("always keeps first and last page", () => {
    const r = paginationRange(11, 22);
    expect(r[0]).toBe(1);
    expect(r[r.length - 1]).toBe(22);
  });

  it("handles empty / single page", () => {
    expect(paginationRange(1, 0)).toEqual([]);
    expect(paginationRange(1, 1)).toEqual([1]);
  });
});
