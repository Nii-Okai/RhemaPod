"use client";

import * as React from "react";
import { cn } from "cn";

/* =============================================================================
   BarChart — hand-rolled SVG, zero-dependency (plan §A.7, decision C).

   One series of counts over time (Dashboard activity, Settings › Reports).
   The card chrome (title, eyebrow, border, padding) belongs to the caller;
   this primitive is the plot, a light y-axis and the label row.

   Reading the values:
     - a y-axis with three or four "nice" gridlines (0, 5, 10, …) and their
       numbers on the left, so a bar's size can be read without hovering;
     - the value printed above each bar while there is room for it (few,
       wide-enough bars), otherwise on hover only;
     - hover, touch or keyboard focus shows a tooltip with the bucket's full
       label (`tooltip`, e.g. "Wed 22 Oct") and its formatted value. The plot
       is one tab stop; ←/→ move between bars, Home/End jump to the ends.

   Size: `height` is the plot height in px, or `"fill"` to grow into the
   space its parent gives it (the parent must be a flex column that lets this
   flex-1). Fill is what keeps a chart card from leaving a block of empty
   space when it sits beside a taller card in the same grid row. Width and
   height are measured with a ResizeObserver so the SVG draws 1:1; until the
   first measurement (and in the DOM test env, which has none) it uses a
   fallback box with `preserveAspectRatio="none"`.

   Bars are one colour (a single series has nothing to encode by colour); the
   active bar darkens. Bars are capped at 56px wide and centred in their slot,
   so seven days across a wide card don't become slabs.

   Degrades per plan §W22:
     - n = 0 or an all-zero series -> muted empty state at the plot height,
       baseline kept, never a collapsed axis or a zero-height SVG.
     - one non-zero bucket among zeros -> that bar reaches the top gridline,
       the rest sit flat on the baseline, every label still shown.
   ========================================================================== */

export type BarChartDatum = {
  /** Short axis label, e.g. "22 Oct". Rendered verbatim under the bar; may be
      empty to leave a dense axis readable. Need not be unique. */
  label: string;
  /** Non-negative count for the bucket. Negatives are treated as 0. */
  value: number;
  /** Full label for the tooltip ("Wed 22 Oct"). Defaults to `label`. */
  tooltip?: string;
};

export type BarChartProps = {
  data: BarChartDatum[];
  /** Plot-area height in px (excludes the label row), or `"fill"`. Default 180. */
  height?: number | "fill";
  /** Smallest plot height in `"fill"` mode. Default 200. */
  minHeight?: number;
  /** Accessible name for the chart; also the SVG `<title>`. Required. */
  title: string;
  /** Shown when there is nothing to plot. */
  emptyLabel?: string;
  /** Formats a value for the tooltip and the bar labels. Default: `en-US` grouping. */
  formatValue?: (value: number) => string;
  /** Unit after the value in the tooltip: `"plays"`, or `["play", "plays"]`
      to get the singular for exactly 1. */
  unit?: string | readonly [string, string];
  className?: string;
};

const BAR_MAX_W = 56; // px — wider slots centre a capped bar
const BAR_FILL_RATIO = 0.7; // bar width as a share of its slot
const CAP_RADIUS = 4; // px top-corner radius
const MIN_BAR = 3; // px floor so a small non-zero bucket stays visible
const GUTTER = 34; // px for the y-axis numbers
const VALUE_LABEL_ROOM = 18; // px headroom for the numbers above bars
const VALUE_LABEL_MIN_BAR = 20; // px — narrower bars hover-only
const FALLBACK_WIDTH = 640;
const DEFAULT_HEIGHT = 180;

const defaultFormat = (value: number) => value.toLocaleString("en-US");

/** A "nice" axis for `max`: a round step (1, 2, 2.5 or 5 × 10ⁿ, whole
    numbers only) and the top tick at or above `max`. Exported for tests. */
export function niceAxis(max: number, targetTicks = 4): { step: number; top: number } {
  if (!(max > 0)) return { step: 1, top: 1 };
  const raw = max / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * magnitude);
  let step = candidates.find((c) => c >= raw) ?? 10 * magnitude;
  step = Math.max(1, Math.round(step * 100) / 100);
  if (!Number.isInteger(step)) step = Math.ceil(step);
  return { step, top: Math.ceil(max / step) * step };
}

function useMeasuredBox(fallback: { width: number; height: number }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState(fallback);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width <= 0) return;
      setBox((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, box] as const;
}

function barPath(x: number, barW: number, barH: number, floorY: number): string {
  const y = floorY - barH;
  const r = Math.min(CAP_RADIUS, barW / 2, barH);
  return [
    `M ${x} ${floorY}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + barW - r} ${y}`,
    `Q ${x + barW} ${y} ${x + barW} ${y + r}`,
    `L ${x + barW} ${floorY}`,
    "Z",
  ].join(" ");
}

export function BarChart({
  data,
  height = DEFAULT_HEIGHT,
  minHeight = 200,
  title,
  emptyLabel = "No data yet",
  formatValue = defaultFormat,
  unit,
  className,
}: BarChartProps) {
  const fill = height === "fill";
  const fixedHeight = fill ? minHeight : height;
  const [ref, box] = useMeasuredBox({ width: FALLBACK_WIDTH, height: fixedHeight });
  const [active, setActive] = React.useState<number | null>(null);

  const max = data.reduce((m, d) => Math.max(m, d.value), 0);
  const isEmpty = data.length === 0 || max <= 0;

  const plotHeight = fill ? Math.max(minHeight, box.height) : fixedHeight;
  const width = box.width;
  const n = data.length;
  const plotW = Math.max(0, width - GUTTER);
  const slotW = n > 0 ? plotW / n : 0;
  const barW = Math.min(BAR_MAX_W, slotW * BAR_FILL_RATIO);
  const showValues = n > 0 && n <= 16 && barW >= VALUE_LABEL_MIN_BAR;
  const topPad = showValues ? VALUE_LABEL_ROOM : 6;
  const baselineY = plotHeight - 0.5; // keep the 1px stroke inside the box
  const usable = Math.max(1, baselineY - topPad);
  const axis = niceAxis(max);
  const ticks: number[] = [];
  for (let t = 0; t <= axis.top; t += axis.step) ticks.push(t);

  const yOf = (value: number) => baselineY - (value / axis.top) * usable;
  const heightOf = (value: number) =>
    value <= 0 ? 0 : Math.max(MIN_BAR, (value / axis.top) * usable);

  const move = (event: React.KeyboardEvent) => {
    if (n === 0) return;
    const current = active ?? n - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = Math.min(n - 1, current + 1);
    else if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = n - 1;
    else if (event.key === "Escape") {
      setActive(null);
      return;
    }
    if (next !== null) {
      event.preventDefault();
      setActive(next);
    }
  };

  const activeDatum = active !== null ? data[active] : undefined;
  const activeValue = Math.max(0, activeDatum?.value ?? 0);
  const unitText =
    unit === undefined ? "" : typeof unit === "string" ? unit : unit[activeValue === 1 ? 0 : 1];
  // Labels on at most every third bar can spill over their empty neighbours.
  const labelled = data.filter((d) => d.label !== "").length;
  const sparseLabels = labelled > 0 && labelled * 3 <= data.length;

  const tooltipText = activeDatum
    ? `${activeDatum.tooltip ?? activeDatum.label}: ${formatValue(activeValue)}${unitText ? ` ${unitText}` : ""}`
    : "";

  return (
    <figure
      data-slot="bar-chart"
      className={cn("flex flex-col gap-8", fill && "min-h-0 flex-1", className)}
    >
      {isEmpty ? (
        <div
          role="img"
          aria-label={`${title}: ${emptyLabel}`}
          className={cn(
            "flex items-center justify-center border-b border-border text-body-sm text-ink-faint",
            fill && "flex-1",
          )}
          style={{ height: fill ? undefined : fixedHeight, minHeight: fill ? minHeight : undefined }}
        >
          {emptyLabel}
        </div>
      ) : (
        <>
          <div
            ref={ref}
            className={cn("relative", fill && "min-h-0 flex-1")}
            style={{ height: fill ? undefined : fixedHeight, minHeight: fill ? minHeight : undefined }}
            onPointerLeave={() => setActive(null)}
          >
            <svg
              width="100%"
              height={plotHeight}
              viewBox={`0 0 ${width} ${plotHeight}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={title}
              tabIndex={0}
              onKeyDown={move}
              onFocus={() => setActive((a) => a ?? n - 1)}
              onBlur={() => setActive(null)}
              className="block overflow-visible rounded-6 outline-none focus-visible:focus-ring-button"
            >
              <title>{title}</title>

              {ticks.map((t) => {
                const y = Math.round(yOf(t)) + 0.5;
                return (
                  <g key={t} data-slot="bar-chart-tick">
                    {t > 0 ? (
                      <line
                        x1={GUTTER}
                        x2={width}
                        y1={y}
                        y2={y}
                        stroke="var(--color-border-subtle)"
                        strokeWidth={1}
                        strokeDasharray="3 4"
                      />
                    ) : null}
                    <text
                      x={GUTTER - 8}
                      y={t === 0 ? baselineY : y}
                      dy="0.32em"
                      textAnchor="end"
                      className="fill-ink-faint font-mono text-[10.5px] tabular-nums"
                    >
                      {formatValue(t)}
                    </text>
                  </g>
                );
              })}

              {data.map((d, i) => {
                const value = Math.max(0, d.value);
                const barH = heightOf(value);
                const slotX = GUTTER + i * slotW;
                const x = slotX + (slotW - barW) / 2;
                const isActive = active === i;
                return (
                  <g key={i}>
                    <path
                      // Index, not label: labels may repeat ("Oct" in two years)
                      // or be blank when a caller thins a dense axis.
                      data-slot="bar-chart-bar"
                      data-value={value}
                      data-height={barH}
                      d={barH > 0 ? barPath(x, barW, barH, baselineY) : ""}
                      fill={
                        isActive
                          ? "var(--color-clay-700)"
                          : active === null
                            ? "var(--color-clay-600)"
                            : "var(--color-clay-400)"
                      }
                      style={{ transition: "fill 120ms ease-out" }}
                    />
                    {showValues && value > 0 ? (
                      <text
                        data-slot="bar-chart-value"
                        x={slotX + slotW / 2}
                        y={baselineY - barH - 6}
                        textAnchor="middle"
                        className={cn(
                          "font-mono text-[10.5px] tabular-nums",
                          isActive ? "fill-ink" : "fill-ink-muted",
                        )}
                      >
                        {formatValue(value)}
                      </text>
                    ) : null}
                    {/* Full-height hit area, so short bars are easy to hover. */}
                    <rect
                      data-slot="bar-chart-hit"
                      x={slotX}
                      y={0}
                      width={slotW}
                      height={plotHeight}
                      fill="transparent"
                      onPointerEnter={() => setActive(i)}
                      onPointerDown={() => setActive(i)}
                    />
                  </g>
                );
              })}

              <line
                x1={GUTTER}
                y1={baselineY}
                x2={width}
                y2={baselineY}
                stroke="var(--color-border)"
                strokeWidth={1}
              />
            </svg>

            {activeDatum ? (
              <div
                data-slot="bar-chart-tooltip"
                role="status"
                className="pointer-events-none absolute z-10 whitespace-nowrap rounded-8 bg-dark px-8 py-4 text-[12px] font-medium text-white shadow-toast"
                style={{
                  left: Math.min(
                    Math.max(GUTTER + (active! + 0.5) * slotW, 60),
                    Math.max(60, width - 60),
                  ),
                  top: Math.max(0, yOf(Math.max(0, activeDatum.value)) - 8),
                  transform: "translate(-50%, -100%)",
                }}
              >
                {tooltipText}
              </div>
            ) : null}
          </div>
          <div
            className="flex font-mono text-[10.5px] text-ink-faint"
            style={{ paddingLeft: GUTTER }}
            aria-hidden="true"
          >
            {data.map((d, i) =>
              sparseLabels ? (
                // Only every few bars is labelled (e.g. once a week), so a label
                // may spill into its empty neighbours instead of truncating.
                <span key={i} className="relative h-[14px] min-w-0 flex-1">
                  <span
                    data-slot="bar-chart-label"
                    className={cn(
                      "absolute left-1/2 -translate-x-1/2 whitespace-nowrap",
                      active === i && "text-ink",
                    )}
                  >
                    {d.label}
                  </span>
                </span>
              ) : (
                <span
                  key={i}
                  data-slot="bar-chart-label"
                  className={cn(
                    "min-w-0 flex-1 truncate text-center",
                    active === i && "text-ink",
                  )}
                >
                  {d.label}
                </span>
              ),
            )}
          </div>
        </>
      )}
    </figure>
  );
}
