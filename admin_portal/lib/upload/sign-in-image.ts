/**
 * Sign-in screen image upload (Settings › Profile) — the sibling of
 * `series-thumbnail.ts`:
 *
 *   POST /api/v1/admin/settings/sign-in-image-url                → ThumbnailTicket
 *   PUT  <upload_url>  (direct to storage, XHR)
 *   POST /api/v1/admin/settings/sign-in-image/confirm?thumbnail_key=… → ChurchSettingsAdmin
 */

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { isApiError } from "@/lib/api/errors";

import { ConfirmError, TicketError, UploadValidationError } from "./errors";
import { validateImageFile } from "./validate";
import { putFileWithProgress } from "./xhr-put";

type ChurchSettingsAdmin = components["schemas"]["ChurchSettingsAdmin"];

export async function uploadSignInImage(
  file: File,
  signal?: AbortSignal,
): Promise<ChurchSettingsAdmin> {
  const v = validateImageFile(file);
  if (!v.ok) throw new UploadValidationError(v.message);

  let ticket;
  try {
    ticket = await unwrap(
      api.POST("/api/v1/admin/settings/sign-in-image-url", {
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
    return await unwrap(
      api.POST("/api/v1/admin/settings/sign-in-image/confirm", {
        params: { query: { thumbnail_key: ticket.thumbnail_key } },
      }),
    );
  } catch (err) {
    if (isApiError(err)) throw new ConfirmError(err.status, err.detail, err);
    throw new ConfirmError(0, "Couldn’t attach the image. Try again.", err);
  }
}
