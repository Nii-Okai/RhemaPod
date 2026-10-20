"use client";

import * as React from "react";
import { cn } from "cn";

/* =============================================================================
   BarChart — hand-rolled SVG, zero-dependency (plan §A.7, decision C).

   Draws the Dashboard "New listeners per week" chart (design: "Plays per week",
   `docs/design_admin_portal/RhemaPod Admin Portal.dc.html`). The card chrome
   (title, "last 8 weeks" eyebrow, border, padding) belongs to W23 — this
   primitive is the plot area + the week-label row only.

   Geometry transcribed from the mock:
     - plot height 150px, bars gap 10px, `border-radius: 5px 5px 0 0`
     - baseline: 1px --color-border rule under the bars
     - fill ramps by height band — low buckets --color-clay-100, mid
       --color-clay-400 ("chart mid series" in the token table), tallest
       --color-clay-600. Thresholds 0.55 / 0.75 of max reproduce the mock's
       eight bars (0.41–0.54 light · 0.59–0.66 mid · 0.78–1.0 primary).
     - labels: IBM Plex Mono 10.5px, --color-ink-faint, one per bar, centred.

   Width is measured (ResizeObserver) so the SVG renders 1:1 with no corner
   distortion; `preserveAspectRatio="none"` keeps the bars filling the width
   (and the Y axis exact) for the frame before the measurement lands and in
   the DOM test env where ResizeObserver is absent.

   Degrades per plan §W22:
     - n = 0 or an all-zero series  -> muted empty state, baseline kept, never
       a collapsed axis or a zero-height SVG.
     - n = 1 (one non-zero among zeros) -> that bar at full height, the rest
       flat on the baseline, all labels still shown.
   ========================================================================== */

export type BarChartDatum = {
  /** Short axis label, e.g. "W28". Rendered verbatim under the bar; may be
      empty to leave a dense axis readable. Need not be unique. */
  label: string;
  /** Non-negative count for the bucket. Negatives are treated as 0. */
  value: number;
};

export type BarChartProps = {
  data: BarChartDatum[];
  /** Plot-area height in px (excludes the label row). Design: 150. */
  height?: number;
  /** Accessible name for the chart; also the SVG `<title>`. Required. */
  title: string;
  /** Shown when there is nothing to plot. Design has no bespoke state. */
  emptyLabel?: string;
  className?: string;
};

const GAP = 10; // px between bars (design)
const CAP_RADIUS = 5; // px top-corner radius (design `5px 5px 0 0`)
const MIN_BAR = 3; // px floor so a small non-zero bucket stays visible
const FALLBACK_WIDTH = 640; // used until ResizeObserver reports, and in tests

function barFill(fraction: number): string {
  if (fraction >= 0.75) return "var(--color-clay-600)";
  if (fraction >= 0.55) return "var(--color-clay-400)";
  return "var(--color-clay-100)";
}

function useMeasuredWidth(fallback: number) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(fallback);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      if (measured > 0) setWidth(measured);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
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
  height = 150,
  title,
  emptyLabel = "No data yet",
  className,
}: BarChartProps) {
  const [ref, width] = useMeasuredWidth(FALLBACK_WIDTH);

  const max = data.reduce((m, d) => Math.max(m, d.value), 0);
  const isEmpty = data.length === 0 || max <= 0;

  const n = data.length;
  const barW = n > 0 ? Math.max(0, (width - GAP * (n - 1)) / n) : 0;
  const baselineY = height - 0.5; // keep the 1px stroke inside the viewport

  return (
    <figure data-slot="bar-chart" className={cn("flex flex-col gap-8", className)}>
      {isEmpty ? (
        <div
          role="img"
          aria-label={`${title}: ${emptyLabel}`}
          className="flex items-center justify-center border-b border-border text-body-sm text-ink-faint"
          style={{ height }}
        >
          {emptyLabel}
        </div>
      ) : (
        <>
          <div ref={ref}>
            <svg
              width="100%"
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={title}
            >
              <title>{title}</title>
              {data.map((d, i) => {
                const value = Math.max(0, d.value);
                const barH = value <= 0 ? 0 : Math.max(MIN_BAR, (value / max) * height);
                const x = i * (barW + GAP);
                return (
                  <path
                    // Index, not label: labels may repeat ("Oct" in two years)
                    // or be blank when a caller thins a dense axis.
                    key={i}
                    data-slot="bar-chart-bar"
                    data-value={value}
                    data-height={barH}
                    d={barH > 0 ? barPath(x, barW, barH, baselineY) : ""}
                    fill={barFill(value / max)}
                  />
                );
              })}
              <line
                x1={0}
                y1={baselineY}
                x2={width}
                y2={baselineY}
                stroke="var(--color-border)"
                strokeWidth={1}
              />
            </svg>
          </div>
          <div className="flex gap-[10px] font-mono text-[10.5px] text-ink-faint">
            {data.map((d, i) => (
              <span
                key={i}
                data-slot="bar-chart-label"
                className="min-w-0 flex-1 text-center"
              >
                {d.label}
              </span>
            ))}
          </div>
        </>
      )}
    </figure>
  );
}
