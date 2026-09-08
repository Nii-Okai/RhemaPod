/**
 * The two authenticated calls the uploader makes through the BFF (plan §A.5):
 * request a ticket, then confirm. The file bytes do NOT go through here — that
 * is the direct XHR PUT in `xhr-put.ts`.
 *
 * Both go via the shared `api` client → same-origin `/api/bff/*` → FastAPI with
 * the bearer attached (plan §A.2). `api`'s `throwOnError` middleware rejects any
 * non-2xx as an `ApiError`, which the callers below re-wrap into the pipeline's
 * typed errors.
 */

import { api, unwrap } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";

import { ConfirmError, TicketError } from "./errors";

export type UploadTicket = components["schemas"]["UploadTicket"];
export type UploadJobPublic = components["schemas"]["UploadJobPublic"];

export interface TicketInput {
  sermonId: string;
  filename: string;
  contentType: string;
  mediaType: "video" | "audio";
  sizeBytes: number;
}

/** POST /api/v1/sermons/{id}/upload-url → a presigned PUT + a new job id. */
export async function requestTicket(input: TicketInput): Promise<UploadTicket> {
  try {
    return await unwrap(
      api.POST("/api/v1/sermons/{sermon_id}/upload-url", {
        params: { path: { sermon_id: input.sermonId } },
        body: {
          filename: input.filename,
          content_type: input.contentType,
          media_type: input.mediaType,
          size_bytes: input.sizeBytes,
        },
      }),
    );
  } catch (err) {
    throw toTicketError(err);
  }
}

function toTicketError(err: unknown): TicketError {
  if (isApiError(err)) {
    const ref = err.correlationId ? ` (reference: ${err.correlationId})` : "";
    // The presign path also enforces the size cap (413) against the *declared*
    // size — surface it with the same copy the confirm 413 uses.
    if (err.status === 413) {
      return new TicketError(err.detail || "File is too large.", err);
    }
    return new TicketError(
      `Couldn’t start the upload: ${err.detail}${ref}`,
      err,
    );
  }
  return new TicketError(
    "Couldn’t start the upload. Check your connection and retry.",
    err,
  );
}

/**
 * POST /api/v1/uploads/{jobId}/confirm — after the PUT lands. Carries the
 * browser-read `duration_seconds` when we have one (the backend only fills a
 * blank). A 413 here is the real-bytes oversized re-check (GATE 3 Batch 2).
 */
export async function confirmUpload(
  jobId: string,
  durationSeconds: number | null,
): Promise<UploadJobPublic> {
  try {
    return await unwrap(
      api.POST("/api/v1/uploads/{job_id}/confirm", {
        params: { path: { job_id: jobId } },
        body:
          durationSeconds != null
            ? { duration_seconds: durationSeconds }
            : {},
      }),
    );
  } catch (err) {
    throw toConfirmError(err);
  }
}

function toConfirmError(err: unknown): ConfirmError {
  if (isApiError(err)) {
    // Carry the support handle the same way `toTicketError` does. `describe
    // UploadFailure` swaps in canned size copy for a 413, so the reference is
    // only ever surfaced on the other statuses.
    const ref = err.correlationId ? ` (reference: ${err.correlationId})` : "";
    const message = err.status === 413 ? err.detail : `${err.detail}${ref}`;
    return new ConfirmError(err.status, message, err);
  }
  return new ConfirmError(
    0,
    "We couldn’t finalize the upload. Retry to start over.",
    err,
  );
}
