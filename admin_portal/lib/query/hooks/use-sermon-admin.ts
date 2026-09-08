/**
 * `useSermonAdmin` — the workflow-aware single-sermon read for the editor
 * screen (W8, plan §A.9 / GATE 3 Batch 2).
 *
 * `GET /api/v1/sermons/{id}` → `SermonAdminDetail`: any status, staff only, and
 * an editor sees only their own (someone else's is **404**, not 403 — the
 * screen renders a neutral "not found or not yours" state for that). Adds
 * `updated_at`, the baseline the "saved N min ago" stamp starts from before the
 * first client-side save (§A.4).
 *
 * Distinct from `useSermon` (W3), which reads the published-only public
 * `GET /catalog/sermons/{id}` and must not be used for a draft.
 */

"use client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";

export type SermonAdminDetail = components["schemas"]["SermonAdminDetail"];

export function useSermonAdmin(sermonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.sermons.detail(sermonId ?? ""),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/sermons/{sermon_id}", {
          params: { path: { sermon_id: sermonId as string } },
          signal,
        }),
      ),
    enabled: Boolean(sermonId),
    // A 404 here is "gone or not yours" — a settled answer, not a transient
    // fault. Never retry it (the shared client already skips 4xx retries; this
    // is belt-and-braces and documents intent).
    retry: (failureCount, error) =>
      !isApiError(error) && failureCount < 2,
  });
}

/** True when the detail read failed specifically because the sermon does not
    exist for this user (deleted, or another editor's). Drives the editor's
    not-found panel. */
export function isNotFound(error: unknown): boolean {
  return isApiError(error) && error.status === 404;
}
