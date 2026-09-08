/**
 * `useSeriesList` — the "All series" filter options on the Sermons list (W7).
 *
 * `GET /api/v1/series` returns `SeriesPublic[]` (no pagination on the
 * contract). Cached long — the list changes only when the Phase 2 Series
 * screen edits it. Named `useSeriesList` (not `useSeries`) so it does not read
 * as a single-series-by-id hook.
 */

"use client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";

export type SeriesListItem = components["schemas"]["SeriesPublic"];

export function useSeriesList() {
  return useQuery({
    queryKey: queryKeys.series.list(),
    queryFn: ({ signal }) => unwrap(api.GET("/api/v1/series", { signal })),
    staleTime: 5 * 60_000,
  });
}
