import * as React from "react";

/* =============================================================================
   useRowSelection — the DataTable selection reducer (W6). Hand-built.

   The design (README §"DataTable" / Screen 3) needs: a per-row checkbox, a
   header select-all with an indeterminate state, Space to toggle the focused
   row, and Shift-click / Shift-Space to select the contiguous range from the
   last-touched row (the "anchor").

   All of the interesting logic — range maths, anchor tracking, the
   all/indeterminate derivation — lives here as PURE FUNCTIONS so it can be
   unit-tested without a DOM (plan §A.11: assert on logic, not on render). The
   `useRowSelection` hook is a thin controlled/uncontrolled wrapper over them.

   Selection is a Set of row KEYS (not indices), so it survives a page change,
   a filter, or a re-order: keys that scroll off the current page stay selected,
   and select-all / indeterminate are always derived against the CURRENT page's
   ordered key list.
   ========================================================================== */

/** Add `key` if absent, remove it if present. Returns a new Set. */
export function toggleKey(
  selected: ReadonlySet<string>,
  key: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * The contiguous run of keys between `anchorKey` and `targetKey`, in the order
 * they appear in `orderedKeys` (i.e. the CURRENT row order — a filter or sort
 * changes what "the range" means, deliberately).
 *
 * - `targetKey` not on the current page ⇒ `[]` (a no-op — never a phantom
 *   select of a key that has no row).
 * - no usable anchor (none set yet, or the anchored row has scrolled off the
 *   page) ⇒ `[targetKey]`. This is what makes a Shift-click on a fresh page
 *   after a page change add only the target while keeping the prior page's
 *   picks (the design's "selection survives a page change").
 * - an anchor that is still on the page but has since been DESELECTED is still
 *   a valid anchor — the range is recomputed from its position and re-selects
 *   it.
 */
export function rangeKeys(
  orderedKeys: readonly string[],
  anchorKey: string | null,
  targetKey: string,
): string[] {
  const b = orderedKeys.indexOf(targetKey);
  if (b === -1) return [];
  if (anchorKey == null) return [targetKey];
  const a = orderedKeys.indexOf(anchorKey);
  if (a === -1) return [targetKey];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return orderedKeys.slice(lo, hi + 1);
}

/** Union `selected` with the anchor→target range. Returns a new Set. */
export function applyRange(
  selected: ReadonlySet<string>,
  orderedKeys: readonly string[],
  anchorKey: string | null,
  targetKey: string,
): Set<string> {
  const next = new Set(selected);
  for (const k of rangeKeys(orderedKeys, anchorKey, targetKey)) next.add(k);
  return next;
}

/** Every key on the current page is selected (and the page is non-empty). */
export function isAllSelected(
  selected: ReadonlySet<string>,
  orderedKeys: readonly string[],
): boolean {
  return orderedKeys.length > 0 && orderedKeys.every((k) => selected.has(k));
}

/** Some — but not all — of the current page is selected. */
export function isIndeterminate(
  selected: ReadonlySet<string>,
  orderedKeys: readonly string[],
): boolean {
  const hit = orderedKeys.filter((k) => selected.has(k)).length;
  return hit > 0 && hit < orderedKeys.length;
}

/**
 * Select-all when nothing / some is selected; clear the current page's keys
 * when everything on it is already selected. Keys NOT on the current page are
 * left untouched either way. Returns a new Set.
 */
export function toggleAll(
  selected: ReadonlySet<string>,
  orderedKeys: readonly string[],
): Set<string> {
  if (isAllSelected(selected, orderedKeys)) {
    const next = new Set(selected);
    for (const k of orderedKeys) next.delete(k);
    return next;
  }
  const next = new Set(selected);
  for (const k of orderedKeys) next.add(k);
  return next;
}

export type UseRowSelectionOptions = {
  /** Row keys in current display order (`rows.map(rowKey)`). */
  orderedKeys: readonly string[];
  /** Controlled selection. Omit for uncontrolled. Memoize this Set. */
  selectedKeys?: ReadonlySet<string>;
  /** Initial selection when uncontrolled. */
  defaultSelectedKeys?: ReadonlySet<string>;
  /** Fired with the next Set on every change (controlled or not). */
  onSelectionChange?: (next: Set<string>) => void;
};

export type RowSelection = {
  selected: ReadonlySet<string>;
  allSelected: boolean;
  indeterminate: boolean;
  isSelected: (key: string) => boolean;
  /** Plain toggle of one row; also (re)sets the range anchor to `key`. */
  toggle: (key: string) => void;
  /** Shift-select: union with the anchor→key range. Anchor is kept. */
  selectRange: (key: string) => void;
  /** Header checkbox: select-all / clear-all for the current page. */
  toggleAll: () => void;
  /** Drop every selected key. */
  clear: () => void;
};

/**
 * Controlled/uncontrolled wrapper over the pure functions above.
 *
 * The returned callbacks are NOT memoised: every consumer site is an inline
 * closure in JSX that re-creates each render regardless, and the arrays these
 * operate over are page-sized, so `useCallback` here only bought identity
 * churn on its own deps. `isSelected` is a plain closure for the same reason.
 */
export function useRowSelection(
  options: UseRowSelectionOptions,
): RowSelection {
  const { orderedKeys, selectedKeys, defaultSelectedKeys, onSelectionChange } =
    options;

  const controlled = selectedKeys != null;
  const hasDefault = defaultSelectedKeys != null;

  // Dev-only: passing both the controlled and the uncontrolled prop is a bug.
  // We treat the hook as controlled (above) and ignore `defaultSelectedKeys`.
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production" && controlled && hasDefault) {
      console.warn(
        "useRowSelection: received both `selectedKeys` (controlled) and " +
          "`defaultSelectedKeys` (uncontrolled). `defaultSelectedKeys` is " +
          "ignored; the hook is treated as controlled.",
      );
    }
  }, [controlled, hasDefault]);

  const [internal, setInternal] = React.useState<Set<string>>(
    () => new Set(defaultSelectedKeys ?? []),
  );
  const selected: ReadonlySet<string> = controlled ? selectedKeys : internal;

  const anchorRef = React.useRef<string | null>(null);

  const commit = (next: Set<string>) => {
    if (!controlled) setInternal(next);
    onSelectionChange?.(next);
  };

  const toggle = (key: string) => {
    anchorRef.current = key;
    commit(toggleKey(selected, key));
  };

  const selectRange = (key: string) => {
    const anchor = anchorRef.current;
    commit(applyRange(selected, orderedKeys, anchor, key));
    if (anchor == null || orderedKeys.indexOf(anchor) === -1) {
      anchorRef.current = key;
    }
  };

  const toggleAllCb = () => {
    commit(toggleAll(selected, orderedKeys));
  };

  const clear = () => {
    anchorRef.current = null;
    commit(new Set());
  };

  return {
    selected,
    allSelected: isAllSelected(selected, orderedKeys),
    indeterminate: isIndeterminate(selected, orderedKeys),
    isSelected: (key: string) => selected.has(key),
    toggle,
    selectRange,
    toggleAll: toggleAllCb,
    clear,
  };
}
