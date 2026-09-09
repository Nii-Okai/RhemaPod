/**
 * `useSeriesThumbnailUpload` — the Series manager's "Replace image" flow (W11).
 *
 * Mirrors `useThumbnailUpload` (the sermon editor's): one `useMutation` runs
 * ticket → XHR PUT → confirm (`lib/upload/series-thumbnail.ts`) and, on success,
 * invalidates the series detail + grid list so the art re-renders with the real
 * image. Returns the fresh `thumbnail_url` for an optimistic swap.
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { describeUploadFailure, UploadValidationError } from "@/lib/upload";
import { uploadSeriesThumbnail } from "@/lib/upload/series-thumbnail";

export interface UseSeriesThumbnailUploadOptions {
  seriesId: string | undefined;
}

function messageFor(err: unknown): string {
  return describeUploadFailure(err).message;
}

export function useSeriesThumbnailUpload({
  seriesId,
}: UseSeriesThumbnailUploadOptions) {
  const qc = useQueryClient();

  const mutation = useMutation<string | null, Error, File>({
    mutationFn: async (file) => {
      if (!seriesId) {
        throw new UploadValidationError("Create the series before adding art.");
      }
      return uploadSeriesThumbnail(seriesId, file);
    },
    onSuccess: () => {
      if (!seriesId) return;
      void qc.invalidateQueries({
        queryKey: queryKeys.series.detail(seriesId),
        exact: true,
      });
      void qc.invalidateQueries({ queryKey: queryKeys.series.list() });
    },
  });

  return {
    replace: (file: File) => mutation.mutate(file),
    isPending: mutation.isPending,
    isError: mutation.isError,
    errorMessage: mutation.error ? messageFor(mutation.error) : null,
    uploadedUrl: mutation.data ?? null,
    reset: mutation.reset,
  };
}
