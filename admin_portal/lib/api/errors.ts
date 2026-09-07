/**
 * Typed error surface for the API client (plan §A.3, W3).
 *
 * The FastAPI backend answers every failure with a stable envelope
 * (`main.py` error handlers):
 *
 *   generic : { "detail": <string>, "correlation_id": <string | null> }
 *   422     : { "detail": "Validation failed",
 *               "errors": [{ "field", "message", "type" }, ...],
 *               "correlation_id": <string | null> }
 *
 * `correlation_id` is the support handle stamped on every log line for the
 * request — it is never dropped here. When the failure never reached FastAPI
 * (a BFF 502, an HTML error page, a dead connection) the body is not the
 * envelope; we still produce an `ApiError` with a sensible `detail` and a
 * null `correlationId` rather than leaking the raw wrapper shape.
 */

export interface FieldError {
  field: string;
  message: string;
  type: string;
}

/** The backend error envelope, as it appears on the wire. */
export interface ErrorEnvelope {
  detail?: unknown;
  errors?: unknown;
  correlation_id?: unknown;
}

const DEFAULT_MESSAGES: Record<number, string> = {
  400: "Bad request",
  401: "Not authenticated",
  403: "Not permitted",
  404: "Not found",
  409: "Conflict",
  422: "Validation failed",
  429: "Too many requests",
  503: "Service temporarily unavailable",
};

function defaultMessageFor(status: number): string {
  if (DEFAULT_MESSAGES[status]) return DEFAULT_MESSAGES[status];
  if (status >= 500) return "Server error";
  if (status >= 400) return "Request failed";
  return "Unexpected response";
}

function isFieldError(value: unknown): value is FieldError {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.field === "string" &&
    typeof v.message === "string" &&
    typeof v.type === "string"
  );
}

function asEnvelope(body: unknown): ErrorEnvelope {
  return body && typeof body === "object" ? (body as ErrorEnvelope) : {};
}

/**
 * A non-2xx response, thrown by the client so callers get a typed rejection.
 * React Query and `try/catch` sites both see an `ApiError`, never openapi-fetch's
 * `{ data, error }` union.
 */
export class ApiError extends Error {
  /** HTTP status of the failed response. */
  readonly status: number;
  /** `detail` from the envelope, or a status-derived fallback. Also `message`. */
  readonly detail: string;
  /** `correlation_id` from the envelope — the support handle. `null` if absent. */
  readonly correlationId: string | null;
  /** Field-level errors from a 422, else `null`. */
  readonly fieldErrors: FieldError[] | null;
  /** The parsed response body, verbatim, for logging / debugging. */
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    const env = asEnvelope(body);
    const detail =
      typeof env.detail === "string" && env.detail.length > 0
        ? env.detail
        : defaultMessageFor(status);

    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.correlationId =
      typeof env.correlation_id === "string" ? env.correlation_id : null;
    this.fieldErrors = Array.isArray(env.errors)
      ? env.errors.filter(isFieldError)
      : null;
    this.body = body;

    // Restore the prototype chain for `instanceof` across the TS/ES target gap.
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** True when the backend rejected the request body with field-level errors. */
  get isValidation(): boolean {
    return this.status === 422 && (this.fieldErrors?.length ?? 0) > 0;
  }

  /** `{ field: message }` for binding 422 errors onto a form. */
  fieldErrorMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const fe of this.fieldErrors ?? []) {
      map[fe.field] ??= fe.message;
    }
    return map;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/**
 * Read a response body without assuming it is JSON. Returns the parsed object
 * when it parses, the raw string when it does not, and `undefined` for an
 * empty body. Never throws.
 */
export async function parseErrorBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
