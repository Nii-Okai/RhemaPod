import * as React from "react";
import { cn } from "cn";

/* =============================================================================
   DataTableSkeleton — the DataTable loading state (W6). Hand-built.

   README §"Interactions & behavior" → Loading: "skeletons that match final
   geometry: #EFE9DF blocks at the exact row height (60px) [...] No spinners."

   So this is not a generic shimmer: it reproduces the DataTable body-row
   geometry exactly — same `grid-template-columns`, same 12px gap, same 20px
   inline padding, same 60px row height, same `border-subtle` divider — and
   drops one `border-subtle` block into each grid track. It is `aria-hidden`;
   the DataTable region carries `aria-busy` for assistive tech.
   ========================================================================== */

type DataTableSkeletonProps = {
  /** The composed grid template (must match the real header/body). */
  gridTemplate: string;
  /** Column count (drives blocks-per-row); excludes the checkbox column. */
  columnCount: number;
  /** Whether a leading 44px checkbox column is present. */
  selectable?: boolean;
  /** Whether a trailing 40px row-actions column is present. */
  rowActions?: boolean;
  /** How many skeleton rows to render. */
  rows?: number;
};

function DataTableSkeleton({
  gridTemplate,
  columnCount,
  selectable = false,
  rowActions = false,
  rows = 8,
}: DataTableSkeletonProps) {
  return (
    <div aria-hidden data-slot="data-table-skeleton">
      {Array.from({ length: Math.max(0, rows) }).map((_, r) => (
        <div
          key={r}
          className="grid h-[60px] items-center gap-12 border-b border-border-subtle px-20 last:border-b-0"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {selectable ? (
            <span className="block size-[17px] rounded-4 bg-border-subtle" />
          ) : null}
          {Array.from({ length: Math.max(0, columnCount) }).map((__, c) => (
            <span
              key={c}
              className={cn(
                "block h-[14px] rounded-4 bg-border-subtle",
                c === 0 ? "w-[70%]" : "w-[52%]",
              )}
            />
          ))}
          {rowActions ? (
            <span className="block h-[14px] w-[16px] rounded-4 bg-border-subtle" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

export { DataTableSkeleton };
export type { DataTableSkeletonProps };
