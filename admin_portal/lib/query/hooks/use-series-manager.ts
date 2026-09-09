/**
 * Series manager read + write hooks (W11).
 *
 *   useSeries(id)        GET    /api/v1/series/{id}      → SeriesPublic
 *   useCreateSeries()    POST   /api/v1/series           → SeriesPublic (201)
 *   useUpdateSeries()    PATCH  /api/v1/series/{id}      → SeriesPublic
 *   useDeleteSeries()    DELETE /api/v1/series/{id}      → 204
 *
 * `useSeriesList` (the grid + the W7 filter options) stays in `use-series.ts`.
 *
 * Edits are optimistic on `series.detail(id)` + the `series.list()` grid cache
 * with rollback (design §"Interactions" — optimistic transitions + rollback,
 * errors as a panel-top alert, never a toast). Create and delete are not
 * optimistic: create needs the server id to navigate to, and a delete confirm
 * dialog already gates it.
 *
 * Backend gaps this surfaces → [GATE 3 Batch 5]:
 *   - `SeriesUpdate` has no `status` field and there is no series
 *     publish/unpublish workflow, so a series' status is fixed at `draft` on
 *     create and the design's status badge can only ever read "Draft" here.
 *   - `SeriesPublic` carries no episode count and no `category_name`, so the
 *     grid derives both client-side (see `use-series-episodes.ts` /
 *     `useCategories`).
 */

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";

export type Series = components["schemas"]["SeriesPublic"];
export type SeriesCreate = components["schemas"]["SeriesCreate"];
export type SeriesUpdate = components["schemas"]["SeriesUpdate"];

export function useSeries(seriesId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.series.detail(seriesId ?? ""),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/series/{series_id}", {
          params: { path: { series_id: seriesId as string } },
          signal,
        }),
      ),
    enabled: Boolean(seriesId),
  });
}

export function useCreateSeries() {
  const qc = useQueryClient();
  return useMutation<Series, Error, SeriesCreate>({
    mutationFn: (body) => unwrap(api.POST("/api/v1/series", { body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.series.all() });
      void qc.invalidateQueries({ queryKey: queryKeys.nav.counts() });
    },
  });
}

interface UpdateVars {
  seriesId: string;
  patch: SeriesUpdate;
}
interface UpdateContext {
  detail?: Series;
  list?: Series[];
}

/** Apply a `SeriesUpdate` onto a `SeriesPublic` for the optimistic cache write.
    Only keys the patch actually sets are touched; `title` / `tier` never go
    `null` (the form never sends that), so a stray `null` falls back to the
    current value rather than widening the row's type. */
function mergeSeries(base: Series, patch: SeriesUpdate): Series {
  return {
    ...base,
    ...("title" in patch ? { title: patch.title ?? base.title } : {}),
    ...("description" in patch ? { description: patch.description ?? null } : {}),
    ...("category_id" in patch
      ? { category_id: patch.category_id ?? null }
      : {}),
    ...("tier" in patch ? { tier: patch.tier ?? base.tier } : {}),
  };
}

export function useUpdateSeries() {
  const qc = useQueryClient();
  return useMutation<Series, Error, UpdateVars, UpdateContext>({
    mutationFn: ({ seriesId, patch }) =>
      unwrap(
        api.PATCH("/api/v1/series/{series_id}", {
          params: { path: { series_id: seriesId } },
          body: patch,
        }),
      ),
    onMutate: async ({ seriesId, patch }) => {
      await qc.cancelQueries({ queryKey: queryKeys.series.detail(seriesId) });
      await qc.cancelQueries({ queryKey: queryKeys.series.list() });
      const detail = qc.getQueryData<Series>(queryKeys.series.detail(seriesId));
      const list = qc.getQueryData<Series[]>(queryKeys.series.list());
      if (detail) {
        qc.setQueryData<Series>(
          queryKeys.series.detail(seriesId),
          mergeSeries(detail, patch),
        );
      }
      if (list) {
        qc.setQueryData<Series[]>(
          queryKeys.series.list(),
          list.map((s) => (s.id === seriesId ? mergeSeries(s, patch) : s)),
        );
      }
      return { detail, list };
    },
    onError: (_err, { seriesId }, context) => {
      if (context?.detail) {
        qc.setQueryData(queryKeys.series.detail(seriesId), context.detail);
      }
      if (context?.list) {
        qc.setQueryData(queryKeys.series.list(), context.list);
      }
    },
    onSettled: (_data, _err, { seriesId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.series.detail(seriesId) });
      void qc.invalidateQueries({ queryKey: queryKeys.series.list() });
    },
  });
}

export function useDeleteSeries() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (seriesId) => {
      await api.DELETE("/api/v1/series/{series_id}", {
        params: { path: { series_id: seriesId } },
      });
    },
    onSuccess: (_data, seriesId) => {
      qc.removeQueries({ queryKey: queryKeys.series.detail(seriesId) });
      void qc.invalidateQueries({ queryKey: queryKeys.series.all() });
      void qc.invalidateQueries({ queryKey: queryKeys.nav.counts() });
      // A series delete `SET NULL`s `sermon.series_id`, so list rows change too.
      void qc.invalidateQueries({ queryKey: queryKeys.sermons.lists() });
    },
  });
}
