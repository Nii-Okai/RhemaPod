import { apiUrl } from './config';
import { apiErrorFromResponse, networkError } from './errors';
import type { TokenPair, UserPublic } from '../auth/types';

/**
 * Raw calls to the four public auth endpoints (`/auth/register`, `/auth/login`,
 * `/auth/refresh`, `/auth/forgot-password`) plus `/auth/logout`. Deliberately
 * separate from `lib/api/client.ts`'s authenticated `apiFetch`: these never
 * attach a bearer token and never trigger the 401-refresh-retry dance —
 * `session.ts`'s single-flight refresh calls `refresh()` here directly, and a
 * wrapper that could itself trigger a refresh would be circular.
 */

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw networkError();
  }
  if (!res.ok) {
    throw await apiErrorFromResponse(res);
  }
  return (await res.json()) as T;
}

export function register(email: string, password: string): Promise<UserPublic> {
  return post<UserPublic>('/auth/register', { email, password });
}

export function login(email: string, password: string): Promise<TokenPair> {
  return post<TokenPair>('/auth/login', { email, password });
}

export function refresh(refreshToken: string): Promise<TokenPair> {
  return post<TokenPair>('/auth/refresh', { refresh_token: refreshToken });
}

export function forgotPassword(email: string): Promise<{ message: string }> {
  return post<{ message: string }>('/auth/forgot-password', { email });
}

export async function logout(accessToken: string, refreshToken: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(apiUrl('/auth/logout'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    // Per-device logout is best-effort from the client's point of view — the
    // session is being torn down locally regardless (see session.ts signOut).
    return;
  }
  if (!res.ok && res.status !== 401) {
    // 401 here just means the session was already gone server-side; nothing
    // else is actionable from a sign-out button.
    throw await apiErrorFromResponse(res);
  }
}
