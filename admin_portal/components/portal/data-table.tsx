"use client";

import * as React from "react";
import { cn } from "cn";

import { Checkbox } from "@/components/ui/checkbox";
import { Pagination } from "@/components/portal/pagination";
import { DataTableSkeleton } from "@/components/portal/data-table-skeleton";
import {
  useRowSelection,
  type UseRowSelectionOptions,
} from "@/lib/portal/use-row-selection";

/* =============================================================================
   DataTable<Row> — RhemaPod portal primitive (W6). Hand-built.

   The design mandates CSS-GRID ROWS, not `<table>`, for exact column control
   (README §"DataTable" / Screen 3, plan §A.6). A grid of divs forfeits every
   free table semantic, so this component re-supplies them: `role="grid"` /
   `role="row"` / `role="columnheader"` / `role="gridcell"`, `aria-selected`,
   `aria-rowcount` / `aria-colcount`, and a keyboard model over the rows.

   --- a11y model (the D6 "a11y vs the CSS-grid mandate" call) --------------
   Rows are the focusable unit, with a roving tabindex: exactly one row is in
   the tab order at a time; Arrow Up/Down + Home/End move focus between rows;
   Space toggles selection of the focused row; Shift+Space range-selects from
   the anchor; Enter activates `onRowClick`. This is the ARIA "grid with
   row-level navigation" pattern — appropriate here because cells are
   display-only (no editable cells). Full cell-by-cell arrow navigation buys
   nothing for a read-only grid and costs the user dozens of extra keystrokes.
   Controls *inside* the `rowActions` slot (the `···` menu, wired in W7 with a
   Radix DropdownMenu) own their own focus semantics; the primitive only
   renders the slot and stops event propagation so a menu click never triggers
   the row.

   The per-row checkbox is pointer-operable but `tabIndex={-1}` — keyboard
   selection is Space on the focused row, and the row's `aria-selected` already
   announces the state. The header select-all IS a real tab stop.

   --- selection ----------------------------------------------------------
   Opt-in via `selectable`. Controlled (`selectedKeys` + `onSelectionChange`)
   or uncontrolled (`defaultSelectedKeys`). All the range/anchor/all logic is
   pure and unit-tested in `lib/portal/use-row-selection.ts`.

   When `selected.size > 0` the 38px column header is replaced (not overlaid —
   no row shifting) by the 44px clay bulk bar: `${n} selected` + a `bulkActions`
   slot.
   ========================================================================== */

export type DataTableColumnAlign = "start" | "center" | "end";

export interface DataTableColumn<Row> {
  /** Stable identity for the column (React key + debugging). */
  key: string;
  /** Header label — usually plain text rendered in the mono-eyebrow style. */
  header: React.ReactNode;
  /** A single CSS grid track: `"2.4fr"`, `"1.1fr"`, `"84px"`, … */
  gridWidth: string;
  /** Cell renderer for a row. */
  cell: (row: Row) => React.ReactNode;
  /** Horizontal alignment of the cell content. Default `"start"`. */
  align?: DataTableColumnAlign;
}

export interface DataTableProps<Row> {
  columns: ReadonlyArray<DataTableColumn<Row>>;
  rows: ReadonlyArray<Row>;
  /** Stable string key per row — selection and React keys ride on this. */
  rowKey: (row: Row) => string;

  /** Turn on the checkbox column + bulk bar. */
  selectable?: boolean;
  /** Controlled selection (a Set of row keys). Memoize it. */
  selectedKeys?: ReadonlySet<string>;
  /** Initial selection when uncontrolled. */
  defaultSelectedKeys?: ReadonlySet<string>;
  /** Fired with the next selection on every change. */
  onSelectionChange?: (next: Set<string>) => void;
  /** Actions rendered on the right of the clay bulk bar. */
  bulkActions?: React.ReactNode;
  /** Left-hand label in the bulk bar. Default: `` `${n} selected` ``. */
  bulkLabel?: (count: number) => React.ReactNode;

  /** Row click (title/body). Not fired for clicks on the checkbox or actions. */
  onRowClick?: (row: Row) => void;
  /** Trailing 40px cell — the `···` row menu. */
  rowActions?: (row: Row) => React.ReactNode;

  /** Footer left text, e.g. "1–6 of 128". */
  rangeLabel?: React.ReactNode;
  /** Footer pagination — all three required for it to render. */
  page?: number;
  pageCount?: number;
  onPageChange?: (page: number) => void;

  /** Swap the body for exact-geometry skeleton rows. */
  loading?: boolean;
  /** Skeleton row count. Default 8. */
  skeletonRows?: number;
  /** Rendered when there are no rows and not loading. */
  empty?: React.ReactNode;

  /** Accessible name for the grid (required). */
  caption: string;
  /** Min width (px) of the scrolling content — engages horizontal scroll. */
  minWidth?: number;
  className?: string;
}

/* --- pure helpers (unit-tested without a DOM) ----------------------------- */

/**
 * Compose the `grid-template-columns` string: an optional leading 44px
 * checkbox track, the column `gridWidth` tracks, and an optional trailing 40px
 * actions track. With both flags on: `44px <widths…> 40px`.
 */
export function gridTemplateColumns(
  columnWidths: readonly string[],
  options: { selectable?: boolean; rowActions?: boolean } = {},
): string {
  const tracks: string[] = [];
  if (options.selectable) tracks.push("44px");
  tracks.push(...columnWidths);
  if (options.rowActions) tracks.push("40px");
  return tracks.join(" ");
}

/** Whether the top row shows column headers or the clay bulk bar. */
export function headerMode(opts: {
  selectable?: boolean;
  selectedCount: number;
}): "bulk" | "columns" {
  return opts.selectable && opts.selectedCount > 0 ? "bulk" : "columns";
}

/** Which footer pieces render, given the forwarded props. */
export function footerModel(props: {
  rangeLabel?: React.ReactNode;
  page?: number;
  pageCount?: number;
  onPageChange?: (page: number) => void;
}): { footer: boolean; pagination: boolean } {
  const pagination =
    props.page != null &&
    props.pageCount != null &&
    typeof props.onPageChange === "function";
  const footer = pagination || props.rangeLabel != null;
  return { footer, pagination };
}

/** Total grid columns including the checkbox / actions tracks. */
export function ariaColCount(opts: {
  columnCount: number;
  selectable?: boolean;
  rowActions?: boolean;
}): number {
  return (
    opts.columnCount + (opts.selectable ? 1 : 0) + (opts.rowActions ? 1 : 0)
  );
}

const ALIGN_CLASS: Record<DataTableColumnAlign, string> = {
  start: "justify-start text-left",
  center: "justify-center text-center",
  end: "justify-end text-right",
};

/* --- component --------------------------------------------------------- */

function DataTable<Row>(props: DataTableProps<Row>) {
  const {
    columns,
    rows,
    rowKey,
    selectable = false,
    selectedKeys,
    defaultSelectedKeys,
    onSelectionChange,
    bulkActions,
    bulkLabel = (n: number) => `${n} selected`,
    onRowClick,
    rowActions,
    rangeLabel,
    page,
    pageCount,
    onPageChange,
    loading = false,
    skeletonRows = 8,
    empty,
    caption,
    minWidth,
    className,
  } = props;

  const orderedKeys = React.useMemo(
    () => rows.map(rowKey),
    [rows, rowKey],
  );

  const selectionOptions: UseRowSelectionOptions = {
    orderedKeys,
    selectedKeys,
    defaultSelectedKeys,
    onSelectionChange,
  };
  const selection = useRowSelection(selectionOptions);

  const hasRowActions = typeof rowActions === "function";
  const template = React.useMemo(
    () =>
      gridTemplateColumns(
        columns.map((c) => c.gridWidth),
        { selectable, rowActions: hasRowActions },
      ),
    [columns, selectable, hasRowActions],
  );

  const mode = headerMode({
    selectable,
    selectedCount: selection.selected.size,
  });
  const { footer: showFooter, pagination: showPagination } = footerModel({
    rangeLabel,
    page,
    pageCount,
    onPageChange,
  });

  const colCount = ariaColCount({
    columnCount: columns.length,
    selectable,
    rowActions: hasRowActions,
  });

  const interactive = selectable || typeof onRowClick === "function";

  const [activeIndex, setActiveIndex] = React.useState(0);
  const active = rows.length > 0 ? Math.min(activeIndex, rows.length - 1) : 0;
  const rowRefs = React.useRef<Array<HTMLDivElement | null>>([]);
  const focusRow = React.useCallback((i: number) => {
    setActiveIndex(i);
    rowRefs.current[i]?.focus();
  }, []);

  const setSelectAllRef = React.useCallback(
    (el: HTMLInputElement | null) => {
      if (el) el.indeterminate = selection.indeterminate;
    },
    [selection.indeterminate],
  );

  const rowStyle = { gridTemplateColumns: template } as React.CSSProperties;

  function renderCells(row: Row, key: string) {
    let colIndex = 0;
    const cells: React.ReactNode[] = [];

    if (selectable) {
      colIndex += 1;
      cells.push(
        <div
          key="__select"
          role="gridcell"
          aria-colindex={colIndex}
          className="flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            tabIndex={-1}
            checked={selection.isSelected(key)}
            onChange={() => selection.toggle(key)}
            aria-label="Select row"
          />
        </div>,
      );
    }

    for (const col of columns) {
      colIndex += 1;
      cells.push(
        <div
          key={col.key}
          role="gridcell"
          aria-colindex={colIndex}
          className={cn(
            "flex min-w-0 items-center",
            ALIGN_CLASS[col.align ?? "start"],
          )}
        >
          {col.cell(row)}
        </div>,
      );
    }

    if (hasRowActions) {
      colIndex += 1;
      cells.push(
        <div
          key="__actions"
          role="gridcell"
          aria-colindex={colIndex}
          className="flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {rowActions!(row)}
        </div>,
      );
    }

    return cells;
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-16 border border-border bg-surface",
        className,
      )}
    >
      <div className="overflow-x-auto">
        <div style={minWidth ? { minWidth } : undefined}>
          {/* --- bulk bar (replaces the header while rows are selected) --- */}
          {mode === "bulk" ? (
            <div
              role="toolbar"
              aria-label="Bulk actions"
              className="sticky top-0 z-10 flex h-[44px] items-center gap-12 border-b border-clay-100 bg-clay-50 px-20"
            >
              <Checkbox
                ref={setSelectAllRef}
                checked={selection.allSelected}
                onChange={selection.toggleAll}
                aria-label="Select all rows"
              />
              <span className="text-[13px] font-semibold text-clay-700">
                {bulkLabel(selection.selected.size)}
              </span>
              <span className="flex-1" />
              {bulkActions ? (
                <div className="flex items-center gap-8">{bulkActions}</div>
              ) : null}
            </div>
          ) : null}

          <div
            role="grid"
            aria-label={caption}
            aria-rowcount={rows.length + (mode === "bulk" ? 0 : 1)}
            aria-colcount={colCount}
            aria-multiselectable={selectable || undefined}
            aria-busy={loading || undefined}
          >
            {/* --- column header --- */}
            {mode === "columns" ? (
              <div
                role="row"
                aria-rowindex={1}
                style={rowStyle}
                className="sticky top-0 z-10 grid h-[38px] items-center gap-12 border-b border-border-subtle bg-surface-sunken px-20"
              >
                {selectable ? (
                  <div
                    role="columnheader"
                    aria-colindex={1}
                    className="flex items-center justify-center"
                  >
                    <Checkbox
                      ref={setSelectAllRef}
                      checked={selection.allSelected}
                      onChange={selection.toggleAll}
                      aria-label="Select all rows"
                      disabled={rows.length === 0}
                    />
                  </div>
                ) : null}
                {columns.map((col, i) => (
                  <div
                    key={col.key}
                    role="columnheader"
                    aria-colindex={(selectable ? 2 : 1) + i}
                    className={cn(
                      "text-mono-eyebrow flex min-w-0 items-center text-ink-faint",
                      ALIGN_CLASS[col.align ?? "start"],
                    )}
                  >
                    {col.header}
                  </div>
                ))}
                {hasRowActions ? (
                  <div
                    role="columnheader"
                    aria-colindex={colCount}
                    aria-label="Row actions"
                  />
                ) : null}
              </div>
            ) : null}

            {/* --- body --- */}
            {loading ? (
              <DataTableSkeleton
                gridTemplate={template}
                columnCount={columns.length}
                selectable={selectable}
                rowActions={hasRowActions}
                rows={skeletonRows}
              />
            ) : rows.length === 0 ? (
              <div role="row" aria-rowindex={2}>
                <div role="gridcell" aria-colindex={1} className="px-20 py-14">
                  {empty ?? null}
                </div>
              </div>
            ) : (
              rows.map((row, i) => {
                const key = rowKey(row);
                const selected = selection.isSelected(key);
                return (
                  <div
                    key={key}
                    ref={(el) => {
                      rowRefs.current[i] = el;
                    }}
                    role="row"
                    aria-rowindex={i + (mode === "bulk" ? 1 : 2)}
                    aria-selected={selectable ? selected : undefined}
                    tabIndex={
                      interactive ? (i === active ? 0 : -1) : undefined
                    }
                    style={rowStyle}
                    onClick={(e) => {
                      setActiveIndex(i);
                      if (selectable && e.shiftKey) {
                        e.preventDefault();
                        selection.selectRange(key);
                        return;
                      }
                      onRowClick?.(row);
                    }}
                    onKeyDown={(e) => {
                      switch (e.key) {
                        case "ArrowDown":
                          e.preventDefault();
                          focusRow(Math.min(i + 1, rows.length - 1));
                          break;
                        case "ArrowUp":
                          e.preventDefault();
                          focusRow(Math.max(i - 1, 0));
                          break;
                        case "Home":
                          e.preventDefault();
                          focusRow(0);
                          break;
                        case "End":
                          e.preventDefault();
                          focusRow(rows.length - 1);
                          break;
                        case " ":
                          if (selectable) {
                            e.preventDefault();
                            if (e.shiftKey) selection.selectRange(key);
                            else selection.toggle(key);
                          }
                          break;
                        case "Enter":
                          if (onRowClick) {
                            e.preventDefault();
                            onRowClick(row);
                          }
                          break;
                        default:
                          break;
                      }
                    }}
                    className={cn(
                      "grid h-[60px] items-center gap-12 border-b border-border-subtle px-20 outline-none transition-colors duration-[140ms] ease-out last:border-b-0 focus-visible:focus-ring-button",
                      selected ? "bg-clay-50" : "hover:bg-surface-sunken",
                      onRowClick ? "cursor-pointer" : undefined,
                    )}
                  >
                    {renderCells(row, key)}
                  </div>
                );
              })
            )}
          </div>

          {/* --- footer --- */}
          {showFooter ? (
            <div className="flex h-[58px] items-center justify-between gap-12 border-t border-border-subtle bg-surface-sunken px-20">
              <span className="text-mono-meta text-ink-faint">
                {rangeLabel}
              </span>
              {showPagination ? (
                <Pagination
                  page={page!}
                  pageCount={pageCount!}
                  onPageChange={onPageChange!}
                />
              ) : (
                <span />
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export { DataTable };
