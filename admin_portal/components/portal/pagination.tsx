import * as React from "react";
import { cn } from "cn";

/* =============================================================================
   Pagination — RhemaPod UI Kit primitive (W2). Hand-built.
   UI Kit §06 footer: 30px squares, radius 8; prev / page numbers / next.
   Current page is clay-600 filled; arrows are ink-faint. Collapses to
   1 ... (page-1) page (page+1) ... N past 7 pages.
   ========================================================================== */

/** Page list with "ellipsis" gaps. 1-based. */
export function paginationRange(
  page: number,
  pageCount: number,
  siblings = 1,
): Array<number | "ellipsis"> {
  const total = Math.max(0, pageCount);
  if (total <= 0) return [];
  const window = siblings * 2 + 5; // first + last + current + 2*siblings + 2 gaps
  if (total <= window) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const left = Math.max(2, page - siblings);
  const right = Math.min(total - 1, page + siblings);
  const out: Array<number | "ellipsis"> = [1];
  if (left > 2) out.push("ellipsis");
  for (let i = left; i <= right; i++) out.push(i);
  if (right < total - 1) out.push("ellipsis");
  out.push(total);
  return out;
}

const cell =
  "h-[30px] min-w-[30px] cursor-pointer rounded-8 border px-[9px] text-[13px] outline-none transition-colors duration-150 ease-out focus-visible:focus-ring-button disabled:cursor-not-allowed disabled:opacity-40";

type PaginationProps = {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
  "aria-label"?: string;
};

function Pagination({
  page,
  pageCount,
  onPageChange,
  className,
  ...aria
}: PaginationProps) {
  const range = paginationRange(page, pageCount);
  return (
    <nav
      aria-label={aria["aria-label"] ?? "Pagination"}
      className={cn("flex gap-6", className)}
    >
      <button
        type="button"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={cn(cell, "border-border bg-surface text-ink-faint")}
      >
        &larr;
      </button>
      {range.map((item, i) =>
        item === "ellipsis" ? (
          <span
            key={`e${i}`}
            aria-hidden
            className="flex h-[30px] min-w-[30px] items-center justify-center text-[13px] text-ink-faint"
          >
            &hellip;
          </span>
        ) : (
          <button
            key={item}
            type="button"
            aria-label={`Page ${item}`}
            aria-current={item === page ? "page" : undefined}
            onClick={() => onPageChange(item)}
            className={cn(
              cell,
              item === page
                ? "border-clay-600 bg-clay-600 font-semibold text-on-clay"
                : "border-border bg-surface text-ink",
            )}
          >
            {item}
          </button>
        ),
      )}
      <button
        type="button"
        aria-label="Next page"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
        className={cn(cell, "border-border bg-surface text-ink-faint")}
      >
        &rarr;
      </button>
    </nav>
  );
}

export { Pagination };
export type { PaginationProps };
