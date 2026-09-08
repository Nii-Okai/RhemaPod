/**
 * Cover-image upload (plan W9 item 4 — "wire the same pattern: ticket → XHR PUT
 * → confirm against the thumbnail endpoints").
 *
 *   POST /api/v1/sermons/{id}/thumbnail-url   → ThumbnailTicket
 *   PUT  <upload_url>  (direct to storage, XHR)
 *   POST /api/v1/sermons/{id}/thumbnail/confirm?thumbnail_key=…  → ThumbnailResponse
 *
 * Smaller and synchronous-feeling (no job, no poll): one call resolves with the
 * new `thumbnail_url`. Shared plumbing: `putFileWithProgress`, the typed
 * pipeline errors, the `api` BFF client.
 */

import { api, unwrap } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";

import { ConfirmError, TicketError, UploadValidationError } from "./errors";
import { validateImageFile } from "./validate";
import { putFileWithProgress } from "./xhr-put";

export async function uploadSermonThumbnail(
  sermonId: string,
  file: File,
  signal?: AbortSignal,
): Promise<string | null> {
  const v = validateImageFile(file);
  if (!v.ok) throw new UploadValidationError(v.message);

  let ticket;
  try {
    ticket = await unwrap(
      api.POST("/api/v1/sermons/{sermon_id}/thumbnail-url", {
        params: { path: { sermon_id: sermonId } },
        body: { filename: file.name, content_type: v.contentType },
      }),
    );
  } catch (err) {
    if (isApiError(err)) {
      throw new TicketError(`Couldn’t start the image upload: ${err.detail}`, err);
    }
    throw new TicketError("Couldn’t start the image upload.", err);
  }

  // Same defect class as the media PUT: a half-open socket would hang forever.
  // `putFileWithProgress` arms its stall watchdog by default; thread a `signal`
  // through so the caller can cancel too.
  await putFileWithProgress(ticket.upload_url, file, {
    contentType: ticket.headers?.["Content-Type"] ?? v.contentType,
    signal,
  });

  try {
    const res = await unwrap(
      api.POST("/api/v1/sermons/{sermon_id}/thumbnail/confirm", {
        params: {
          path: { sermon_id: sermonId },
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
