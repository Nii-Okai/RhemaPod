"use client";

import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/portal/empty-state";
import { useSeriesList } from "@/lib/query/hooks/use-series";
import { SeriesCard } from "./series-card";
import { NewSeriesTile } from "./new-series-tile";

/* =============================================================================
   SeriesGrid — the card grid on the Series manager (design Screen 6).

   `auto-fill minmax(250px, 1fr)`, gap 16. One `SeriesCard` per series, then the
   dashed `NewSeriesTile`. Loading is a geometry-matched skeleton (design
   §"Loading"); a load failure is a panel-top `<Alert>`, never a toast; an empty
   list gets the "No series yet" state with a New series action.
   ========================================================================== */

const GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-16";

function CardSkeleton() {
  return (
    <div
      aria-hidden
      className="flex flex-col overflow-hidden rounded-14 border border-border bg-surface"
    >
      <div className="aspect-video bg-border-subtle" />
      <div className="flex flex-col gap-7 p-16">
        <span className="block h-[20px] w-[70%] rounded-4 bg-border-subtle" />
        <span className="block h-[13px] w-full rounded-4 bg-border-subtle" />
        <span className="mt-2 block h-[13px] w-[45%] rounded-4 border-t border-transparent bg-border-subtle" />
      </div>
    </div>
  );
}

export function SeriesGrid() {
  const series = useSeriesList();

  if (series.isPending) {
    return (
      <div className={GRID_CLASS} data-slot="series-grid-skeleton">
        {Array.from({ length: 6 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (series.isError) {
    return (
      <Alert variant="error" title="Couldn’t load series">
        {series.error instanceof Error
          ? series.error.message
          : "Please try again."}
      </Alert>
    );
  }

  if (!series.data || series.data.length === 0) {
    return (
      <EmptyState
        title="No series yet"
        description="Group related sermons into an ordered teaching series."
        action={
          <Button asChild size="sm">
            <Link href="/series/new">New series</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className={GRID_CLASS} data-slot="series-grid">
      {series.data.map((s) => (
        <SeriesCard key={s.id} series={s} />
      ))}
      <NewSeriesTile />
    </div>
  );
}
