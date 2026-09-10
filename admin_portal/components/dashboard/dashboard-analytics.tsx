"use client";

import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/portal";
import { BarChart } from "@/components/charts/BarChart";
import { RankedBarList } from "@/components/charts/RankedBarList";
import {
  NEW_LISTENERS_EMPTY_LABEL,
  toBarChartData,
} from "@/lib/dashboard/new-listeners";
import {
  useNewListeners,
  useOverview,
  useTopSermons,
  type OverviewStats,
} from "@/lib/query/hooks/use-dashboard";

/* =============================================================================
   Dashboard analytics — the manager/admin-only blocks (plan §A.1 / W23).

   MOUNTED ONLY IN THE MANAGER/ADMIN BRANCH of the Server Component. An editor
   session never renders this component, so its three `/admin/analytics/*`
   queries never run — there is no 403 in an editor's network log because there
   is no call (§W23 acceptance).

   Three blocks:
     - four BARE stat tiles from `overview()` — label + number only, no delta,
       no "of N total" (§A.1: "absence reads as absence").
     - the 8-week New listeners chart (W22 `BarChart`) — labelled "New
       listeners", never "Plays per week". The word "plays" appears nowhere on
       or around it (§A.2).
     - Top sermons (W22 `RankedBarList`).

   No period selector (30/90/Year) — cut (§A.1). Every displayed value is a
   backend response field; nothing is computed here beyond formatting one field
   for display (a count grouped with thousands separators, a rate shown as a
   percentage).
   ========================================================================== */

function ratePercent(rate: number): string {
  // `completion_rate` is a 0–1 fraction from `overview()`. Rendering it as a
  // percentage is a unit format of one backend field, not a derived statistic.
  return `${Math.round(rate * 100)}%`;
}

function tileValues(stats: OverviewStats | undefined) {
  return [
    {
      label: "Total plays",
      value: stats ? stats.total_plays.toLocaleString("en-US") : "—",
    },
    {
      label: "Completion rate",
      value: stats ? ratePercent(stats.completion_rate) : "—",
    },
    {
      label: "Paid members",
      value: stats ? stats.active_subscribers.toLocaleString("en-US") : "—",
    },
    {
      label: "Published sermons",
      value: stats ? stats.published_sermons.toLocaleString("en-US") : "—",
    },
  ];
}

export function DashboardAnalytics() {
  const overview = useOverview();
  const topSermons = useTopSermons();
  const newListeners = useNewListeners();

  const tiles = tileValues(overview.data);

  const chartData = newListeners.data ? toBarChartData(newListeners.data) : [];
  const chartEmptyLabel = newListeners.isPending
    ? "Loading…"
    : NEW_LISTENERS_EMPTY_LABEL;

  const rankedItems = (topSermons.data ?? []).map((sermon) => ({
    label: sermon.title,
    value: sermon.plays,
  }));

  return (
    <div className="flex flex-col gap-20" data-slot="dashboard-analytics">
      {overview.isError ? (
        <Alert variant="error" title="Couldn’t load the platform numbers">
          The tiles below will fill in on the next successful refresh.
        </Alert>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-14">
        {tiles.map((tile) => (
          <StatCard
            key={tile.label}
            label={tile.label}
            value={tile.value}
            data-testid={`stat-tile-${tile.label.toLowerCase().replace(/\s+/g, "-")}`}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-16 min-[1100px]:grid-cols-[1.5fr_1fr]">
        <Card className="flex min-w-0 flex-col gap-16" data-slot="new-listeners-card">
          <div className="flex items-baseline justify-between gap-12">
            <span className="text-[15px] font-semibold text-ink">
              New listeners
            </span>
            <span className="font-mono text-[11px] text-ink-faint">
              last 8 weeks
            </span>
          </div>

          {newListeners.isError ? (
            <p className="flex h-[150px] items-center justify-center border-b border-border text-body-sm text-ink-faint">
              Couldn’t load this week’s numbers.
            </p>
          ) : (
            <BarChart
              title="New listeners, last 8 weeks"
              data={chartData}
              emptyLabel={chartEmptyLabel}
            />
          )}
        </Card>

        <Card className="flex min-w-0 flex-col gap-14" data-slot="top-sermons-card">
          <span className="text-[15px] font-semibold text-ink">Top sermons</span>

          {topSermons.isError ? (
            <p className="text-body-sm text-ink-faint">
              Couldn’t load the ranking. Reload to try again.
            </p>
          ) : (
            <RankedBarList
              items={rankedItems}
              emptyLabel={
                topSermons.isPending ? "Loading…" : "No sermons ranked yet"
              }
            />
          )}
        </Card>
      </div>
    </div>
  );
}
