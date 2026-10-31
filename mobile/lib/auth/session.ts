/* global __DEV__, console */
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
  // S9 confirmation pass (new finding): a prior wipe can still be draining in the
  // background past its own 3s bound (`wipeMediaCacheBounded`'s race just stops *awaiting*
  // it, it doesn't stop it running) — if fills reopened immediately, a fast subsequent
  // sign-in's brand-new fill could interleave with that still-running `deleteDatabaseFile`/
  // `deleteDir`, corrupting or losing the new user's own freshly-written cache entry. Join
  // whatever wipe is still pending (its own short, separate cap — this is belt-and-braces,
  // not the primary bound) before re-opening fills, so the common case (wipe already
  // finished well within 3s) pays nothing extra and only a genuinely slow wipe adds a
  // brief wait here.
  if (pendingWipe) {
    let joinTimeoutHandle: ReturnType<typeof setTimeout>;
    const joinTimeout = new Promise<void>((resolve) => {
      joinTimeoutHandle = setTimeout(resolve, MEDIA_CACHE_WIPE_JOIN_TIMEOUT_MS);
    });
    await Promise.race([pendingWipe, joinTimeout]).finally(() => clearTimeout(joinTimeoutHandle));
  }
  // S9 review (finding S1): a fresh sign-in re-opens media-cache fills that a prior
  // wipe closed (see `wipeMediaCacheBounded` below) — covers signIn(), register() and
  // every successful refreshAccessToken(). A lazy `require()`, not a static import, for
  // the same reason as the wipe below: this file carries no static dependency on the
  // cache's module graph. (A dynamic `import()` would be the ESM-native way to say this,
  // but this project's Jest config has no `--experimental-vm-modules`, so `import()`
  // throws under test — confirmed empirically, not assumed. `require()` is plain
  // CommonJS, still lazy at call time, and fully supported here.)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see comment above
    (require('../mediaCache/fill') as typeof import('../mediaCache/fill')).allowFillsAfterSignIn();
  } catch (err) {
    // Best-effort, same as the wipe — a failure here just means the next fill attempt
    // stays blocked until the following sign-in, never a crash. Gilfoyle re-check
    // SHOULD-FIX: a dev-only breadcrumb, since this failing silently means a device
    // could sign in "clean" while fills stay refused with zero signal anywhere.
    if (__DEV__) console.warn('[session] allowFillsAfterSignIn failed (fills stay blocked)', err);
  }
}

const MEDIA_CACHE_WIPE_TIMEOUT_MS = 3000;
const MEDIA_CACHE_WIPE_JOIN_TIMEOUT_MS = 2000;
const DOWNLOADS_WIPE_TIMEOUT_MS = 3000;

/** The real (unbounded) wipe, tracked so a subsequent sign-in can join it — see
 * `applyTokenPair`'s own comment. Cleared once the real wipe settles, not once
 * `wipeMediaCacheBounded`'s race settles (those are different moments: the race can
 * return early on the timeout side while this keeps running). */
let pendingWipe: Promise<void> | null = null;

/**
 * Bounded (S8/S9 review, finding S2): a hung SQLite/filesystem call inside the wipe must
 * never block sign-out itself. The real wipe keeps running in the background even after
 * this race settles on the timeout side — `clearMediaCache`'s own internals already
 * swallow every failure, so there's nothing left to await or clean up here (beyond what
 * `pendingWipe` lets a later sign-in join, above).
 */
function wipeMediaCacheBounded(): Promise<void> {
  const wipe = (async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see applyTokenPair's comment: import() throws under this project's Jest config
    const { clearMediaCache } = require('../mediaCache/clearMediaCache') as typeof import('../mediaCache/clearMediaCache');
    await clearMediaCache();
  })().catch((err: unknown) => {
    // Gilfoyle re-check SHOULD-FIX: this is the one failure mode that actually matters —
    // if `require()` itself throws (module load failure), the wipe never runs at all, not
    // degraded, just silently skipped, and `fillsBlocked` never gets set either. A dev-only
    // breadcrumb so that's visible somewhere rather than a device signing out "clean" while
    // the previous user's cache sits there unwiped.
    if (__DEV__) console.warn('[session] media cache wipe failed (cache may not have been cleared)', err);
  });
  pendingWipe = wipe;
  void wipe.finally(() => {
    if (pendingWipe === wipe) pendingWipe = null;
  });
  let timeoutHandle: ReturnType<typeof setTimeout>;
  // Cleared as soon as the wipe itself settles, so a quick wipe never leaves a dangling
  // 3s timer behind it (harmless in the app, but it kept test workers alive past exit).
  const timeout = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(resolve, MEDIA_CACHE_WIPE_TIMEOUT_MS);
  });
  return Promise.race([wipe, timeout]).finally(() => clearTimeout(timeoutHandle));
}

/**
 * Bounded like `wipeMediaCacheBounded` above, same reasoning — a sermon's downloaded
 * media file(s) can be large, and a hung filesystem call must never block sign-out. No
 * `pendingWipe`-style join on the next sign-in: unlike the media cache, nothing
 * auto-restarts a download after sign-in (every download is a deliberate tap), so there
 * is no "fresh fill interleaves with a still-draining wipe" race here to guard against.
 */
function wipeDownloadsBounded(): Promise<void> {
  const wipe = (async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see wipeMediaCacheBounded's comment: import() throws under this project's Jest config
    const { downloadManager } = require('../downloads/downloadManager') as typeof import('../downloads/downloadManager');
    await downloadManager.wipeAllDownloads();
  })().catch((err: unknown) => {
    if (__DEV__) console.warn('[session] downloads wipe failed (downloads may not have been cleared)', err);
  });
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(resolve, DOWNLOADS_WIPE_TIMEOUT_MS);
  });
  return Promise.race([wipe, timeout]).finally(() => clearTimeout(timeoutHandle));
}

async function clearSession(): Promise<void> {
  accessToken = null;
  refreshTokenCache = null;
  try {
    await secureStore.clearRefreshToken();
  } finally {
    // Plan S7 (HUMAN_GATE G2): reached by voluntary signOut() and both forced sign-out
    // paths below — a disposable cache must never survive into a different signed-in
    // user on the same device. In a `finally` (S8/S9 review, finding S2) so the wipe
    // still runs even if clearing the persisted refresh token above throws.
    await wipeMediaCacheBounded();
    // Same reasoning, a different disposable store: a sermon downloaded for offline
    // playback (and the DRM key reference on its row) is this viewer's own entitlement —
    // see `wipeDownloadsBounded`'s own comment.
    await wipeDownloadsBounded();
    // Same reasoning for the query cache: per-viewer reads (`me.*`, playlists, catalog
    // `locked` flags) carry no user id in their keys. Lazy `require()` for the same
    // reason as the wipe above.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- see applyTokenPair's comment
      await (require('../query/clearQueryCache') as typeof import('../query/clearQueryCache')).clearQueryCache();
    } catch (err) {
      if (__DEV__) console.warn('[session] query cache wipe failed (cache may not have been cleared)', err);
    }
  }
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
 * `/auth/register` returns the created user, not a token pair, and the new
 * account can't sign in until it confirms its email: the backend emails a
 * 6-digit code, which `verifyEmail()` below exchanges for a session. The
 * register screen sends the user to `/(auth)/verify-email` next.
 */
export async function register(email: string, password: string): Promise<void> {
  await authClient.register(email, password);
}

/** The sign-up code from the confirmation email, exchanged for a session. */
export async function verifyEmail(email: string, code: string): Promise<void> {
  const pair = await authClient.verifyEmail(email, code);
  await applyTokenPair(pair);
  setStatus('signedIn');
}

export function resendVerification(email: string): Promise<{ message: string }> {
  return authClient.resendVerification(email);
}

export function forgotPassword(email: string): Promise<{ message: string }> {
  return authClient.forgotPassword(email);
}

/**
 * Google/Apple sign-in-or-sign-up — same three-step shape `signIn()` above already
 * uses (fetch a token pair, apply it, flip status), just a different token-fetching call
 * at the front. A brand-new Google/Apple identity auto-creates an account server-side,
 * so there is no separate `registerWithGoogle`/`registerWithApple`.
 */
export async function signInWithGoogle(idToken: string): Promise<void> {
  const pair = await authClient.oauthGoogle(idToken);
  await applyTokenPair(pair);
  setStatus('signedIn');
}

export async function signInWithApple(
  identityToken: string,
  rawNonce: string,
  authorizationCode: string | null,
  givenName: string | null,
  familyName: string | null,
): Promise<void> {
  const pair = await authClient.oauthApple(identityToken, rawNonce, authorizationCode, givenName, familyName);
  await applyTokenPair(pair);
  setStatus('signedIn');
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
  try {
    // Revoke while the SDK can still find the account, so the next Google sign-in gets a
    // fresh ID token instead of the cached one the backend rejects as a replay.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see applyTokenPair's comment
    await (require('./googleSignIn') as typeof import('./googleSignIn')).forgetGoogleAccount();
  } catch (err) {
    if (__DEV__) console.warn('[session] forgetting the Google account failed', err);
  }
  setStatus('signedOut');
}

/**
 * After `POST /auth/me/delete` answered 204. The server already erased the account and
 * revoked every refresh token, so there is no logout call to make: tear the device down
 * exactly as a sign-out does (tokens, media cache, downloads, query cache), and also drop the
 * app's Google grant so the next Google sign-in starts from the account picker. Never throws:
 * the account is gone either way.
 */
export async function finishAccountDeletion(): Promise<void> {
  try {
    await clearSession();
  } catch (err) {
    if (__DEV__) console.warn('[session] clearing the session after deletion failed', err);
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see applyTokenPair's comment
    await (require('./googleSignIn') as typeof import('./googleSignIn')).forgetGoogleAccount();
  } catch (err) {
    if (__DEV__) console.warn('[session] forgetting the Google account failed', err);
  }
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
