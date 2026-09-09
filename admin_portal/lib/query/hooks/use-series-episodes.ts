/**
 * Episode list + reorder for the Series manager's episode-order panel (W11).
 *
 * ── Why not `GET /api/v1/series/{id}/episodes` ────────────────────────────────
 * That endpoint returns **published episodes only** ("Published episodes of a
 * series"). A manager orders drafts too, so the panel reads
 * `GET /api/v1/sermons?series_id={id}` (the GATE 3 Batch 1 admin filter — every
 * status, paged).
 *
 * ── Ordering ────────────────────────────────────────────────────────────────
 * The admin sermon list is ordered `updated_at desc` (`list_my_sermons`), NOT
 * `episode_number`. The client `sortEpisodes` is the only thing that puts the
 * rows in episode order. This also means a series with more than
 * `EPISODE_ORDER_LIMIT` episodes loads an arbitrary recency slice, not episodes
 * 1..N — and the atomic reorder endpoint requires the *complete* ordered set,
 * so past that limit reordering is disabled entirely (the panel shows a notice).
 *
 * ── Reorder (Batch 5) ───────────────────────────────────────────────────────
 * `PUT /api/v1/series/{series_id}/episode-order` takes the full ordered
 * episode-id list and renumbers the series `1..N` in one transaction. The UI
 * reorders optimistically; `onError` restores the snapshot and surfaces the
 * message (409 = a locked episode would move, backend names it; 422 = the id set
 * is stale, reload); `onSettled` refetches so the server order wins regardless.
 */

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";
import type {
  SermonListItem,
  SermonListPage,
} from "@/lib/query/hooks/use-sermons";
import { reorderEpisodes, sortEpisodes } from "@/lib/series/episodes";

/** Backend caps `limit` at 100 and `episode_ids` at `maxItems: 100`. A series
    with more episodes than this cannot be ordered here — the list arrives
    `updated_at desc`, so >100 is an arbitrary recency slice (not episodes
    1..N), and the atomic reorder needs the complete ordered set. */
export const EPISODE_ORDER_LIMIT = 100;

/** The exact `useSermons` params — and therefore the exact query key — the
    panel reads and the reorder mutation writes through. Keep the two in
    lock-step. */
export function episodeListParams(seriesId: string) {
  return { series_id: seriesId, limit: EPISODE_ORDER_LIMIT } as const;
}

export interface SeriesEpisodes {
  /** Rows sorted `episode_number` asc (nulls last), then title. */
  episodes: SermonListItem[];
  /** Server total for the series — `> EPISODE_ORDER_LIMIT` means the loaded
      rows are an arbitrary recency slice and reordering must be disabled. */
  total: number;
}

/** All episodes of a series, every status. Returns the sorted rows plus the
    server total — the panel needs both (the rows to render, the total to decide
    whether reordering is even meaningful). */
export function useSeriesEpisodes(seriesId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.sermons.list(
      seriesId ? episodeListParams(seriesId) : {},
    ),
    enabled: Boolean(seriesId),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/sermons", {
          params: { query: episodeListParams(seriesId as string) },
          signal,
        }),
      ),
    select: (page: SermonListPage): SeriesEpisodes => ({
      episodes: sortEpisodes(page.items),
      total: page.total,
    }),
  });
}

type EpisodeOrderItem = components["schemas"]["EpisodeOrderItem"];

interface ReorderVars {
  /** The full episode-id list in the new order — computed once in `move()`
      against the on-screen rows and threaded through so `onMutate` and
      `mutationFn` never recompute or disagree. */
  orderedIds: string[];
}
interface ReorderContext {
  snapshot?: SermonListPage;
}

function messageFor(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    return err.correlationId
      ? `${err.detail} (reference: ${err.correlationId})`
      : err.detail;
  }
  return fallback;
}

export interface UseEpisodeReorderOptions {
  seriesId: string;
  /** The rows currently on screen, in display order. The move is computed
      against these so the caller and the hook never disagree on indices. */
  ordered: SermonListItem[];
  /** Ids of episodes whose review lock makes them immovable fixed points. A
      move whose span would cross one is refused (→ `onBlocked`). */
  lockedIds: ReadonlySet<string>;
  /** Surface a failure — the panel renders it as a card `<Alert>`, never a
      toast (design §"Errors"). */
  onError: (message: string) => void;
  /** A move was refused because its span would cross a locked (in-review)
      episode. Not an error — the panel shows a brief inline note. */
  onBlocked: () => void;
}

export function useEpisodeReorder({
  seriesId,
  ordered,
  lockedIds,
  onError,
  onBlocked,
}: UseEpisodeReorderOptions) {
  const qc = useQueryClient();
  const key = queryKeys.sermons.list(episodeListParams(seriesId));

  const mutation = useMutation<
    EpisodeOrderItem[],
    Error,
    ReorderVars,
    ReorderContext
  >({
    mutationFn: ({ orderedIds }) =>
      unwrap(
        api.PUT("/api/v1/series/{series_id}/episode-order", {
          params: { path: { series_id: seriesId } },
          body: { episode_ids: orderedIds },
        }),
      ),
    onMutate: async ({ orderedIds }) => {
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueryData<SermonListPage>(key);
      // Optimistic: renumber the cached page 1..N by the new position, exactly
      // as the backend will.
      const numberByPosition = new Map(
        orderedIds.map((id, index) => [id, index + 1] as const),
      );
      if (snapshot) {
        qc.setQueryData<SermonListPage>(key, {
          ...snapshot,
          items: snapshot.items.map((item: SermonListItem) =>
            numberByPosition.has(item.id)
              ? { ...item, episode_number: numberByPosition.get(item.id) as number }
              : item,
          ),
        });
      }
      return { snapshot };
    },
    onError: (err, _vars, context) => {
      if (context?.snapshot) qc.setQueryData(key, context.snapshot);
      if (isApiError(err) && err.status === 422) {
        onError(
          "This series' episodes changed since the page loaded — reload and try again.",
        );
        return;
      }
      // 409 carries the backend's message naming the locked episode(s); every
      // other failure falls back to a generic line.
      onError(messageFor(err, "Couldn't reorder the episodes."));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: queryKeys.series.detail(seriesId) });
      // No nav-count invalidation: an `episode_number` shuffle changes no count.
      // The series nav count is a status-agnostic array length; the sermon and
      // review-queue counts are untouched by a reorder.
    },
  });

  return {
    isPending: mutation.isPending,
    move: (from: number, to: number) => {
      if (from === to) return;
      const { order, refused } = reorderEpisodes(ordered, from, to, lockedIds);
      if (refused) {
        onBlocked();
        return;
      }
      const orderedIds = order.map((e) => e.id);
      // No-op guard: the visual order is unchanged (e.g. a drop onto the same
      // index).
      if (orderedIds.every((id, i) => id === ordered[i]?.id)) return;
      mutation.mutate({ orderedIds });
    },
  };
}
