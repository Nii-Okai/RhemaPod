"use client";

import * as React from "react";
import { cn } from "cn";

/* =============================================================================
   SegmentedControl — RhemaPod UI Kit primitive (W2). Hand-built.

   Dashboard §2 / Sermons list §3: neutral-badge track, radius 10, 3px padding;
   the selected segment carries a white thumb (radius 8, shadow-segmented-thumb),
   13/600. Rendered as an equal-columns grid so the "thumb" needs no layout
   measurement.

   Keyboard: role="radiogroup" of role="radio" buttons with a roving tabindex;
   Arrow / Home / End move selection. The pure navigation logic is
   `nextSegmentIndex()` so it can be unit-tested without a DOM.
   ========================================================================== */

/**
 * Given the current index, a keyboard key and the option count, return the
 * index that key selects. Non-navigation keys return `current` unchanged.
 * Left/Right wrap; Home/End jump to the ends.
 */
export function nextSegmentIndex(
  current: number,
  key: string,
  count: number,
): number {
  if (count <= 0) return current;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return current;
  }
}

export type SegmentOption<T extends string = string> = {
  value: T;
  label: React.ReactNode;
};

type SegmentedControlProps<T extends string> = {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onValueChange: (value: T) => void;
  "aria-label": string;
  className?: string;
};

function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  className,
  ...aria
}: SegmentedControlProps<T>) {
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: React.KeyboardEvent) {
    const next = nextSegmentIndex(selectedIndex, e.key, options.length);
    if (next === selectedIndex) return;
    e.preventDefault();
    onValueChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={aria["aria-label"]}
      onKeyDown={onKeyDown}
      className={cn(
        "grid w-fit auto-cols-fr grid-flow-col gap-2 rounded-10 bg-neutral-badge p-[3px]",
        className,
      )}
    >
      {options.map((opt, i) => {
        const selected = i === selectedIndex;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              "cursor-pointer rounded-8 px-12 py-[5px] text-[13px] font-semibold transition-colors duration-150 ease-out outline-none focus-visible:focus-ring-button",
              selected
                ? "shadow-segmented-thumb bg-surface text-ink"
                : "bg-transparent text-ink-muted hover:text-ink",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export { SegmentedControl };
export type { SegmentedControlProps };
