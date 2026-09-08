/**
 * `useSermonUploads` — the editor Media card's read-only job list (W8).
 *
 * `GET /api/v1/sermons/{id}/uploads` → `UploadJobPublic[]` (now carrying
 * `original_filename` / `content_type` / `size_bytes` — GATE 3 Batch 2).
 *
 * W8 renders this list read-only. The 3s conditional poll is wired **now** so
 * W9 only adds the upload action, not the refresh loop: the query refetches
 * every 3s **only while** some job is in a non-terminal state
 * (`awaiting_upload` / `uploaded` / `processing`) and stops otherwise (plan
 * §A.4 / design "State"). In W8, with no pipeline, there are no non-terminal
 * jobs, so it never polls — but the condition is in place and unit-tested.
 */

"use client";

import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { queryKeys } from "@/lib/query/keys";

export type UploadJob = components["schemas"]["UploadJobPublic"];
export type UploadJobStatus = UploadJob["status"];

/** The job states that mean "still moving" — the poll runs while any job is in
    one of these and halts once every job is terminal (`ready` / `failed`). */
export const ACTIVE_UPLOAD_STATUSES: readonly UploadJobStatus[] = [
  "awaiting_upload",
  "uploaded",
  "processing",
];

/** Pure poll predicate, exported for its unit test: does this job list still
    warrant a 3s refetch? */
export function hasActiveUploadJob(jobs: UploadJob[] | undefined): boolean {
  return (jobs ?? []).some((job) =>
    ACTIVE_UPLOAD_STATUSES.includes(job.status),
  );
}

export function useSermonUploads(sermonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.sermons.uploads(sermonId ?? ""),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/sermons/{sermon_id}/uploads", {
          params: { path: { sermon_id: sermonId as string } },
          signal,
        }),
      ),
    enabled: Boolean(sermonId),
    refetchInterval: (query) =>
      hasActiveUploadJob(query.state.data) ? 3000 : false,
  });
}
