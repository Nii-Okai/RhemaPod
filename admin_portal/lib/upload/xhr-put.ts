/**
 * The direct-to-storage PUT (plan §A.5 — "XHR, not fetch": `fetch` has no
 * upload-progress event; `XMLHttpRequest.upload.onprogress` gives `loaded` /
 * `total` for the design's "64% · 1.4 / 2.2 GB" line).
 *
 * Browser → object store DIRECT. This request never touches the BFF (a
 * multi-GB body must not stream through a Node route handler — plan §A.2/§A.5).
 * The `Content-Type` header MUST equal the one the presigned URL was signed
 * with or the store returns 403 SignatureDoesNotMatch.
 */

import { UploadAbortedError, UploadPutError } from "./errors";

export interface PutProgress {
  loaded: number;
  total: number;
}

export interface PutOptions {
  contentType: string;
  onProgress?: (p: PutProgress) => void;
  /** Called once with an `abort()` handle so the caller can cancel the PUT. */
  onAbortHandle?: (abort: () => void) => void;
  signal?: AbortSignal;
}

/**
 * PUT `file` to `url`. Resolves on a 2xx; rejects with:
 *   - `UploadAbortedError`         — caller cancelled / signal aborted
 *   - `UploadPutError(0)`          — network error / CORS block
 *   - `UploadPutError(status)`     — any non-2xx (403 = expired URL)
 */
export function putFileWithProgress(
  url: string,
  file: Blob,
  { contentType, onProgress, onAbortHandle, signal }: PutOptions,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadAbortedError());
      return;
    }

    const xhr = new XMLHttpRequest();
    let aborted = false;

    const abort = () => {
      aborted = true;
      try {
        xhr.abort();
      } catch {
        /* already torn down */
      }
    };
    onAbortHandle?.(abort);
    const onSignalAbort = () => abort();
    signal?.addEventListener("abort", onSignalAbort, { once: true });

    const cleanup = () => {
      signal?.removeEventListener("abort", onSignalAbort);
    };

    xhr.open("PUT", url, true);
    // Exactly the signed header — nothing else, or the signature breaks.
    xhr.setRequestHeader("Content-Type", contentType);

    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (!onProgress) return;
      const total = e.lengthComputable && e.total > 0 ? e.total : file.size;
      onProgress({ loaded: e.loaded, total });
    };

    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new UploadPutError(xhr.status, safeResponseText(xhr)));
      }
    };

    xhr.onerror = () => {
      cleanup();
      // A cross-origin/network failure surfaces here with status 0 and no body.
      reject(new UploadPutError(0));
    };

    xhr.onabort = () => {
      cleanup();
      reject(aborted ? new UploadAbortedError() : new UploadPutError(0));
    };

    xhr.ontimeout = () => {
      cleanup();
      reject(new UploadPutError(0, "timeout"));
    };

    xhr.send(file);
  });
}

function safeResponseText(xhr: XMLHttpRequest): string {
  try {
    return typeof xhr.responseText === "string" ? xhr.responseText : "";
  } catch {
    return "";
  }
}
