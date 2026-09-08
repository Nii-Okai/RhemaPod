import { describe, it, expect } from "vitest";

import {
  toggleKey,
  rangeKeys,
  applyRange,
  isAllSelected,
  isIndeterminate,
  toggleAll,
} from "@/lib/portal/use-row-selection";

const PAGE1 = ["a", "b", "c", "d"];

describe("toggleKey", () => {
  it("adds a missing key and removes a present one", () => {
    expect([...toggleKey(new Set(), "a")]).toEqual(["a"]);
    expect([...toggleKey(new Set(["a", "b"]), "a")]).toEqual(["b"]);
  });

  it("does not mutate the input set", () => {
    const src = new Set(["a"]);
    const out = toggleKey(src, "b");
    expect([...src]).toEqual(["a"]);
    expect(out).not.toBe(src);
    expect([...out].sort()).toEqual(["a", "b"]);
  });
});

describe("isAllSelected / isIndeterminate", () => {
  it("an empty page is neither all-selected nor indeterminate", () => {
    expect(isAllSelected(new Set(["a"]), [])).toBe(false);
    expect(isIndeterminate(new Set(["a"]), [])).toBe(false);
  });

  it("every current key selected => all, not indeterminate", () => {
    const sel = new Set(PAGE1);
    expect(isAllSelected(sel, PAGE1)).toBe(true);
    expect(isIndeterminate(sel, PAGE1)).toBe(false);
  });

  it("some current keys selected => indeterminate, not all", () => {
    const sel = new Set(["a", "c"]);
    expect(isAllSelected(sel, PAGE1)).toBe(false);
    expect(isIndeterminate(sel, PAGE1)).toBe(true);
  });

  it("no current keys selected => neither (off-page keys don't count)", () => {
    const sel = new Set(["x", "y"]);
    expect(isAllSelected(sel, PAGE1)).toBe(false);
    expect(isIndeterminate(sel, PAGE1)).toBe(false);
  });
});

describe("toggleAll", () => {
  it("selects every current-page key when none/some are selected", () => {
    expect([...toggleAll(new Set(), PAGE1)].sort()).toEqual(PAGE1);
    expect([...toggleAll(new Set(["b"]), PAGE1)].sort()).toEqual(PAGE1);
  });

  it("clears the current page when it is fully selected", () => {
    expect([...toggleAll(new Set(PAGE1), PAGE1)]).toEqual([]);
  });

  it("does not mutate the input set", () => {
    const src = new Set(["b"]);
    const out = toggleAll(src, PAGE1);
    expect([...src]).toEqual(["b"]);
    expect(out).not.toBe(src);
  });

  it("leaves keys that are not on the current page untouched", () => {
    const sel = new Set(["z"]);
    expect([...toggleAll(sel, PAGE1)].sort()).toEqual(["a", "b", "c", "d", "z"]);
    const full = new Set([...PAGE1, "z"]);
    expect([...toggleAll(full, PAGE1)]).toEqual(["z"]);
  });
});

describe("rangeKeys", () => {
  it("no anchor => just the target", () => {
    expect(rangeKeys(PAGE1, null, "c")).toEqual(["c"]);
  });

  it("forward range is the inclusive slice in row order", () => {
    expect(rangeKeys(PAGE1, "a", "c")).toEqual(["a", "b", "c"]);
  });

  it("backward range is still returned in row order", () => {
    expect(rangeKeys(PAGE1, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("anchor === target => single key", () => {
    expect(rangeKeys(PAGE1, "b", "b")).toEqual(["b"]);
  });

  it("anchor missing from the current order => just the target (cross-page shift keeps prior picks)", () => {
    expect(rangeKeys(PAGE1, "gone", "c")).toEqual(["c"]);
  });

  it("target missing from the current order => no-op (never a phantom key with no row)", () => {
    expect(rangeKeys(PAGE1, "a", "missing")).toEqual([]);
    expect(rangeKeys(PAGE1, null, "missing")).toEqual([]);
  });

  it("is computed over the CURRENT (re-ordered) key list", () => {
    const reordered = ["d", "c", "b", "a"];
    expect(rangeKeys(reordered, "d", "b")).toEqual(["d", "c", "b"]);
  });
});

describe("applyRange", () => {
  it("unions the range onto the existing selection", () => {
    const out = applyRange(new Set(["x"]), PAGE1, "a", "c");
    expect([...out].sort()).toEqual(["a", "b", "c", "x"]);
  });

  it("does not mutate the input set", () => {
    const src = new Set(["x"]);
    const out = applyRange(src, PAGE1, "a", "c");
    expect([...src]).toEqual(["x"]);
    expect(out).not.toBe(src);
  });

  it("an unknown target is a no-op — selection is returned unchanged", () => {
    const out = applyRange(new Set(["x"]), PAGE1, "a", "missing");
    expect([...out].sort()).toEqual(["x"]);
  });

  it("re-selects an anchor that was since deselected", () => {
    // 'a' is still on the page but no longer in the selection.
    const sel = new Set(["c"]);
    const out = applyRange(sel, PAGE1, "a", "c");
    expect([...out].sort()).toEqual(["a", "b", "c"]);
  });

  it("shift-range across a page boundary keeps prior-page picks, adds only the target", () => {
    // Page 1 fully selected, page 2 now on screen, anchor 'c' is off-page.
    const carried = new Set(PAGE1);
    const page2 = ["e", "f", "g"];
    const out = applyRange(carried, page2, "c", "f");
    expect([...out].sort()).toEqual(["a", "b", "c", "d", "f"]);
    // and a real range within page 2 works off a fresh anchor
    const out2 = applyRange(out, page2, "e", "g");
    expect([...out2].sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
    ]);
  });
});
