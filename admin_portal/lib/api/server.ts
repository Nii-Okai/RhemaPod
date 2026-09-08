/**
 * Server-side typed API client (plan §A.3 — the variant W3 deferred).
 *
 * Same `openapi-fetch` wrapper as the browser client, but pointed straight at
 * FastAPI (`${API_BASE_URL}/api/v1`) instead of the same-origin `/api/bff`
 * proxy, and it injects `Authorization: Bearer <rp_at>` from the request's
 * httpOnly cookie. Used by RSC (the `/auth/me` session bootstrap) and by the
 * auth route handlers' follow-up calls.
 *
 * It also forwards the real client IP as a single validated `X-Forwarded-For`
 * (plan §A.10) so the backend rate limiter keys per staff member, not per BFF
 * instance. The IP comes only from the configured trusted header
 * (`CLIENT_IP_HEADER`) — never an inbound proxy header the browser could have
 * set — via `clientIpFromHeaders`; with no request scope, no trusted header
 * configured, or a non-IP value, it is simply omitted and the backend falls
 * back to the BFF peer IP.
 *
 * `lib/api/` layering is intact: this reuses `createApiClient` and only adds
 * middleware on top of its `stripBackendMount` + `throwOnError`.
 */

import { cookies, headers } from "next/headers";
import type { Middleware } from "openapi-fetch";

import { clientIpFromHeaders, setForwardedFor } from "@/lib/auth/client-ip";
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

function forwardedForMiddleware(clientIp: string): Middleware {
  return {
    onRequest({ request }) {
      setForwardedFor(request.headers, clientIp);
      return request;
    },
  };
}

/** The current request's real client IP, or `null` outside a request scope. */
async function currentClientIp(): Promise<string | null> {
  try {
    return clientIpFromHeaders(await headers());
  } catch {
    return null;
  }
}

/**
 * Build a server-side client. Pass an explicit `token` (e.g. a freshly minted
 * access token in the login route) or omit it to read `rp_at` from the current
 * request's cookies. Pass `clientIp` to override the header-derived value.
 */
export async function createServerApiClient(
  token?: string,
  clientIp?: string | null,
): Promise<ApiClient> {
  const accessToken =
    token ?? (await cookies()).get(AT_COOKIE)?.value ?? undefined;
  const ip = clientIp !== undefined ? clientIp : await currentClientIp();

  const client = createApiClient({
    baseUrl: `${API_BASE_URL}${BACKEND_API_PREFIX}`,
  });
  client.use(bearerMiddleware(accessToken));
  if (ip) client.use(forwardedForMiddleware(ip));
  return client;
}
