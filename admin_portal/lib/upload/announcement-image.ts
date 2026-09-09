/**
 * Announcement image upload (W13) — the sibling of `lib/upload/thumbnail.ts`
 * and `lib/upload/series-thumbnail.ts` for the Announcements editor's 16:9
 * image.
 *
 *   POST /api/v1/announcements/{id}/image-url                     → ThumbnailTicket
 *   PUT  <upload_url>  (direct to storage, XHR)
 *   POST /api/v1/announcements/{id}/image/confirm?thumbnail_key=… → ThumbnailResponse
 *
 * The contract is identical to the sermon/series one (verified in
 * `app/api/announcements.py` — same `ThumbnailTicket` / `ThumbnailResponse`
 * DTOs, same `thumbnail_key` round-trip). It stays a separate function rather
 * than a generic because `openapi-fetch` needs the literal path string (and its
 * `announcement_id` param key) for its types. Shared plumbing
 * (`putFileWithProgress`, the typed errors, the validator) is imported, not
 * re-implemented.
 */

import { api, unwrap } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";

import { ConfirmError, TicketError, UploadValidationError } from "./errors";
import { validateImageFile } from "./validate";
import { putFileWithProgress } from "./xhr-put";

export async function uploadAnnouncementImage(
  announcementId: string,
  file: File,
  signal?: AbortSignal,
): Promise<string | null> {
  const v = validateImageFile(file);
  if (!v.ok) throw new UploadValidationError(v.message);

  let ticket;
  try {
    ticket = await unwrap(
      api.POST("/api/v1/announcements/{announcement_id}/image-url", {
        params: { path: { announcement_id: announcementId } },
        body: { filename: file.name, content_type: v.contentType },
      }),
    );
  } catch (err) {
    if (isApiError(err)) {
      throw new TicketError(`Couldn’t start the image upload: ${err.detail}`, err);
    }
    throw new TicketError("Couldn’t start the image upload.", err);
  }

  await putFileWithProgress(ticket.upload_url, file, {
    contentType: ticket.headers?.["Content-Type"] ?? v.contentType,
    signal,
  });

  try {
    const res = await unwrap(
      api.POST("/api/v1/announcements/{announcement_id}/image/confirm", {
        params: {
          path: { announcement_id: announcementId },
          query: { thumbnail_key: ticket.thumbnail_key },
        },
      }),
    );
    return res.thumbnail_url;
  } catch (err) {
    if (isApiError(err)) {
      throw new ConfirmError(err.status, err.detail, err);
    }
    throw new ConfirmError(0, "Couldn’t attach the image. Try again.", err);
  }
}
