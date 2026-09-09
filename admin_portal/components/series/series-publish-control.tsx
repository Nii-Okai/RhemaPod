"use client";

import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session-context";
import {
  useUpdateSeries,
  type Series,
} from "@/lib/query/hooks/use-series-manager";

/* =============================================================================
   SeriesPublishControl — publish / unpublish a series from its detail screen
   (Batch 5: `SeriesUpdate.status` accepts `draft` ⇄ `published`).

   The design shows no explicit control here, so per the wiring brief it sits
   next to the status badge in the Series-details card header: "Publish series"
   when the series is a draft, "Unpublish" when it is published.

   Manager/admin only — an editor never sees it (client gate on the session
   role), and if the gate is somehow bypassed the backend 403 surfaces through
   `onError`. `PATCH /api/v1/series/{id}` with `{ status }` is optimistic in
   `useUpdateSeries` (a single field — a rollback flash is acceptable);
   `useUpdateSeries.onSettled` already invalidates `series.detail` +
   `series.list`, so the grid card's badge follows.
   ========================================================================== */

/** The two states this control toggles between. A series in any other status
    (there is no series review workflow today) gets no control. */
const TOGGLEABLE = new Set(["draft", "published"]);

export interface SeriesPublishControlProps {
  series: Series;
  /** Surface a failure on the form's card-top alert. */
  onError: (message: string) => void;
  /** Clear a stale alert once the toggle lands. */
  onSuccess?: () => void;
}

export function SeriesPublishControl({
  series,
  onError,
  onSuccess,
}: SeriesPublishControlProps) {
  const { role } = useSession();
  const isManager = role === "manager" || role === "admin";
  const update = useUpdateSeries();

  if (!isManager || !TOGGLEABLE.has(series.status)) return null;

  const publishing = series.status !== "published";
  const nextStatus = publishing ? "published" : "draft";

  const toggle = () => {
    update.mutate(
      { seriesId: series.id, patch: { status: nextStatus } },
      {
        onSuccess: () => onSuccess?.(),
        onError: (err) => {
          if (isApiError(err)) {
            onError(
              err.correlationId
                ? `${err.detail} (reference: ${err.correlationId})`
                : err.detail,
            );
            return;
          }
          onError(
            publishing
              ? "Couldn’t publish the series."
              : "Couldn’t unpublish the series.",
          );
        },
      },
    );
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={update.isPending}
      onClick={toggle}
    >
      {update.isPending
        ? publishing
          ? "Publishing…"
          : "Unpublishing…"
        : publishing
          ? "Publish series"
          : "Unpublish"}
    </Button>
  );
}
