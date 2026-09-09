/**
 * Episode list + reorder for the Series manager's episode-order panel (W11).
 *
 * ── Why not `GET /api/v1/series/{id}/episodes` ────────────────────────────────
 * That endpoint returns **published episodes only** ("Published episodes of a
 * series"). A manager orders drafts too, so the panel reads
 * `GET /api/v1/sermons?series_id={id}` (the GATE 3 Batch 1 admin filter — every
 * status, paged). Flagged in `status.md` → [GATE 3 Batch 5].
 *
 * ── Reorder ─────────────────────────────────────────────────────────────────
 * No bulk-reorder endpoint exists, so a move is one `PATCH
 * /api/v1/sermons/{id}` per changed episode (`reorderEpisodes` decides which).
 * The UI reorders optimistically; a `Promise.allSettled` fan-out then reconciles
 * per row like `useSermonWorkflow`:
 *   - every PATCH failed  → reject → `onError` restores the pre-move order
 *   - some PATCHes failed → `onSuccess` restores, re-applies only the rows that
 *     landed, and surfaces the failure as a panel alert
 * `onSettled` refetches the list so the server order wins regardless.
 */

"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/query/keys";
import type {
  SermonListItem,
  SermonListPage,
} from "@/lib/query/hooks/use-sermons";
import {
  reorderEpisodes,
  sortEpisodes,
  type EpisodePatch,
} from "@/lib/series/episodes";

/** Backend caps `limit` at 100. A series with more episodes than this is out of
    scope for the panel (noted in `status.md`). */
export const EPISODE_ORDER_LIMIT = 100;

/** The exact `useSermons` params — and therefore the exact query key — the
    panel reads and the reorder mutation patches. Keep the two in lock-step. */
export function episodeListParams(seriesId: string) {
  return { series_id: seriesId, limit: EPISODE_ORDER_LIMIT } as const;
}

/** All episodes of a series, every status, sorted `episode_number` asc (nulls
    last). Returns the plain sorted array — the panel needs the rows, not the
    page envelope. */
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
    select: (page: SermonListPage) => sortEpisodes(page.items),
  });
}

/**
 * Episode count for a series card's `"N episodes · category"` footer.
 * `SeriesPublic` carries no count, so this is a `limit=1` `total` probe per card
 * (→ [GATE 3 Batch 5]: add a count to `SeriesPublic`).
 */
export function useSeriesEpisodeCount(seriesId: string) {
  return useQuery({
    queryKey: [...queryKeys.series.detail(seriesId), "episode-count"] as const,
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/sermons", {
          params: { query: { series_id: seriesId, limit: 1 } },
          signal,
        }),
      ).then((page) => page.total),
    staleTime: 60_000,
  });
}

interface ReorderVars {
  from: number;
  to: number;
}
interface ReorderContext {
  snapshot?: SermonListPage;
}
interface ReorderOutcome {
  succeeded: EpisodePatch[];
  failed: Array<{ patch: EpisodePatch; error: unknown }>;
}

class ReorderError extends Error {
  readonly failed: Array<{ patch: EpisodePatch; error: unknown }>;
  constructor(failed: Array<{ patch: EpisodePatch; error: unknown }>) {
    super("Every episode move failed");
    this.name = "ReorderError";
    this.failed = failed;
    Object.setPrototypeOf(this, ReorderError.prototype);
  }
}

function messageFor(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    return err.correlationId
      ? `${err.detail} (reference: ${err.correlationId})`
      : err.detail;
  }
  return fallback;
}

function failureMessage(
  failed: Array<{ patch: EpisodePatch; error: unknown }>,
): string {
  const names = failed.map((f) => `“${f.patch.title}”`).join(", ");
  const line =
    failed.length === 1
      ? `Couldn’t renumber ${names}.`
      : `Couldn’t renumber ${failed.length} episodes: ${names}.`;
  const backend = messageFor(failed[0].error, "");
  return backend ? `${line} ${backend}` : line;
}

/** Write a set of episode_number values into the cached page (optimistic /
    partial re-apply). Missing ids are left untouched. */
function applyNumbers(
  qc: QueryClient,
  key: readonly unknown[],
  numbers: Map<string, number>,
): void {
  const page = qc.getQueryData<SermonListPage>(key);
  if (!page) return;
  qc.setQueryData<SermonListPage>(key, {
    ...page,
    items: page.items.map((item: SermonListItem) =>
      numbers.has(item.id)
        ? { ...item, episode_number: numbers.get(item.id) as number }
        : item,
    ),
  });
}

export interface UseEpisodeReorderOptions {
  seriesId: string;
  /** The rows currently on screen, in display order. The mutation computes the
      move against these so the caller and the hook never disagree on indices. */
  ordered: SermonListItem[];
  /** Surface a failure — the panel renders it as a card `<Alert>`, never a
      toast (design §"Errors"). */
  onError: (message: string) => void;
}

export function useEpisodeReorder({
  seriesId,
  ordered,
  onError,
}: UseEpisodeReorderOptions) {
  const qc = useQueryClient();
  const key = queryKeys.sermons.list(episodeListParams(seriesId));

  const mutation = useMutation<
    ReorderOutcome,
    Error,
    ReorderVars,
    ReorderContext
  >({
    mutationFn: async ({ from, to }) => {
      const { patches } = reorderEpisodes(ordered, from, to);
      const settled = await Promise.allSettled(
        patches.map((p) =>
          api.PATCH("/api/v1/sermons/{sermon_id}", {
            params: { path: { sermon_id: p.id } },
            body: { episode_number: p.episode_number },
          }),
        ),
      );
      const succeeded: EpisodePatch[] = [];
      const failed: Array<{ patch: EpisodePatch; error: unknown }> = [];
      patches.forEach((patch, i) => {
        const r = settled[i];
        if (r.status === "rejected") failed.push({ patch, error: r.reason });
        else succeeded.push(patch);
      });
      if (succeeded.length === 0 && failed.length > 0) {
        throw new ReorderError(failed);
      }
      return { succeeded, failed };
    },
    onMutate: async ({ from, to }) => {
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueryData<SermonListPage>(key);
      const { patches } = reorderEpisodes(ordered, from, to);
      applyNumbers(qc, key, new Map(patches.map((p) => [p.id, p.episode_number])));
      return { snapshot };
    },
    onError: (err, _vars, context) => {
      if (context?.snapshot) qc.setQueryData(key, context.snapshot);
      onError(
        err instanceof ReorderError
          ? failureMessage(err.failed)
          : messageFor(err, "Couldn’t reorder the episodes."),
      );
    },
    onSuccess: ({ succeeded, failed }, _vars, context) => {
      if (failed.length === 0) return;
      // Partial failure: roll the whole page back to the pre-move order, then
      // re-apply only the numbers that actually landed — the failed rows keep
      // their real (pre-move) number, no rollback flash on the ones that went
      // through. `onSettled` then refetches the truth.
      if (context?.snapshot) qc.setQueryData(key, context.snapshot);
      applyNumbers(
        qc,
        key,
        new Map(succeeded.map((p) => [p.id, p.episode_number])),
      );
      onError(failureMessage(failed));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: queryKeys.series.detail(seriesId) });
      void qc.invalidateQueries({ queryKey: queryKeys.nav.counts() });
    },
  });

  return {
    isPending: mutation.isPending,
    move: (from: number, to: number) => {
      if (from === to) return;
      mutation.mutate({ from, to });
    },
  };
}
