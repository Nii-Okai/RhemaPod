/**
 * `useSpeakers` — the "All speakers" filter options on the Sermons list (W7).
 *
 * `GET /api/v1/speakers` returns the full `SpeakerPublic[]` (no pagination on
 * the contract). Cached long — the list changes only when the Phase 2 Speakers
 * screen edits it.
 */

"use client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";

export type Speaker = components["schemas"]["SpeakerPublic"];

export function useSpeakers() {
  return useQuery({
    queryKey: queryKeys.speakers.list(),
    queryFn: ({ signal }) =>
      unwrap(api.GET("/api/v1/speakers", { signal })),
    staleTime: 5 * 60_000,
  });
}
