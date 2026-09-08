/**
 * Read a media file's duration in-browser (plan §A.5 — "a detached
 * `<video>`/`<audio>` element, `loadedmetadata`, read `duration`, pass to
 * confirm"). The backend only *fills a blank* with this value
 * (`media_service.confirm_upload`), so a failure to read it is non-fatal: we
 * resolve `null` and confirm without it.
 *
 * `UploadConfirm.duration_seconds` is validated `ge=1, le=86400` server-side —
 * this returns an int in that range or `null`.
 */

import type { UploadMediaKind } from "./constants";

const READ_TIMEOUT_MS = 15_000;

export function readMediaDuration(
  file: Blob,
  kind: UploadMediaKind,
): Promise<number | null> {
  return new Promise((resolve) => {
    // SSR / test env without DOM media APIs — skip cleanly.
    if (
      typeof document === "undefined" ||
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function"
    ) {
      resolve(null);
      return;
    }

    const el = document.createElement(kind === "video" ? "video" : "audio");
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.removeAttribute("src");
      try {
        el.load();
      } catch {
        /* ignore */
      }
      URL.revokeObjectURL(objectUrl);
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), READ_TIMEOUT_MS);

    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const d = el.duration;
      if (!Number.isFinite(d) || d <= 0) {
        finish(null);
        return;
      }
      finish(Math.min(86400, Math.max(1, Math.round(d))));
    };
    el.onerror = () => finish(null);
    el.src = objectUrl;
  });
}
