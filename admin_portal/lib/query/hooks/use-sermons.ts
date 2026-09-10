/**
 * `useSermons` — the paged/filtered list hook (plan §A.4).
 *
 * Reference hook #1 of 2 for W3: it shows the shape every list hook follows —
 * typed params lifted straight from `schema.d.ts`, a key from the factory,
 * `keepPreviousData` so pagination does not blank the table. Per-screen hooks
 * (filters, counts, bulk actions) arrive with the Sermons screen in W7.
 */

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys, type SermonListParams } from "@/lib/query/keys";

export type { SermonListParams };
export type SermonListPage = components["schemas"]["Page_SermonAdminListItem_"];
export type SermonListItem = components["schemas"]["SermonAdminListItem"];

export interface UseSermonsOptions {
  /** Gate the query. Used by the "In review" branch of `useSermonsQuery`,
      which mounts two `useSermons` calls and only runs them for that tab. */
  enabled?: boolean;
  /** Per-call freshness window. Omitted → the client default (30s, §A.4).
      The Dashboard WIP cards pass an explicit value so their cadence does not
      silently ride on that default (D2). */
  staleTime?: number;
}

export function useSermons(
  params: SermonListParams = {},
  options: UseSermonsOptions = {},
) {
  return useQuery({
    queryKey: queryKeys.sermons.list(params),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/sermons", {
          params: { query: params },
          signal,
        }),
      ),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
    ...(options.staleTime === undefined ? {} : { staleTime: options.staleTime }),
  });
}
