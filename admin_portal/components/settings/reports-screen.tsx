"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "cn";

import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedControl, StatCard } from "@/components/portal";
import { BarChart } from "@/components/charts/BarChart";
import { RankedBarList } from "@/components/charts/RankedBarList";
import {
  REPORT_PRESETS,
  presetRange,
  reportExportHref,
  toGranularity,
  toPreset,
  useUsageReport,
  type Granularity,
  type ReportPreset,
  type UsageReport,
} from "@/lib/query/hooks/use-usage-report";

/* =============================================================================
   ReportsScreen — Settings › Reports (plan-admin-settings S17, ADR 0019).

   Preset period (last 7 / 30 / 90 days, last 12 months, all ending today in
   UTC) and a granularity control; six KPI tiles; one bar chart whose measure
   can be switched; top sermons. URL is the state (`?range=` / `?by=` /
   `?measure=`).

   "Data available from": plays, completions and watch time are forward-only
   (ADR 0019) — they exist only from the day the rollups started. When the
   period starts earlier, a notice says so, so a run of zero bars isn't read
   as "nobody listened". New listeners and signups are accurate for any
   period and the notice says that too.

   Export (CSV, built by the server) is rendered only when `canExport` — the
   page passes it from the server-resolved role (admins only, D1). FastAPI's
   AdminOnly guard is the real enforcement.
   ========================================================================== */

const GRANULARITY_OPTIONS: ReadonlyArray<{ value: Granularity; label: string }> = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
];

const MEASURES = [
  { value: "plays", label: "Plays" },
  { value: "listeners", label: "Listeners" },
  { value: "new_listeners", label: "New listeners" },
  { value: "signups", label: "Signups" },
] as const;
type Measure = (typeof MEASURES)[number]["value"];

function toMeasure(raw: string | null): Measure {
  return MEASURES.some((m) => m.value === raw) ? (raw as Measure) : "plays";
}

const SHORT_MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const LONG_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function utc(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

// Most axis labels that fit side by side before they collide (narrow cards
// included); denser series label every k-th bucket.
const MAX_AXIS_LABELS = 8;

function bucketLabel(start: string, granularity: Granularity): string {
  const d = utc(start);
  if (granularity === "month") {
    return `${SHORT_MONTH.format(d)} ’${String(d.getUTCFullYear()).slice(2)}`;
  }
  return DAY_MONTH.format(d);
}

/** Exported for tests: axis labels for a series, every k-th one kept. */
export function axisLabels(starts: string[], granularity: Granularity): string[] {
  const step = Math.max(1, Math.ceil(starts.length / MAX_AXIS_LABELS));
  return starts.map((start, i) => (i % step === 0 ? bucketLabel(start, granularity) : ""));
}

const n = (value: number) => value.toLocaleString("en-US");

/** Exported for tests: the notice text, or `null` when the rollups cover the
    whole period. */
export function dataAvailabilityNotice(report: UsageReport): string | null {
  const since = report.data_available_from;
  if (since === null || since === undefined) {
    return "No listening has been recorded yet, so plays, completions and watch time show zero. New listeners and signups are counted from all history.";
  }
  if (since > report.period.from) {
    return `Plays, completions and watch time are recorded from ${LONG_DATE.format(utc(since))}. Earlier days in this period show zero for those; new listeners and signups are counted from all history.`;
  }
  return null;
}

export function ReportsScreen({ canExport }: { canExport: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const preset = toPreset(searchParams.get("range"));
  const granularity = toGranularity(searchParams.get("by"), preset);
  const measure = toMeasure(searchParams.get("measure"));

  // Recomputed per render; stable within a UTC day, which is all the key needs.
  const { from, to } = presetRange(preset);
  const params = { from, to, granularity };
  const report = useUsageReport(params);

  const push = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) next.delete(k);
      else next.set(k, v);
    }
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const data = report.data;
  const notice = data ? dataAvailabilityNotice(data) : null;
  const tiles = [
    { label: "Plays", value: data ? n(data.kpis.plays) : "—" },
    { label: "Completions", value: data ? n(data.kpis.completions) : "—" },
    { label: "Watch hours", value: data ? data.kpis.watch_hours.toLocaleString("en-US") : "—" },
    { label: "Listeners", value: data ? n(data.kpis.listeners) : "—" },
    { label: "New listeners", value: data ? n(data.kpis.new_listeners) : "—" },
    { label: "Signups", value: data ? n(data.kpis.signups) : "—" },
  ];
  const series = data?.series ?? [];
  const labels = axisLabels(series.map((b) => b.start), granularity);
  const chartData = series.map((b, i) => ({ label: labels[i], value: b[measure] }));
  const measureLabel = MEASURES.find((m) => m.value === measure)!.label;

  return (
    <div className="flex flex-col gap-16">
      <div className="flex flex-wrap items-center gap-10" data-slot="reports-controls">
        <SegmentedControl<ReportPreset>
          aria-label="Period"
          options={REPORT_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
          value={preset}
          onValueChange={(value) => push({ range: value, by: undefined })}
        />
        <SegmentedControl<Granularity>
          aria-label="Group by"
          options={GRANULARITY_OPTIONS}
          value={granularity}
          onValueChange={(value) => push({ by: value })}
        />
        <span className="flex-1" />
        {canExport ? (
          <div className="flex items-center gap-8" data-slot="report-export">
            <a
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              href={reportExportHref(params, "timeseries")}
              download
            >
              Download CSV
            </a>
            <a
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
              href={reportExportHref(params, "top_sermons")}
              download
            >
              Top sermons CSV
            </a>
          </div>
        ) : null}
      </div>

      {report.isError ? (
        <Alert variant="error" title="Couldn’t load the report">
          {report.error instanceof Error ? report.error.message : "Please try again."}
        </Alert>
      ) : null}
      {notice ? (
        <Alert variant="warning" title="Data available from" data-slot="data-available-notice">
          {notice}
        </Alert>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-14">
        {tiles.map((tile) => (
          <StatCard key={tile.label} label={tile.label} value={tile.value} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-16 min-[1100px]:grid-cols-[1.5fr_1fr]">
        <Card className="flex min-w-0 flex-col gap-16">
          <div className="flex flex-wrap items-center justify-between gap-12">
            <span className="text-[15px] font-semibold text-ink">{measureLabel}</span>
            <SegmentedControl<Measure>
              aria-label="Measure"
              options={MEASURES}
              value={measure}
              onValueChange={(value) => push({ measure: value === "plays" ? undefined : value })}
            />
          </div>
          <BarChart
            title={`${measureLabel} per ${granularity}`}
            data={chartData}
            emptyLabel={report.isPending ? "Loading…" : "Nothing in this period"}
          />
        </Card>
        <Card className="flex min-w-0 flex-col gap-16">
          <span className="text-[15px] font-semibold text-ink">Top sermons</span>
          <RankedBarList
            items={(data?.top_sermons ?? []).map((t) => ({ label: t.title, value: t.plays }))}
            formatValue={(v) => `${n(v)} plays`}
            emptyLabel={report.isPending ? "Loading…" : "No plays in this period"}
          />
        </Card>
      </div>
    </div>
  );
}
