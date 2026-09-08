/**
 * Upload pipeline constants (plan §A.5, W9).
 *
 * `MAX_UPLOAD_BYTES` mirrors the backend's `settings.max_upload_bytes`
 * (`app/core/config.py:95` — default `5 * 1024 ** 3`). It is used ONLY for the
 * pre-flight client check so an obviously-too-large file never starts a network
 * round-trip. The backend re-checks the real `ContentLength` at confirm and
 * returns 413 (GATE 3 Batch 2), so this constant drifting low is a UX nicety,
 * drifting high is caught server-side — never a correctness hole. There is no
 * `NEXT_PUBLIC_*` config channel in Phase 1 (plan §A.8) to source it live.
 */

/** 5 GiB — keep in lockstep with `settings.max_upload_bytes`. */
export const MAX_UPLOAD_BYTES = 5 * 1024 ** 3;

/** Whole-GB figure for user-facing copy ("larger than the 5 GB limit"). */
export const MAX_UPLOAD_GB = Math.floor(MAX_UPLOAD_BYTES / 1024 ** 3);

/** A generous ceiling for a cover image. The backend imposes no size cap on
 *  thumbnails, so this is purely a client courtesy against a fat-finger. */
export const MAX_THUMBNAIL_BYTES = 10 * 1024 ** 2;

export type UploadMediaKind = "video" | "audio";

interface AcceptEntry {
  /** Lower-case extension without the dot. */
  ext: string;
  kind: UploadMediaKind;
  /** The canonical `Content-Type` to sign the presigned PUT with. Must be one
   *  the backend's `_validate_content_type` allow-list accepts
   *  (`app/services/media_service.py`). */
  contentType: string;
}

/** MP4 / MOV / MP3 / M4A — the design's stated set (Screen 4 "Media card"). */
export const ACCEPTED_MEDIA: readonly AcceptEntry[] = [
  { ext: "mp4", kind: "video", contentType: "video/mp4" },
  { ext: "mov", kind: "video", contentType: "video/quicktime" },
  { ext: "mp3", kind: "audio", contentType: "audio/mpeg" },
  { ext: "m4a", kind: "audio", contentType: "audio/mp4" },
];

/** `accept` attribute for the file <input> — extensions plus broad MIME globs
 *  so the OS picker filters sensibly without being the security boundary. */
export const MEDIA_ACCEPT_ATTR = [
  ...ACCEPTED_MEDIA.map((e) => `.${e.ext}`),
  "video/mp4",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
].join(",");

export const ACCEPTED_IMAGE = [
  { ext: "jpg", contentType: "image/jpeg" },
  { ext: "jpeg", contentType: "image/jpeg" },
  { ext: "png", contentType: "image/png" },
  { ext: "webp", contentType: "image/webp" },
] as const;

export const IMAGE_ACCEPT_ATTR = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  "image/jpeg",
  "image/png",
  "image/webp",
].join(",");
