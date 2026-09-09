/**
 * Series cover-image upload (W11) — the sibling of `lib/upload/thumbnail.ts`
 * for the Series manager's 16:9 art.
 *
 *   POST /api/v1/series/{id}/thumbnail-url                       → ThumbnailTicket
 *   PUT  <upload_url>  (direct to storage, XHR)
 *   POST /api/v1/series/{id}/thumbnail/confirm?thumbnail_key=…   → ThumbnailResponse
 *
 * The contract is identical to the sermon one (verified in `app/api/series.py`),
 * so this is a near-copy of `uploadSermonThumbnail`. It stays a separate
 * function rather than a generic because `openapi-fetch` needs the literal path
 * string (and its `series_id` vs `sermon_id` param key) for its types — a union
 * would erase them. Shared plumbing (`putFileWithProgress`, the typed errors,
 * the validator) is imported, not re-implemented.
 */

import { api, unwrap } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";

import { ConfirmError, TicketError, UploadValidationError } from "./errors";
import { validateImageFile } from "./validate";
import { putFileWithProgress } from "./xhr-put";

export async function uploadSeriesThumbnail(
  seriesId: string,
  file: File,
  signal?: AbortSignal,
): Promise<string | null> {
  const v = validateImageFile(file);
  if (!v.ok) throw new UploadValidationError(v.message);

  let ticket;
  try {
    ticket = await unwrap(
      api.POST("/api/v1/series/{series_id}/thumbnail-url", {
        params: { path: { series_id: seriesId } },
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
      api.POST("/api/v1/series/{series_id}/thumbnail/confirm", {
        params: {
          path: { series_id: seriesId },
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
