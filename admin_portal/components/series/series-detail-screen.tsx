"use client";

import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/portal";
import { isApiError } from "@/lib/api/errors";
import { useSeries } from "@/lib/query/hooks/use-series-manager";
import { SeriesForm } from "./series-form";
import { SeriesThumbnail } from "./series-thumbnail";
import { EpisodeOrder } from "./episode-order";

/* =============================================================================
   SeriesDetailScreen — `/series/[id]` (design Screen 6, plan W11 item 2).

   `id === "new"` is the create flow: just the form, which navigates to
   `/series/{newId}` on success. Any other id is the edit flow: the form, the
   series-art uploader and the episode-order panel, stacked (form + art side by
   side above 1100px, one column below).
   ========================================================================== */

const BACK_ACTION = (
  <Button asChild size="sm" variant="secondary">
    <Link href="/series">All series</Link>
  </Button>
);

export function SeriesDetailScreen({ seriesId }: { seriesId: string }) {
  const isNew = seriesId === "new";
  const series = useSeries(isNew ? undefined : seriesId);

  if (isNew) {
    return (
      <>
        <PageHeader
          title="New series"
          subhead="Name it and set a default tier — add episodes and art after."
          actions={BACK_ACTION}
        />
        <div className="max-w-[640px]">
          <SeriesForm mode="create" />
        </div>
      </>
    );
  }

  if (series.isPending) {
    return (
      <>
        <PageHeader title="Series" subhead="Loading…" actions={BACK_ACTION} />
        <div
          aria-hidden
          className="h-[420px] w-full max-w-[640px] rounded-16 border border-border bg-surface"
        />
      </>
    );
  }

  if (series.isError || !series.data) {
    const notFound = isApiError(series.error) && series.error.status === 404;
    return (
      <>
        <PageHeader
          title="Series"
          subhead="This series couldn’t be opened."
          actions={BACK_ACTION}
        />
        <Alert
          variant="error"
          title={notFound ? "Series not found" : "Couldn’t load this series"}
        >
          {notFound
            ? "It may have been deleted."
            : series.error instanceof Error
              ? series.error.message
              : "Please try again."}
        </Alert>
      </>
    );
  }

  const data = series.data;

  return (
    <>
      <PageHeader
        title={data.title}
        subhead="Series details, art and episode order."
        actions={BACK_ACTION}
      />

      <div className="grid gap-16 min-[1100px]:grid-cols-[1.5fr_1fr]">
        <SeriesForm mode="edit" series={data} />
        <SeriesThumbnail
          seriesId={data.id}
          thumbnailUrl={data.thumbnail_url ?? null}
          title={data.title}
        />
      </div>

      <EpisodeOrder seriesId={data.id} seriesTitle={data.title} />
    </>
  );
}
