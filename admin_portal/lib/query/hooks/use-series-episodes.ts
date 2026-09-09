/**
 * Episode list + reorder for the Series manager's episode-order panel (W11).
 *
 * ── Why not `GET /api/v1/series/{id}/episodes` ────────────────────────────────
 * That endpoint returns **published episodes only** ("Published episodes of a
 * series"). A manager orders drafts too, so the panel reads
 * `GET /api/v1/sermons?series_id={id}` (the GATE 3 Batch 1 admin filter — every
 * status, paged). Flagged in `status.md` → [GATE 3 Batch 5].
 *
 * ── Ordering ────────────────────────────────────────────────────────────────
 * The admin sermon list is ordered `updated_at desc` (`list_my_sermons`), NOT
 * `episode_number`. The client `sortEpisodes` is the only thing that puts the
 * rows in episode order. This also means a series with more than
 * `EPISODE_ORDER_LIMIT` episodes loads an arbitrary recency slice, not episodes
 * 1..N — so reordering is disabled entirely past that limit (the panel shows a
 * notice; a proper `episode_number`-ordered read or a bulk-reorder endpoint is
 * the real fix, → [GATE 3 Batch 5] items 1 & 4).
 *
 * ── Reorder ─────────────────────────────────────────────────────────────────
 * No bulk-reorder endpoint exists, so a move is one `PATCH
 * /api/v1/sermons/{id}` per changed episode (`reorderEpisodes` decides which,
 * once, in `move()`). The UI reorders optimistically; a `Promise.allSettled`
 * fan-out then reconciles like `useSermonWorkflow`:
 *   - every PATCH failed  → reject → `onError` restores the pre-move order
 *   - some PATCHes failed → the landed rows are PATCHed back to their pre-move
 *     `episode_number` (best-effort revert so the server stays self-consistent),
 *     the cache is rolled back whole, and the failure surfaces as a panel alert
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

/** Backend caps `limit` at 100. A series with more episodes than this cannot be
    ordered here — the list arrives `updated_at desc`, so >100 is an arbitrary
    recency slice, not episodes 1..N (noted in `status.md` → [GATE 3 Batch 5]). */
export const EPISODE_ORDER_LIMIT = 100;

/** The exact `useSermons` params — and therefore the exact query key — the
    panel reads and the reorder mutation patches. Keep the two in lock-step. */
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

/**
 * Episode count for a series card's `"N episodes · category"` footer.
 * `SeriesPublic` carries no count, so this is a `limit=1` `total` probe per card
 * (→ [GATE 3 Batch 5]: add a count to `SeriesPublic`).
 *
 * Keyed under the **sermons** domain (`sermons.list({ series_id, limit: 1 })`),
 * not `series.detail` — the count is a sermons-domain fact (how many sermons
 * carry this `series_id`), so a `sermons.lists()` invalidation from the editor's
 * series-assignment mutation must reach it or the footer goes stale.
 */
export function useSeriesEpisodeCount(seriesId: string) {
  return useQuery({
    queryKey: queryKeys.sermons.list({ series_id: seriesId, limit: 1 }),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/sermons", {
          params: { query: { series_id: seriesId, limit: 1 } },
          signal,
        }),
      ),
    select: (page: SermonListPage) => page.total,
    staleTime: 60_000,
  });
}

interface ReorderVars {
  /** Computed once in `move()` (against the on-screen rows) and threaded
      through so `onMutate` and `mutationFn` never recompute or disagree. */
  patches: EpisodePatch[];
}
interface ReorderContext {
  snapshot?: SermonListPage;
}
type PartialOutcome = "reverted" | "inconsistent";
interface ReorderOutcome {
  failed: Array<{ patch: EpisodePatch; error: unknown }>;
  /** Present only on a partial failure: whether the best-effort revert of the
      landed rows succeeded (`reverted`) or itself failed (`inconsistent`). */
  partial?: PartialOutcome;
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

function patchEpisodeNumber(id: string, episode_number: number) {
  return api.PATCH("/api/v1/sermons/{sermon_id}", {
    params: { path: { sermon_id: id } },
    body: { episode_number },
  });
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
    ReorderOutcome,
    Error,
    ReorderVars,
    ReorderContext
  >({
    mutationFn: async ({ patches }) => {
      const preMove = new Map(ordered.map((e) => [e.id, e.episode_number]));

      const settled = await Promise.allSettled(
        patches.map((p) => patchEpisodeNumber(p.id, p.episode_number)),
      );
      const succeeded: EpisodePatch[] = [];
      const failed: Array<{ patch: EpisodePatch; error: unknown }> = [];
      patches.forEach((patch, i) => {
        const r = settled[i];
        if (r.status === "rejected") failed.push({ patch, error: r.reason });
        else succeeded.push(patch);
      });

      if (failed.length === 0) return { failed };
      if (succeeded.length === 0) throw new ReorderError(failed);

      // Partial failure: the landed PATCHes have durably committed numbers that
      // now collide with the rows that didn't move. Best-effort revert every
      // landed row to its pre-move number so the server is at least
      // self-consistent. A pre-move `null` can't be cleanly reverted (PATCH
      // null semantics are undefined here) → treat as an incomplete revert.
      const revertable = succeeded.filter(
        (p) => typeof preMove.get(p.id) === "number",
      );
      const revertSettled = await Promise.allSettled(
        revertable.map((p) =>
          patchEpisodeNumber(p.id, preMove.get(p.id) as number),
        ),
      );
      const revertClean =
        revertable.length === succeeded.length &&
        revertSettled.every((r) => r.status === "fulfilled");

      return { failed, partial: revertClean ? "reverted" : "inconsistent" };
    },
    onMutate: async ({ patches }) => {
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueryData<SermonListPage>(key);
      applyNumbers(
        qc,
        key,
        new Map(patches.map((p) => [p.id, p.episode_number])),
      );
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
    onSuccess: ({ failed, partial }, _vars, context) => {
      if (failed.length === 0) return;
      // Partial failure. The landed rows have been reverted on the server (or
      // the revert itself failed); either way roll the cache back to the
      // pre-move order wholesale — nothing is meant to have changed.
      // `onSettled` then refetches the truth.
      if (context?.snapshot) qc.setQueryData(key, context.snapshot);
      onError(
        partial === "inconsistent"
          ? `${failureMessage(
              failed,
            )} The episode numbering may be inconsistent — reload the page to check.`
          : `The reorder didn’t complete, so nothing was changed. ${failureMessage(
              failed,
            )}`,
      );
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
      const { patches, refused } = reorderEpisodes(
        ordered,
        from,
        to,
        lockedIds,
      );
      if (refused) {
        onBlocked();
        return;
      }
      if (patches.length === 0) return;
      mutation.mutate({ patches });
    },
  };
}
