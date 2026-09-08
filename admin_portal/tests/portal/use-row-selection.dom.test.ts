import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  useRowSelection,
  type UseRowSelectionOptions,
} from "@/lib/portal/use-row-selection";

/* The pure reducer is covered in `use-row-selection.test.ts` (node project).
   This suite exercises the hook WRAPPER — anchor lifecycle, the
   controlled/uncontrolled split, the dev warning — under a real renderer. */

const KEYS = ["a", "b", "c", "d"];

const setup = (options?: Partial<UseRowSelectionOptions>) =>
  renderHook(() => useRowSelection({ orderedKeys: KEYS, ...options }));

describe("useRowSelection — anchor lifecycle", () => {
  it("moves the range anchor to the key of every plain toggle", () => {
    const { result } = setup();

    act(() => result.current.toggle("a")); // anchor -> a
    act(() => result.current.toggle("c")); // anchor -> c (the point under test)
    act(() => result.current.selectRange("a")); // range a..c off the c anchor

    // If the anchor had stuck at "a", selectRange("a") would be the single
    // key "a"; a c-anchor makes it the inclusive slice a..c.
    expect([...result.current.selected].sort()).toEqual(["a", "b", "c"]);
  });

  it("sets the anchor to the target when selectRange runs with no anchor yet", () => {
    const { result } = setup();

    act(() => result.current.selectRange("c")); // no anchor -> just "c", anchor := c
    expect([...result.current.selected]).toEqual(["c"]);

    act(() => result.current.selectRange("a")); // now a real range off the c anchor
    expect([...result.current.selected].sort()).toEqual(["a", "b", "c"]);
  });

  it("resets an off-page anchor to the target, then ranges from there", () => {
    const { result } = setup();

    act(() => result.current.toggle("z")); // anchor -> "z" (not in KEYS)
    act(() => result.current.selectRange("c")); // off-page anchor -> just "c", anchor := c
    expect([...result.current.selected].sort()).toEqual(["c", "z"]);

    act(() => result.current.selectRange("a")); // range a..c off the reset anchor
    expect([...result.current.selected].sort()).toEqual(["a", "b", "c", "z"]);
  });

  it("keeps an on-page anchor even after that row is deselected", () => {
    const { result } = setup();

    act(() => result.current.toggle("a")); // select a, anchor -> a
    act(() => result.current.toggle("a")); // deselect a, anchor still -> a
    act(() => result.current.selectRange("c")); // anchor "a" is on-page: range a..c

    // Proves selectRange used "a" (not null -> would be just "c") AND that the
    // still-valid anchor was not reset by the null/off-page branch.
    expect([...result.current.selected].sort()).toEqual(["a", "b", "c"]);
  });

  it("clear() drops the anchor so the next selectRange starts fresh", () => {
    const { result } = setup();

    act(() => result.current.toggle("a")); // anchor -> a
    act(() => result.current.clear()); // anchor -> null
    act(() => result.current.selectRange("c")); // no anchor -> just "c"

    expect([...result.current.selected]).toEqual(["c"]);
  });
});

describe("useRowSelection — controlled vs uncontrolled", () => {
  it("uncontrolled: seeds from defaultSelectedKeys and drives its own state", () => {
    const onSelectionChange = vi.fn();
    const { result } = setup({
      defaultSelectedKeys: new Set(["a"]),
      onSelectionChange,
    });

    expect(result.current.isSelected("a")).toBe(true);

    act(() => result.current.toggle("b"));
    expect([...result.current.selected].sort()).toEqual(["a", "b"]);
    const lastArg = onSelectionChange.mock.calls.at(-1)?.[0] as Set<string>;
    expect([...lastArg].sort()).toEqual(["a", "b"]);
  });

  it("controlled: never drifts from the selectedKeys prop", () => {
    const onSelectionChange = vi.fn();
    const controlled: ReadonlySet<string> = new Set(["a"]);
    const { result, rerender } = renderHook(
      ({ sel }: { sel: ReadonlySet<string> }) =>
        useRowSelection({
          orderedKeys: KEYS,
          selectedKeys: sel,
          onSelectionChange,
        }),
      { initialProps: { sel: controlled } },
    );

    expect(result.current.selected).toBe(controlled);

    act(() => result.current.toggle("b"));

    // The callback fired with the next value, but internal state did not move —
    // the parent owns it and has not pushed a new prop.
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect([...onSelectionChange.mock.calls[0][0]].sort()).toEqual(["a", "b"]);
    expect(result.current.selected).toBe(controlled);
    expect(result.current.isSelected("b")).toBe(false);

    rerender({ sel: controlled });
    expect(result.current.selected).toBe(controlled);
  });

  it("both props: warns once (dev) and behaves as controlled", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const controlled: ReadonlySet<string> = new Set(["a"]);

    const { result } = renderHook(() =>
      useRowSelection({
        orderedKeys: KEYS,
        selectedKeys: controlled,
        defaultSelectedKeys: new Set(["b", "c"]),
      }),
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/both/i);

    // controlled wins; defaultSelectedKeys is ignored
    expect(result.current.selected).toBe(controlled);
    expect(result.current.isSelected("b")).toBe(false);

    warn.mockRestore();
  });
});
