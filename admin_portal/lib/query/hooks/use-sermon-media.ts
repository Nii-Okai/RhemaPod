/**
 * `useSermonMedia` — the sermon's playable renditions (W9).
 *
 * `GET /api/v1/sermons/{id}/media` → `MediaRefPublic[]`. Used only to render the
 * "ready" row's "· N renditions ready" tail (plan §A.5 State-mapping table:
 * "server `ready` + a second query to `GET /sermons/{id}/media`"), so it is
 * `enabled` only once at least one upload job has reached `ready` — no reason to
 * fetch it while everything is still uploading or processing.
 */

"use client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";

export type MediaRef = components["schemas"]["MediaRefPublic"];

export function useSermonMedia(
  sermonId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.sermons.media(sermonId ?? ""),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/sermons/{sermon_id}/media", {
          params: { path: { sermon_id: sermonId as string } },
          signal,
        }),
      ),
    enabled: Boolean(sermonId) && enabled,
  });
}
