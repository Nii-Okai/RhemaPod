import * as authClient from '../api/authClient';
import { ApiError } from '../api/errors';
import * as secureStore from './secureStore';
import type { AuthStatus, TokenPair } from './types';

/**
 * The single source of truth for the device's auth session. Deliberately a
 * plain module (not a React context) so `lib/api/client.ts` — a non-React,
 * low-level fetch wrapper — can read/refresh the access token without a
 * dependency on the component tree. `lib/auth/AuthContext.tsx` is a thin
 * React mirror of this module's status, for screens and the root redirect.
 *
 * Storage split (plan L12):
 *  - Access token: `accessToken` below, memory only. Never passed to
 *    `secureStore.ts` / `expo-secure-store`, never to `AsyncStorage`.
 *  - Refresh token: persisted via `secureStore.ts` (`requireAuthentication`
 *    off), cached here in memory too purely to avoid an async storage read
 *    on every single request.
 */

let accessToken: string | null = null;
let refreshTokenCache: string | null = null;
let status: AuthStatus = 'loading';

type Listener = (status: AuthStatus) => void;
const listeners = new Set<Listener>();

function setStatus(next: AuthStatus): void {
  if (status === next) return;
  status = next;
  for (const listener of listeners) listener(status);
}

export function getStatus(): AuthStatus {
  return status;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function applyTokenPair(pair: TokenPair): Promise<void> {
  accessToken = pair.access_token;
  refreshTokenCache = pair.refresh_token;
  await secureStore.saveRefreshToken(pair.refresh_token);
}

async function clearSession(): Promise<void> {
  accessToken = null;
  refreshTokenCache = null;
  await secureStore.clearRefreshToken();
}

/**
 * Called once at app start. Resolves once we know whether the device has a
 * usable session — a cold start never has an access token (it is never
 * persisted), so if a refresh token exists this performs one refresh to
 * obtain a fresh access token before the app can be considered signed in.
 *
 * Callers (`AuthContext.tsx`) invoke this fire-and-forget (`void
 * session.bootstrap()`), so this must never reject and must never leave
 * `status` stuck at `loading` — either of those hangs the app on the launch
 * spinner with no recovery path.
 */
export async function bootstrap(): Promise<AuthStatus> {
  let stored: string | null;
  try {
    stored = await secureStore.loadRefreshToken();
  } catch {
    // SecureStore/Keychain itself failed to read (not a network condition —
    // see the `refreshAccessToken()` catch below for that case). We don't
    // know whether a refresh token exists, so nothing persisted is touched;
    // fall through to signedOut so the UI can recover via a normal sign-in
    // rather than hang on `loading` forever.
    setStatus('signedOut');
    return status;
  }

  if (!stored) {
    setStatus('signedOut');
    return status;
  }
  refreshTokenCache = stored;
  try {
    await refreshAccessToken();
  } catch (err) {
    if (err instanceof ApiError && err.network) {
      // The request never reached the server — the persisted refresh token
      // is untouched (refreshAccessToken() itself left it alone on a network
      // failure) and still presumed valid. Resolve signedIn optimistically
      // rather than bouncing the user to sign-in on a wifi blip at app open;
      // there's no access token yet, but the first authenticated request
      // will hit `client.ts`'s own 401-triggered refresh-and-retry once
      // connectivity returns (the existing reactive-refresh design).
      setStatus('signedIn');
    }
    // Any other failure here is a genuine auth rejection, already handled by
    // refreshAccessToken() itself (clearSession() + signedOut) — nothing
    // further to do for that case.
  }
  return status;
}

export async function signIn(email: string, password: string): Promise<void> {
  const pair = await authClient.login(email, password);
  await applyTokenPair(pair);
  setStatus('signedIn');
}

/**
 * `/auth/register` returns the created user, not a token pair — this signs
 * in immediately after so registration reads as one action to the user, the
 * same flow the design spec's "self-registration" screen implies.
 */
export async function register(email: string, password: string): Promise<void> {
  await authClient.register(email, password);
  await signIn(email, password);
}

export function forgotPassword(email: string): Promise<{ message: string }> {
  return authClient.forgotPassword(email);
}

export async function signOut(): Promise<void> {
  const at = accessToken;
  const rt = refreshTokenCache;
  // Best-effort per-device revoke — never all-devices (auth.py's logout is
  // per-session by sid; see plan §A.3 #4). Local session is torn down either
  // way, so a network failure here must not block sign-out.
  if (at && rt) {
    try {
      await authClient.logout(at, rt);
    } catch {
      // swallow — see authClient.logout's own comment
    }
  }
  await clearSession();
  setStatus('signedOut');
}

/**
 * Single-flight refresh (plan §A.3 #6 / W3.2's core requirement). Concurrent
 * callers — e.g. several 401s from `lib/api/client.ts` fired by a cold
 * Home screen's parallel queries — must share exactly one in-flight
 * `/auth/refresh` call, not each issue their own. A second, independent
 * `refreshAccessToken()` call while one is already in flight returns the
 * same promise instead of starting a new request.
 */
let refreshPromise: Promise<string> | null = null;

export function refreshAccessToken(): Promise<string> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const rt = refreshTokenCache ?? (await secureStore.loadRefreshToken());
    if (!rt) {
      await clearSession();
      setStatus('signedOut');
      throw new ApiError(401, 'No session to refresh.');
    }
    try {
      const pair = await authClient.refresh(rt);
      await applyTokenPair(pair);
      setStatus('signedIn');
      return pair.access_token;
    } catch (err) {
      if (err instanceof ApiError && err.network) {
        // The refresh request never reached the server — this says nothing
        // about whether the refresh token itself is still valid. Leave the
        // persisted/in-memory session untouched and let the caller decide
        // (retry, surface a "check your connection" state); only a genuine
        // auth rejection below is grounds to sign the device out.
        throw err;
      }
      await clearSession();
      setStatus('signedOut');
      throw err;
    }
  })();

  return refreshPromise.finally(() => {
    refreshPromise = null;
  });
}
