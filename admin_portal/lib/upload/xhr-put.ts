/**
 * The direct-to-storage PUT (plan §A.5 — "XHR, not fetch": `fetch` has no
 * upload-progress event; `XMLHttpRequest.upload.onprogress` gives `loaded` /
 * `total` for the design's "64% · 1.4 / 2.2 GB" line).
 *
 * Browser → object store DIRECT. This request never touches the BFF (a
 * multi-GB body must not stream through a Node route handler — plan §A.2/§A.5).
 * The `Content-Type` header MUST equal the one the presigned URL was signed
 * with or the store returns 403 SignatureDoesNotMatch.
 *
 * Failure surfaces are finished, not half-wired:
 *   - a clean `onerror` / non-2xx `onload`      → reject immediately;
 *   - a half-open socket (peer gone, no RST, no `onerror`) → the stall
 *     watchdog fires after `stallMs` of no progress, aborts, and rejects
 *     `UploadPutError(0, "timeout")`;
 *   - `xhr.timeout` is set to `4× stallMs` so the native `ontimeout` is a live
 *     backstop, not dead-wired.
 */

import { STALL_TIMEOUT_MS } from "./constants";
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
  /** No `upload.onprogress` for this long ⇒ the PUT is presumed dead and is
   *  aborted + rejected as a retryable timeout. Injectable for tests. */
  stallMs?: number;
}

/**
 * PUT `file` to `url`. Resolves on a 2xx; rejects with:
 *   - `UploadAbortedError`               — caller cancelled / signal aborted
 *   - `UploadPutError(0)`                — network error / CORS block
 *   - `UploadPutError(0, "timeout")`     — stalled (watchdog) or hard timeout
 *   - `UploadPutError(status)`           — any non-2xx (403 = expired URL)
 */
export function putFileWithProgress(
  url: string,
  file: Blob,
  {
    contentType,
    onProgress,
    onAbortHandle,
    signal,
    stallMs = STALL_TIMEOUT_MS,
  }: PutOptions,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadAbortedError());
      return;
    }

    const xhr = new XMLHttpRequest();
    let aborted = false;
    let settled = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    const clearWatchdog = () => {
      if (watchdog !== undefined) {
        clearTimeout(watchdog);
        watchdog = undefined;
      }
    };

    const abort = () => {
      aborted = true;
      try {
        xhr.abort();
      } catch {
        /* already torn down */
      }
    };
    const onSignalAbort = () => abort();

    // Single settle path — the first outcome wins; every later handler
    // (a synchronous `onabort` off our own `xhr.abort()`, a late `ontimeout`)
    // is a no-op.
    const settleResolve = () => {
      if (settled) return;
      settled = true;
      clearWatchdog();
      signal?.removeEventListener("abort", onSignalAbort);
      resolve();
    };
    const settleReject = (err: Error) => {
      if (settled) return;
      settled = true;
      clearWatchdog();
      signal?.removeEventListener("abort", onSignalAbort);
      reject(err);
    };

    const armWatchdog = () => {
      if (settled) return;
      clearWatchdog();
      watchdog = setTimeout(() => {
        if (settled) return;
        // Reject FIRST so the synchronous `onabort` off `xhr.abort()` can't
        // beat us with a plain-drop error, then tear the socket down.
        settleReject(new UploadPutError(0, "timeout"));
        try {
          xhr.abort();
        } catch {
          /* already torn down */
        }
      }, stallMs);
    };

    onAbortHandle?.(abort);
    signal?.addEventListener("abort", onSignalAbort, { once: true });

    xhr.open("PUT", url, true);
    // Exactly the signed header — nothing else, or the signature breaks.
    xhr.setRequestHeader("Content-Type", contentType);
    // A generous hard ceiling so `ontimeout` is a live backstop.
    xhr.timeout = stallMs * 4;

    xhr.upload.onprogress = (e: ProgressEvent) => {
      armWatchdog(); // reset on every tick — this is a STALL watchdog, not a total-time cap
      if (!onProgress) return;
      const total = e.lengthComputable && e.total > 0 ? e.total : file.size;
      onProgress({ loaded: e.loaded, total });
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        settleResolve();
      } else {
        settleReject(new UploadPutError(xhr.status));
      }
    };

    xhr.onerror = () => {
      // A cross-origin/network failure surfaces here with status 0 and no body.
      settleReject(new UploadPutError(0));
    };

    xhr.onabort = () => {
      settleReject(aborted ? new UploadAbortedError() : new UploadPutError(0));
    };

    xhr.ontimeout = () => {
      settleReject(new UploadPutError(0, "timeout"));
    };

    armWatchdog(); // covers "the very first byte never leaves the machine"
    xhr.send(file);
  });
}
