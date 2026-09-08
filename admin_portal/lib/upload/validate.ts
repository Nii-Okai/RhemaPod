/**
 * Pre-flight file validation (plan §A.5 step a — "client-validates type and
 * size BEFORE any network call").
 *
 * Pure and side-effect free so it is unit-tested on its own. The uploader calls
 * it first; a rejection never issues a ticket.
 */

import {
  ACCEPTED_IMAGE,
  ACCEPTED_MEDIA,
  MAX_THUMBNAIL_BYTES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_GB,
  type UploadMediaKind,
} from "./constants";

export type MediaValidation =
  | {
      ok: true;
      kind: UploadMediaKind;
      /** Canonical `Content-Type` to sign the PUT with. */
      contentType: string;
    }
  | { ok: false; reason: "type" | "size" | "empty"; message: string };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Validate a media file by **extension and MIME**, then size.
 *
 *  - Extension must be one of MP4 / MOV / MP3 / M4A. This is the primary gate —
 *    browsers frequently report an empty or vendor-specific `File.type`.
 *  - When `File.type` IS populated it must not contradict the extension's
 *    family (an `.mp4` reporting `text/plain` is rejected); a blank type is
 *    accepted on the extension alone.
 *  - Size must be >0 and ≤ the backend cap. The backend re-checks the real
 *    bytes at confirm (413) — this only spares an obvious loser the round-trip.
 */
export function validateMediaFile(file: {
  name: string;
  type: string;
  size: number;
}): MediaValidation {
  const ext = extensionOf(file.name);
  const entry = ACCEPTED_MEDIA.find((e) => e.ext === ext);
  if (!entry) {
    return {
      ok: false,
      reason: "type",
      message: `“${file.name}” isn’t a supported file. Upload an MP4, MOV, MP3, or M4A.`,
    };
  }

  const declared = file.type.trim().toLowerCase();
  if (declared) {
    const family = declared.split("/")[0];
    const expectedFamily = entry.kind; // "video" | "audio"
    // Allow the exact canonical type, any type within the right family, or the
    // common cross-family quirk where an .m4a is tagged video/mp4 by the OS.
    const familyOk =
      family === expectedFamily ||
      (ext === "m4a" && declared === "video/mp4") ||
      (ext === "mp4" && declared === "video/mp4");
    if (!familyOk) {
      return {
        ok: false,
        reason: "type",
        message: `“${file.name}” looks like a ${family || "different"} file, not ${
          expectedFamily === "video" ? "a video" : "an audio"
        } file. Check the file and try again.`,
      };
    }
  }

  if (file.size <= 0) {
    return {
      ok: false,
      reason: "empty",
      message: `“${file.name}” is empty.`,
    };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: "size",
      message: `“${file.name}” is larger than the ${MAX_UPLOAD_GB} GB limit.`,
    };
  }

  return { ok: true, kind: entry.kind, contentType: entry.contentType };
}

export type ImageValidation =
  | { ok: true; contentType: string }
  | { ok: false; reason: "type" | "size" | "empty"; message: string };

/** Validate a cover image — JPEG / PNG / WebP, ≤ 10 MB. */
export function validateImageFile(file: {
  name: string;
  type: string;
  size: number;
}): ImageValidation {
  const ext = extensionOf(file.name);
  const entry = ACCEPTED_IMAGE.find((e) => e.ext === ext);
  const declared = file.type.trim().toLowerCase();
  const declaredOk = declared.startsWith("image/");
  if (!entry || (declared && !declaredOk)) {
    return {
      ok: false,
      reason: "type",
      message: `“${file.name}” isn’t a supported image. Use a JPEG, PNG, or WebP.`,
    };
  }
  if (file.size <= 0) {
    return { ok: false, reason: "empty", message: `“${file.name}” is empty.` };
  }
  if (file.size > MAX_THUMBNAIL_BYTES) {
    return {
      ok: false,
      reason: "size",
      message: `“${file.name}” is larger than the 10 MB image limit.`,
    };
  }
  return { ok: true, contentType: entry.contentType };
}
