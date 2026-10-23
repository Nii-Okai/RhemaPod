"use client";

import Link from "next/link";

import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PIPELINE_STAGES } from "@/lib/dashboard/metrics";
import { useSermonStatusCounts } from "@/lib/query/hooks/use-dashboard";

/* =============================================================================
   ContentPipelineCard — how many sermons sit at each workflow step, from
   `GET /sermons/status-counts` (one GROUP BY on the server). Every role sees
   it; an editor's numbers are their own sermons, a manager's and admin's are
   everyone's. Each row links to the matching Sermons view. Bars are scaled
   to the largest stage so the shape of the pipeline reads at a glance.
   ========================================================================== */

export function ContentPipelineCard({ title = "Content pipeline" }: { title?: string }) {
  const counts = useSermonStatusCounts();
  const data = counts.data;
  const max = data ? Math.max(1, ...PIPELINE_STAGES.map((s) => data[s.status] ?? 0)) : 1;

  return (
    <Card className="flex min-w-0 flex-col gap-14" data-slot="content-pipeline-card">
      <div className="flex items-baseline justify-between gap-12">
        <span className="text-[15px] font-semibold text-ink">{title}</span>
        <span className="font-mono text-[11px] text-ink-faint">
          {data ? `${data.total.toLocaleString("en-US")} sermons` : "sermons by status"}
        </span>
      </div>

      {counts.isError ? (
        <p className="text-body-sm text-ink-faint">Couldn’t load the counts. They retry every minute.</p>
      ) : (
        <ul className="flex flex-col gap-10">
          {PIPELINE_STAGES.map((stage) => {
            const value = data ? (data[stage.status] ?? 0) : 0;
            return (
              <li key={stage.status}>
                <Link
                  href={stage.href}
                  data-slot="pipeline-row"
                  data-status={stage.status}
                  className="group flex flex-col gap-4 rounded-8 outline-none focus-visible:focus-ring-button"
                >
                  <span className="flex items-baseline justify-between gap-8 text-[13.5px]">
                    <span className="truncate text-ink group-hover:text-clay-700">{stage.label}</span>
                    <span className="font-mono text-[12px] tabular-nums text-ink-muted">
                      {data ? value.toLocaleString("en-US") : "—"}
                    </span>
                  </span>
                  <Progress
                    value={(value / max) * 100}
                    label={`${stage.label}: ${value}`}
                    className="h-[5px]"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
