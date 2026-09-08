/**
 * `useThumbnailUpload` — the editor's "Replace image" flow (W9 item 4).
 *
 * A single `useMutation` that runs ticket → XHR PUT → confirm
 * (`lib/upload/thumbnail.ts`) and, on success, invalidates the sermon detail so
 * the card re-renders with the real image. The mutation also returns the fresh
 * `thumbnail_url` so the caller can swap the placeholder optimistically without
 * waiting for the refetch.
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { describeUploadFailure, UploadValidationError } from "@/lib/upload";
import { uploadSermonThumbnail } from "@/lib/upload/thumbnail";

export interface UseThumbnailUploadOptions {
  sermonId: string | undefined;
}

/** Route thumbnail failures through the same mapper the media pipeline uses,
 *  so the user sees "The upload link expired…", not "upload PUT failed
 *  (status 403)". */
function messageFor(err: unknown): string {
  return describeUploadFailure(err).message;
}

export function useThumbnailUpload({ sermonId }: UseThumbnailUploadOptions) {
  const qc = useQueryClient();

  const mutation = useMutation<string | null, Error, File>({
    mutationFn: async (file) => {
      if (!sermonId) {
        throw new UploadValidationError("Save the draft before adding an image.");
      }
      return uploadSermonThumbnail(sermonId, file);
    },
    onSuccess: () => {
      if (sermonId) {
        void qc.invalidateQueries({
          queryKey: queryKeys.sermons.detail(sermonId),
          exact: true,
        });
        void qc.invalidateQueries({ queryKey: queryKeys.sermons.lists() });
      }
    },
  });

  return {
    replace: (file: File) => mutation.mutate(file),
    isPending: mutation.isPending,
    isError: mutation.isError,
    errorMessage: mutation.error ? messageFor(mutation.error) : null,
    /** The freshly-returned URL, for an optimistic swap. */
    uploadedUrl: mutation.data ?? null,
    reset: mutation.reset,
  };
}
