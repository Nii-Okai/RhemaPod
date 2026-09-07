/**
 * `useSermon` — the single-sermon detail hook (plan §A.4).
 *
 * Reference hook #2 of 2 for W3: typed path param from `schema.d.ts`, a nested
 * detail key, `enabled` gating so the query is idle until an id exists.
 *
 * Reads `GET /api/v1/catalog/sermons/{sermon_id}` (→ `SermonDetail`) — the only
 * endpoint that returns a full sermon by id today. The admin editor (W8) may
 * need a workflow-aware variant; there is no admin single-GET on the current
 * contract (see plan §A.9), which W8 surfaces at the standing backend gate.
 */

"use client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";

export type SermonDetail = components["schemas"]["SermonDetail"];

export function useSermon(sermonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.sermons.detail(sermonId ?? ""),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/catalog/sermons/{sermon_id}", {
          params: { path: { sermon_id: sermonId as string } },
          signal,
        }),
      ),
    enabled: Boolean(sermonId),
  });
}
