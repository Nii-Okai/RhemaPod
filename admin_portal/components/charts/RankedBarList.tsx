import * as React from "react";
import { cn } from "cn";

import { Progress } from "@/components/ui/progress";

/* =============================================================================
   RankedBarList — the Dashboard "Top sermons" list (design:
   `docs/design_admin_portal/RhemaPod Admin Portal.dc.html`). Not a chart
   (plan §A.7): a ranked list where each row carries a proportional-width bar,
   which is exactly the Phase 1 `Progress` primitive (`components/ui/progress.tsx`).

   Composition, not a re-implementation:
     - bar        -> `<Progress variant="upload">` — clay-600 fill on a
       --color-border-subtle track, radius 999. The design track is 5px vs the
       primitive's 6px, closed with `className="h-[5px]"` (cn == twMerge, the
       `h-*` conflict resolves last-wins).
     - fill width -> value / max, where max is the largest value (rows are
       rendered in the order given, not re-sorted).

   Row geometry from the mock: `gap: 11px`, 2-digit mono rank in
   --color-ink-faint, a truncating 13.5/600 label over the bar (`gap: 4px`),
   and a mono value in --color-ink-muted. Rows `gap: 12px`.
   ========================================================================== */

export type RankedBarItem = {
  label: string;
  /** Non-negative magnitude driving the bar width. */
  value: number;
};

export type RankedBarListProps = {
  items: RankedBarItem[];
  /** Formats the trailing value. Default: `en-US` thousands grouping. */
  formatValue?: (value: number) => string;
  /** Shown when `items` is empty. */
  emptyLabel?: string;
  className?: string;
};

const defaultFormat = (value: number) => value.toLocaleString("en-US");

export function RankedBarList({
  items,
  formatValue = defaultFormat,
  emptyLabel = "No data yet",
  className,
}: RankedBarListProps) {
  if (items.length === 0) {
    return (
      <p
        data-slot="ranked-bar-list-empty"
        className={cn("text-body-sm text-ink-faint", className)}
      >
        {emptyLabel}
      </p>
    );
  }

  const max = items.reduce((m, item) => Math.max(m, item.value), 0);

  return (
    <ol
      data-slot="ranked-bar-list"
      className={cn("flex flex-col gap-12", className)}
    >
      {items.map((item, i) => {
        const formatted = formatValue(item.value);
        const pct = max > 0 ? (Math.max(0, item.value) / max) * 100 : 0;
        return (
          <li
            key={`${i}-${item.label}`}
            data-slot="ranked-bar-list-row"
            className="flex items-center gap-[11px]"
          >
            <span className="flex-none font-mono text-[12px] text-ink-faint tabular-nums">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <span className="truncate text-[13.5px] font-semibold text-ink">
                {item.label}
              </span>
              <Progress
                value={pct}
                variant="upload"
                label={`${item.label}: ${formatted}`}
                className="h-[5px]"
              />
            </div>
            <span className="flex-none font-mono text-[12px] tabular-nums text-ink-muted">
              {formatted}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
