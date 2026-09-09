/**
 * `useAnnouncementImageUpload` — the Announcements editor's image flow (W13).
 *
 * Mirrors `useSeriesThumbnailUpload` / `useThumbnailUpload`: one `useMutation`
 * runs ticket → XHR PUT → confirm (`lib/upload/announcement-image.ts`) and, on
 * success, invalidates the announcements list so the row picks up the real
 * image. Returns the fresh `thumbnail_url` for an optimistic swap.
 *
 * The upload needs a saved draft id, so it is disabled until the announcement
 * exists (same "create it first" constraint as the sermon/series art).
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/keys";
import { describeUploadFailure, UploadValidationError } from "@/lib/upload";
import { uploadAnnouncementImage } from "@/lib/upload/announcement-image";

export interface UseAnnouncementImageUploadOptions {
  announcementId: string | undefined;
}

function messageFor(err: unknown): string {
  return describeUploadFailure(err).message;
}

export function useAnnouncementImageUpload({
  announcementId,
}: UseAnnouncementImageUploadOptions) {
  const qc = useQueryClient();

  const mutation = useMutation<string | null, Error, File>({
    mutationFn: async (file) => {
      if (!announcementId) {
        throw new UploadValidationError(
          "Save the announcement before adding an image.",
        );
      }
      return uploadAnnouncementImage(announcementId, file);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.announcements.lists() });
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
