/**
 * Typed failure surfaces for the upload pipeline (plan §A.5 — "surfaces every
 * failure distinctly").
 *
 * Six places an upload can die, each with its own copy:
 *
 *   1. validation   — pre-flight type/size reject (no ticket issued)
 *   2. ticket       — POST …/upload-url failed (4xx/5xx from FastAPI)
 *   3. transfer/net — the PUT itself: network drop or CORS block (xhr.status 0)
 *   4. transfer/403 — the PUT: the presigned URL expired (xhr.status 403)
 *   5. confirm      — POST …/confirm failed, incl. the 413 oversized re-check
 *   6. poll-failed  — the job polled to `failed`; show its raw `error_message`
 *
 * `describeUploadFailure` maps a thrown error to `{ surface, message }`. The
 * message for surface 6 is the server's `error_message` verbatim (design: "the
 * raw `error_message` in Plex Mono rose").
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
 *   0   → network error / CORS block / connection dropped
 *   403 → the presigned URL expired (or a signature mismatch)
 *   else → some other non-2xx from the object store
 */
export class UploadPutError extends Error {
  readonly surface = "transfer" as const;
  readonly status: number;
  readonly bodySnippet: string;
  constructor(status: number, bodySnippet = "") {
    super(`upload PUT failed (status ${status})`);
    this.name = "UploadPutError";
    this.status = status;
    this.bodySnippet = bodySnippet.slice(0, 500);
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
}

/**
 * Collapse any error thrown along the pipeline into the `{ surface, message }`
 * a Failed row renders. Unknown errors fall through to a generic transfer
 * message rather than leaking a stack.
 */
export function describeUploadFailure(err: unknown): UploadFailure {
  if (err instanceof UploadValidationError) {
    return { surface: "validation", message: err.message };
  }

  if (err instanceof TicketError) {
    return { surface: "ticket", message: err.message };
  }

  if (err instanceof ConfirmError) {
    if (err.status === 413) {
      return {
        surface: "confirm",
        message: `File is larger than the ${MAX_UPLOAD_GB} GB limit.`,
      };
    }
    return { surface: "confirm", message: err.message };
  }

  if (err instanceof UploadPutError) {
    if (err.status === 0) {
      return {
        surface: "transfer",
        message:
          "The upload didn’t finish — the connection dropped or was blocked. Check your network and retry.",
      };
    }
    if (err.status === 403) {
      return {
        surface: "transfer",
        message:
          "The upload link expired before the file finished. Retry to get a fresh link.",
      };
    }
    return {
      surface: "transfer",
      message: `The upload failed (HTTP ${err.status}). Retry to start over.`,
    };
  }

  if (isApiError(err)) {
    const ref = err.correlationId ? ` (reference: ${err.correlationId})` : "";
    return { surface: "ticket", message: `${err.detail}${ref}` };
  }

  return {
    surface: "transfer",
    message: "Something went wrong with the upload. Retry to start over.",
  };
}
