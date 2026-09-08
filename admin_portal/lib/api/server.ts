/**
 * Server-side typed API client (plan §A.3 — the variant W3 deferred).
 *
 * Same `openapi-fetch` wrapper as the browser client, but pointed straight at
 * FastAPI (`${API_BASE_URL}/api/v1`) instead of the same-origin `/api/bff`
 * proxy, and it injects `Authorization: Bearer <rp_at>` from the request's
 * httpOnly cookie. Used by RSC (the `/auth/me` session bootstrap) and by the
 * auth route handlers' follow-up calls.
 *
 * `lib/api/` layering is intact: this reuses `createApiClient` and only adds an
 * auth middleware on top of its `stripBackendMount` + `throwOnError`.
 */

import { cookies } from "next/headers";
import type { Middleware } from "openapi-fetch";

import { API_BASE_URL, BACKEND_API_PREFIX } from "@/lib/auth/config";
import { AT_COOKIE } from "@/lib/auth/cookies";

import { createApiClient, type ApiClient } from "./client";

function bearerMiddleware(token: string | undefined): Middleware {
  return {
    onRequest({ request }) {
      if (token) request.headers.set("authorization", `Bearer ${token}`);
      return request;
    },
  };
}

/**
 * Build a server-side client. Pass an explicit `token` (e.g. a freshly minted
 * access token in the login route) or omit it to read `rp_at` from the current
 * request's cookies.
 */
export async function createServerApiClient(token?: string): Promise<ApiClient> {
  const accessToken =
    token ?? (await cookies()).get(AT_COOKIE)?.value ?? undefined;

  const client = createApiClient({
    baseUrl: `${API_BASE_URL}${BACKEND_API_PREFIX}`,
  });
  client.use(bearerMiddleware(accessToken));
  return client;
}
