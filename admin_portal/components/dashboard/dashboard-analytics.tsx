"use client";

import * as React from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { SegmentedControl, StatCard } from "@/components/portal";
import { BarChart } from "@/components/charts/BarChart";
import { RankedBarList } from "@/components/charts/RankedBarList";
import { bucketTooltip, dataAvailabilityNotice } from "@/components/settings/reports-screen";
import {
  DASHBOARD_DAYS,
  dashboardRanges,
  periodChange,
  rollupsCover,
} from "@/lib/dashboard/metrics";
import { useOverview, useSermonStatusCounts } from "@/lib/query/hooks/use-dashboard";
import { useUsageReport } from "@/lib/query/hooks/use-usage-report";

import { ContentPipelineCard } from "./content-pipeline-card";

/* =============================================================================
   DashboardAnalytics — the manager/admin Dashboard.

   Mounted only in the manager/admin branch of the Server Component, so an
   editor never fetches `/admin/analytics/*`.

   Sources, and why they agree with Settings › Reports:
     - the last 30 days (tiles, activity chart, top sermons) come from
       `GET /admin/analytics/report`, the same endpoint and the same period
       arithmetic the Reports screen uses;
     - the change line compares against the 30 days before, also from the
       report. Plays, listeners and watch time only compare when the daily
       rollups cover that earlier window (otherwise its zeros mean "not
       recorded yet", and a "+100%" would be made up);
     - "Paid members" and "All time" come from `GET /admin/analytics/overview`,
       counted live from the full tables;
     - "Awaiting review" and the pipeline come from `GET /sermons/status-counts`.
   Everything refreshes every minute and when the tab regains focus.
   ========================================================================== */

const MEASURES = [
  { value: "plays", label: "Plays", unit: ["play", "plays"] },
  { value: "listeners", label: "Listeners", unit: ["listener", "listeners"] },
  { value: "new_listeners", label: "New listeners", unit: ["new listener", "new listeners"] },
  { value: "signups", label: "Signups", unit: ["signup", "signups"] },
] as const;
type Measure = (typeof MEASURES)[number]["value"];

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const n = (value: number) => value.toLocaleString("en-US");
const dash = "—";

/** Axis labels for the 30-day chart: the first of each week, so the row stays
    readable; the tooltip has the full date. */
function axisLabel(start: string, index: number): string {
  return index % 7 === 0 ? DAY_MONTH.format(new Date(`${start}T00:00:00Z`)) : "";
}

export function DashboardAnalytics() {
  // Fixed for the life of the screen; a reload picks up a new day.
  const ranges = React.useMemo(() => dashboardRanges(), []);
  const report = useUsageReport({ ...ranges.current, granularity: "day" });
  const previous = useUsageReport({ ...ranges.previous, granularity: "month" });
  const overview = useOverview();
  const statusCounts = useSermonStatusCounts();
  const [measure, setMeasure] = React.useState<Measure>("plays");

  const cur = report.data?.kpis;
  const prev = previous.data?.kpis;
  const prevCovered = rollupsCover(previous.data);
  const change = (key: keyof NonNullable<typeof cur>, rollup: boolean) =>
    cur && prev ? periodChange(cur[key], prev[key], { rollupCovered: !rollup || prevCovered }) : undefined;

  const awaiting = statusCounts.data
    ? statusCounts.data.pending_review + statusCounts.data.under_review
    : undefined;

  const tiles = [
    { key: "listeners", label: "Listeners", value: cur ? n(cur.listeners) : dash, delta: change("listeners", true) },
    { key: "plays", label: "Plays", value: cur ? n(cur.plays) : dash, delta: change("plays", true) },
    {
      key: "watch-hours",
      label: "Watch hours",
      value: cur ? cur.watch_hours.toLocaleString("en-US") : dash,
      delta: change("watch_hours", true),
    },
    { key: "new-members", label: "New members", value: cur ? n(cur.signups) : dash, delta: change("signups", false) },
    {
      key: "paid-members",
      label: "Paid members",
      value: overview.data ? n(overview.data.active_subscribers) : dash,
      delta: overview.data ? { direction: "neutral" as const, text: "Right now" } : undefined,
    },
    {
      key: "awaiting-review",
      label: "Awaiting review",
      value: awaiting !== undefined ? n(awaiting) : dash,
      delta: awaiting !== undefined ? { direction: "neutral" as const, text: "Sermons submitted" } : undefined,
    },
  ];

  const series = report.data?.series ?? [];
  const active = MEASURES.find((m) => m.value === measure)!;
  const chartData = series.map((b, i) => ({
    label: axisLabel(b.start, i),
    value: b[measure],
    tooltip: bucketTooltip(b.start, b.end, "day"),
  }));
  const notice =
    report.data && (measure === "plays" || measure === "listeners")
      ? dataAvailabilityNotice(report.data)
      : null;

  const all = overview.data;
  const allTime: Array<[string, string]> = all
    ? [
        ["Plays", n(all.total_plays)],
        ["Listeners", n(all.unique_viewers)],
        ["Completion rate", `${Math.round(all.completion_rate * 100)}%`],
        ["Watch hours", all.watch_hours.toLocaleString("en-US")],
        ["Members", `${n(all.active_members)} active of ${n(all.members)}`],
        ["Published sermons", n(all.published_sermons)],
      ]
    : [];

  return (
    <div className="flex flex-col gap-20" data-slot="dashboard-analytics">
      {report.isError || overview.isError ? (
        <Alert variant="error" title="Couldn’t load some of the numbers">
          They retry every minute. Anything that couldn’t load shows a dash.
        </Alert>
      ) : null}

      <div className="flex flex-col gap-8">
        <span className="text-mono-eyebrow text-ink-faint">Last {DASHBOARD_DAYS} days</span>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-14">
          {tiles.map((tile) => (
            <StatCard
              key={tile.key}
              label={tile.label}
              value={tile.value}
              delta={tile.delta}
              data-testid={`stat-tile-${tile.key}`}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-16 min-[1100px]:grid-cols-[1.6fr_1fr]">
        <Card className="flex min-w-0 flex-col gap-14" data-slot="activity-card">
          <div className="flex flex-wrap items-center justify-between gap-12">
            <div className="flex flex-col">
              <span className="text-[15px] font-semibold text-ink">Listening activity</span>
              <span className="font-mono text-[11px] text-ink-faint">per day, last {DASHBOARD_DAYS} days</span>
            </div>
            <SegmentedControl<Measure>
              aria-label="Measure"
              options={MEASURES.map((m) => ({ value: m.value, label: m.label }))}
              value={measure}
              onValueChange={setMeasure}
            />
          </div>
          <BarChart
            title={`${active.label} per day, last ${DASHBOARD_DAYS} days`}
            data={chartData}
            height="fill"
            minHeight={220}
            formatValue={n}
            unit={active.unit}
            emptyLabel={report.isPending ? "Loading…" : "Nothing recorded in the last 30 days"}
          />
          {notice ? <p className="text-[12px] text-ink-faint">{notice}</p> : null}
        </Card>

        <ContentPipelineCard />
      </div>

      <div className="grid grid-cols-1 gap-16 min-[1100px]:grid-cols-[1.6fr_1fr]">
        <Card className="flex min-w-0 flex-col gap-14" data-slot="top-sermons-card">
          <div className="flex items-baseline justify-between gap-12">
            <span className="text-[15px] font-semibold text-ink">Top sermons</span>
            <Link
              href="/settings/reports"
              className="font-mono text-[11px] text-ink-faint underline-offset-2 hover:text-clay-700 hover:underline"
            >
              last {DASHBOARD_DAYS} days · full report
            </Link>
          </div>
          <RankedBarList
            items={(report.data?.top_sermons ?? []).slice(0, 5).map((t) => ({
              label: t.title,
              value: t.plays,
            }))}
            formatValue={(v) => `${n(v)} ${v === 1 ? "play" : "plays"}`}
            emptyLabel={report.isPending ? "Loading…" : "No plays in the last 30 days"}
          />
        </Card>

        <Card className="flex min-w-0 flex-col gap-14" data-slot="all-time-card">
          <span className="text-[15px] font-semibold text-ink">All time</span>
          {all ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-12 gap-y-8 text-[13.5px]">
              {allTime.map(([label, value]) => (
                <React.Fragment key={label}>
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="text-right font-mono tabular-nums text-ink">{value}</dd>
                </React.Fragment>
              ))}
            </dl>
          ) : (
            <p className="text-body-sm text-ink-faint">{overview.isError ? "Couldn’t load." : "Loading…"}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
