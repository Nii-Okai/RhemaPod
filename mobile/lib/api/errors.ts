/**
 * The backend's error envelope (main.py `_error_body`): every non-2xx JSON
 * response is `{ detail: string, correlation_id: string | null }`.
 */
export interface ApiErrorBody {
  detail?: string;
  correlation_id?: string | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly correlationId: string | null;
  /** True when the request never reached the server (offline, DNS, timeout). */
  readonly network: boolean;
  /** `Retry-After` header value, when the backend sent one (429s). */
  retryAfter: string | null = null;

  constructor(
    status: number,
    detail: string,
    correlationId: string | null = null,
    network = false,
  ) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.correlationId = correlationId;
    this.network = network;
  }
}

export function networkError(): ApiError {
  return new ApiError(0, 'Could not reach the server. Check your connection.', null, true);
}

/** The one user-facing message for any caught fetch error — an `ApiError`'s own
 * `message` (already server-provided or `networkError`'s copy) if it is one, else a
 * generic fallback. Shared by `QueryState`, Home's own shelves, and the Library tab's
 * "Continue watching" shelf — previously three separately hand-written copies of the
 * same two-line function. */
export function userMessageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Try again.';
}

export async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  const retryAfter = res.headers.get('retry-after');
  const detail =
    body?.detail ??
    (res.status === 429 ? 'Too many requests. Try again shortly.' : 'Something went wrong. Try again.');
  const err = new ApiError(res.status, detail, body?.correlation_id ?? null);
  err.retryAfter = retryAfter;
  return err;
}
