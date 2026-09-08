/**
 * Typed failure surfaces for the upload pipeline (plan §A.5 — "surfaces every
 * failure distinctly").
 *
 * Six places an upload can die, each with its own copy:
 *
 *   1. validation   — pre-flight type/size reject (no ticket issued)
 *   2. ticket       — POST …/upload-url failed (4xx/5xx from FastAPI)
 *   3. transfer/net — the PUT itself: network drop or CORS block (xhr.status 0)
 *   3b transfer/stall — the PUT stalled: no progress for STALL_TIMEOUT_MS, or
 *                       the hard `xhr.timeout` ceiling fired (xhr.status 0,
 *                       reason "timeout")
 *   4. transfer/403 — the PUT: the presigned URL expired (xhr.status 403)
 *   5. confirm      — POST …/confirm failed, incl. the 413 oversized re-check
 *   6. processing   — the job polled to `failed`; show its raw `error_message`
 *
 * `describeUploadFailure` maps a thrown error to `{ surface, message, retryable }`.
 * Only pre-flight `validation` is non-retryable (the same file fails the same
 * way). The message for surface 6 is the server's `error_message` verbatim
 * (design: "the raw `error_message` in Plex Mono rose").
 */

import { isApiError } from "@/lib/api/errors";

import { MAX_UPLOAD_GB } from "./constants";

export type UploadFailureSurface =
  | "validation"
  | "ticket"
  | "transfer"
  | "confirm"
  | "processing";

/** Pre-flight reject. Never carries a Retry — the same file fails the same way. */
export class UploadValidationError extends Error {
  readonly surface = "validation" as const;
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
    Object.setPrototypeOf(this, UploadValidationError.prototype);
  }
}

/** POST …/upload-url failed. Wraps the underlying `ApiError` for its detail. */
export class TicketError extends Error {
  readonly surface = "ticket" as const;
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "TicketError";
    this.cause = cause;
    Object.setPrototypeOf(this, TicketError.prototype);
  }
}

/**
 * The direct-to-storage PUT failed. `status` is `xhr.status`:
 *   0                    → network error / CORS block / connection dropped
 *   0 + reason "timeout" → the PUT stalled (watchdog) or hit the hard ceiling
 *   403                  → the presigned URL expired (or a signature mismatch)
 *   else                 → some other non-2xx from the object store
 *
 * The store's response body is deliberately NOT captured — S3/MinIO error XML
 * echoes the bucket name, object key and RequestId, and this error propagates
 * app-wide where a future `console.error(err)` would exfiltrate it (CWE-209).
 */
export class UploadPutError extends Error {
  readonly surface = "transfer" as const;
  readonly status: number;
  /** Set to "timeout" for a stall-watchdog abort or the hard `xhr.timeout`. */
  readonly reason?: "timeout";
  constructor(status: number, reason?: "timeout") {
    super(`upload PUT failed (status ${status})`);
    this.name = "UploadPutError";
    this.status = status;
    this.reason = reason;
    Object.setPrototypeOf(this, UploadPutError.prototype);
  }
}

/** The user cancelled, or the row was torn down. Not a real failure — the row
 *  is removed, not marked Failed. */
export class UploadAbortedError extends Error {
  readonly surface = "transfer" as const;
  constructor() {
    super("upload aborted");
    this.name = "UploadAbortedError";
    Object.setPrototypeOf(this, UploadAbortedError.prototype);
  }
}

/** The job left the client cleanly (PUT + confirm both OK) but transcoding
 *  then failed server-side. Carries the backend's `error_message` verbatim
 *  (design: rendered raw). Retryable — a fresh ticket + upload replaces it. */
export class ProcessingError extends Error {
  readonly surface = "processing" as const;
  constructor(message: string) {
    super(message);
    this.name = "ProcessingError";
    Object.setPrototypeOf(this, ProcessingError.prototype);
  }
}

/** POST …/confirm failed. `status` distinguishes the 413 oversized re-check. */
export class ConfirmError extends Error {
  readonly surface = "confirm" as const;
  readonly status: number;
  readonly cause?: unknown;
  constructor(status: number, message: string, cause?: unknown) {
    super(message);
    this.name = "ConfirmError";
    this.status = status;
    this.cause = cause;
    Object.setPrototypeOf(this, ConfirmError.prototype);
  }
}

export interface UploadFailure {
  surface: UploadFailureSurface;
  message: string;
  /** Whether a Retry can plausibly succeed. Only pre-flight `validation`
   *  fails identically every time; every other surface gets a Retry button. */
  retryable: boolean;
}

/**
 * Collapse any error thrown along the pipeline into the `{ surface, message,
 * retryable }` a Failed row renders. Unknown errors fall through to a generic
 * transfer message rather than leaking a stack, a URL, or a response body.
 */
export function describeUploadFailure(err: unknown): UploadFailure {
  if (err instanceof UploadValidationError) {
    return { surface: "validation", message: err.message, retryable: false };
  }

  if (err instanceof TicketError) {
    return { surface: "ticket", message: err.message, retryable: true };
  }

  if (err instanceof ConfirmError) {
    if (err.status === 413) {
      return {
        surface: "confirm",
        message: `File is larger than the ${MAX_UPLOAD_GB} GB limit.`,
        retryable: true,
      };
    }
    return { surface: "confirm", message: err.message, retryable: true };
  }

  if (err instanceof ProcessingError) {
    return { surface: "processing", message: err.message, retryable: true };
  }

  if (err instanceof UploadAbortedError) {
    return {
      surface: "transfer",
      message: "The upload was stopped before it finished. Retry to start over.",
      retryable: true,
    };
  }

  if (err instanceof UploadPutError) {
    if (err.status === 0 && err.reason === "timeout") {
      return {
        surface: "transfer",
        message:
          "The upload stalled — no data moved for a while, so it was stopped. Check your connection and retry.",
        retryable: true,
      };
    }
    if (err.status === 0) {
      return {
        surface: "transfer",
        message:
          "The upload didn’t finish — the connection dropped or was blocked. Check your network and retry.",
        retryable: true,
      };
    }
    if (err.status === 403) {
      return {
        surface: "transfer",
        message:
          "The upload link expired before the file finished. Retry to get a fresh link.",
        retryable: true,
      };
    }
    return {
      surface: "transfer",
      message: `The upload failed (HTTP ${err.status}). Retry to start over.`,
      retryable: true,
    };
  }

  if (isApiError(err)) {
    const ref = err.correlationId ? ` (reference: ${err.correlationId})` : "";
    return { surface: "ticket", message: `${err.detail}${ref}`, retryable: true };
  }

  return {
    surface: "transfer",
    message: "Something went wrong with the upload. Retry to start over.",
    retryable: true,
  };
}
