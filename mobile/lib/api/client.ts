import * as session from '../auth/session';
import { apiUrl } from './config';
import { ApiError, apiErrorFromResponse, networkError } from './errors';

export interface ApiFetchInit extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /**
   * Whether to attach the bearer access token and, on a 401, funnel into the
   * single-flight refresh-and-retry. Defaults to `true`. The four public
   * auth endpoints don't go through this module at all (see
   * `lib/api/authClient.ts`'s own docstring for why) — this flag exists for
   * any other unauthenticated endpoint the data layer (W3.3) may add later.
   */
  auth?: boolean;
}

/**
 * The low-level authenticated fetch wrapper. This is intentionally the
 * foundation W3.3's typed client + TanStack Query hooks build on — no
 * caching, no query keys, no retry policy beyond the one 401-refresh retry
 * described below.
 *
 * On a 401 from an authenticated request, triggers
 * `session.refreshAccessToken()` (single-flight — concurrent 401s from
 * parallel requests share the one in-flight refresh) and retries the
 * original request exactly once with the new access token. If the refresh
 * itself fails, the session is already cleared and signed out by
 * `session.ts`; this rethrows so the caller can react (e.g. redirect to
 * sign-in via the root layout's status subscription).
 */
export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const { auth = true, body, headers, ...rest } = init;

  const doFetch = async (): Promise<Response> => {
    const requestHeaders = new Headers(headers);
    if (body !== undefined) requestHeaders.set('content-type', 'application/json');
    if (auth) {
      const token = session.getAccessToken();
      if (token) requestHeaders.set('authorization', `Bearer ${token}`);
    }
    try {
      return await fetch(apiUrl(path), {
        ...rest,
        headers: requestHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw networkError();
    }
  };

  let res = await doFetch();

  if (res.status === 401 && auth) {
    try {
      await session.refreshAccessToken();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw networkError();
    }
    res = await doFetch();
  }

  if (!res.ok) {
    throw await apiErrorFromResponse(res);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
