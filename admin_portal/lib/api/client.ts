/**
 * Typed API client (plan §A.3 / §A.4, W3).
 *
 * The browser never talks to FastAPI. Every call goes same-origin to the Next
 * BFF at `/api/bff`, which attaches the bearer token and forwards to the
 * backend (the proxy itself is W4). This module therefore knows exactly one
 * URL — `/api/bff` — and nothing about where FastAPI lives.
 *
 * Two middlewares wrap `openapi-fetch`:
 *
 *  1. `stripBackendMount` — the generated `schema.d.ts` keys the backend's
 *     mount prefix (`/api/v1/...`) into every path. Per §A.2 the browser
 *     addresses the proxy as `/api/bff/<path>` and the BFF re-adds `/api/v1`.
 *     So we send fully-typed schema paths and rewrite the wire URL down to
 *     `/api/bff/<path>` on the way out.
 *
 *  2. `throwOnError` — openapi-fetch normally returns `{ data, error }`. We
 *     want a typed rejection instead: on any non-2xx this throws `ApiError`
 *     (carrying `status`, `detail`, `correlationId`, field errors), which is
 *     what React Query and `try/catch` sites expect.
 */

import createClient, { type Client, type Middleware } from "openapi-fetch";

import { ApiError, parseErrorBody } from "./errors";
import type { paths } from "./schema";

/** The only URL this layer knows. Same-origin; resolved by the browser. */
export const BFF_BASE_URL = "/api/bff";

/** Backend mount prefix baked into every generated schema path. */
const BACKEND_MOUNT_PREFIX = "/api/v1/";

const stripBackendMount: Middleware = {
  async onRequest({ request }) {
    const url = new URL(request.url);
    const rewritten = url.pathname.replace(BACKEND_MOUNT_PREFIX, "/");
    if (rewritten === url.pathname) return undefined;
    url.pathname = rewritten;
    // Re-issue against the rewritten URL. The body MUST be buffered, not
    // forwarded as a stream: `new Request(url, requestWithUnconsumedBody)`
    // produces a streaming-body request, and Chromium then requires HTTP/2 for
    // the upload — which fails ALPN against a plaintext (dev) origin
    // (`net::ERR_ALPN_NEGOTIATION_FAILED` / "Failed to fetch"). A buffered body
    // sends as an ordinary request over HTTP/1.1. JSON payloads only here, so
    // buffering is cheap. (W9 — this is the first browser POST-with-body path.)
    const method = request.method.toUpperCase();
    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : await request.arrayBuffer();
    return new Request(url, {
      method: request.method,
      headers: request.headers,
      body,
      credentials: request.credentials,
      redirect: request.redirect,
      signal: request.signal,
    });
  },
};

const throwOnError: Middleware = {
  async onResponse({ response }) {
    if (response.ok) return undefined;
    const body = await parseErrorBody(response.clone());
    throw new ApiError(response.status, body);
  },
};

export type ApiClient = Client<paths>;

export interface CreateApiClientOptions {
  /**
   * Base URL for the BFF. Defaults to the same-origin `/api/bff`. Tests pass an
   * absolute origin (e.g. `http://localhost/api/bff`) so `fetch` can resolve it
   * outside a browser.
   */
  baseUrl?: string;
}

export function createApiClient(
  options: CreateApiClientOptions = {},
): ApiClient {
  const client = createClient<paths>({
    baseUrl: options.baseUrl ?? BFF_BASE_URL,
    // Late-bind `fetch` instead of letting openapi-fetch freeze
    // `globalThis.fetch` at construction. The `api` singleton is built at
    // module load; this keeps it honouring any later replacement of the global
    // (MSW in tests, instrumentation) rather than a stale reference.
    fetch: (input) => globalThis.fetch(input),
  });
  client.use(stripBackendMount);
  client.use(throwOnError);
  return client;
}

/** Shared browser-side client. */
export const api: ApiClient = createApiClient();

/**
 * Narrow an `openapi-fetch` call to its success payload.
 *
 * Safe only with a client built by {@link createApiClient}: `throwOnError`
 * guarantees a rejection on every non-2xx, so a resolved promise always carries
 * `data`. Use this in query functions to return the typed body directly.
 */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown }>,
): Promise<T> {
  const { data } = await call;
  return data as T;
}
