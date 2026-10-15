/**
 * Single-flight refresh is the core requirement of W3.2 (plan §A.3 #6): a
 * cold Home screen fires several queries at once, and if the access token
 * is expired, each of those 401s must funnel into exactly one
 * `/auth/refresh` call, not one per caller.
 */
import * as SecureStore from 'expo-secure-store';
import * as authClient from '../../api/authClient';
import { ApiError } from '../../api/errors';
import { clearMediaCache } from '../../mediaCache/clearMediaCache';
import * as fill from '../../mediaCache/fill';
import * as session from '../session';

jest.mock('expo-secure-store', () => {
  let store: Record<string, string> = {};
  return {
    AFTER_FIRST_UNLOCK: 'afterFirstUnlock',
    getItemAsync: jest.fn(async (key: string) => store[key] ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      delete store[key];
    }),
    __reset: () => {
      store = {};
    },
  };
});

jest.mock('../../api/authClient', () => ({
  login: jest.fn(),
  register: jest.fn(),
  refresh: jest.fn(),
  forgotPassword: jest.fn(),
  logout: jest.fn(),
}));

// `session.ts` reaches `clearMediaCache` via a lazy `require()` inside `clearSession()`
// (plan S7; made lazy at the S8/S9 re-check to sever a circular import, so this module is
// no longer pulled in at require time regardless of this mock). Still mocked wholesale
// here — not to avoid a crash, but because this suite needs to assert `clearMediaCache`
// gets *called* on each `clearSession()` path without exercising the cache's real
// SQLite/filesystem internals, same as it always did.
jest.mock('../../mediaCache/clearMediaCache', () => ({ clearMediaCache: jest.fn().mockResolvedValue(undefined) }));

const mockedAuthClient = authClient as jest.Mocked<typeof authClient>;
const mockedClearMediaCache = clearMediaCache as jest.Mock;
const mockedSecureStore = SecureStore as unknown as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
  __reset: () => void;
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockedSecureStore.__reset();
  // signOut() is a safe no-op-ish reset even when nothing is signed in yet
  // (it skips the network logout call when there's no token pair, and always
  // clears in-memory + persisted state) — used here to give every test a
  // clean session.ts starting point without a test-only reset export.
  await session.signOut();
  jest.clearAllMocks();
});

describe('session single-flight refresh', () => {
  it('funnels N concurrent refreshAccessToken() calls into exactly one authClient.refresh() call', async () => {
    mockedAuthClient.login.mockResolvedValueOnce({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 900,
    });
    await session.signIn('user@example.com', 'password123456');

    let resolveRefresh: (value: { access_token: string; refresh_token: string; expires_in: number }) => void;
    const pending = new Promise<{ access_token: string; refresh_token: string; expires_in: number }>((resolve) => {
      resolveRefresh = resolve;
    });
    mockedAuthClient.refresh.mockReturnValueOnce(pending);

    const CONCURRENT_CALLERS = 5;
    const calls = Array.from({ length: CONCURRENT_CALLERS }, () => session.refreshAccessToken());

    // Let every caller reach and start awaiting the shared in-flight promise
    // before it resolves, the way N concurrent 401 handlers actually would.
    await Promise.resolve();
    await Promise.resolve();

    resolveRefresh!({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 900 });

    const results = await Promise.all(calls);

    expect(mockedAuthClient.refresh).toHaveBeenCalledTimes(1);
    expect(mockedAuthClient.refresh).toHaveBeenCalledWith('refresh-1');
    for (const result of results) {
      expect(result).toBe('access-2');
    }
    expect(session.getAccessToken()).toBe('access-2');
    expect(mockedSecureStore.setItemAsync).toHaveBeenLastCalledWith(
      expect.any(String),
      'refresh-2',
      expect.objectContaining({ requireAuthentication: false }),
    );
  });

  it('starts a fresh refresh call once a previous one has fully settled (not a permanently-shared promise)', async () => {
    mockedAuthClient.login.mockResolvedValueOnce({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 900,
    });
    await session.signIn('user@example.com', 'password123456');

    mockedAuthClient.refresh
      .mockResolvedValueOnce({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 900 })
      .mockResolvedValueOnce({ access_token: 'access-3', refresh_token: 'refresh-3', expires_in: 900 });

    await session.refreshAccessToken();
    await session.refreshAccessToken();

    expect(mockedAuthClient.refresh).toHaveBeenCalledTimes(2);
  });

  it('signs the session out and rejects every waiting caller on a genuine auth rejection (non-network ApiError)', async () => {
    mockedAuthClient.login.mockResolvedValueOnce({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 900,
    });
    await session.signIn('user@example.com', 'password123456');

    let rejectRefresh: (err: Error) => void;
    const pending = new Promise<{ access_token: string; refresh_token: string; expires_in: number }>((_, reject) => {
      rejectRefresh = reject;
    });
    mockedAuthClient.refresh.mockReturnValueOnce(pending);

    const calls = Array.from({ length: 3 }, () => session.refreshAccessToken().catch((err) => err as Error));

    await Promise.resolve();
    await Promise.resolve();
    // network defaults to false — a real 401 from the refresh endpoint itself,
    // not a dropped connection.
    rejectRefresh!(new ApiError(401, 'Invalid or expired refresh token'));

    const results = await Promise.all(calls);

    expect(mockedAuthClient.refresh).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result).toBeInstanceOf(ApiError);
    }
    expect(session.getAccessToken()).toBeNull();
    expect(session.getStatus()).toBe('signedOut');
    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalled();
  });

  it('leaves the persisted session untouched and rethrows on a network failure (does not sign out)', async () => {
    mockedAuthClient.login.mockResolvedValueOnce({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 900,
    });
    await session.signIn('user@example.com', 'password123456');
    mockedSecureStore.setItemAsync.mockClear();
    mockedSecureStore.deleteItemAsync.mockClear();

    let rejectRefresh: (err: Error) => void;
    const pending = new Promise<{ access_token: string; refresh_token: string; expires_in: number }>((_, reject) => {
      rejectRefresh = reject;
    });
    mockedAuthClient.refresh.mockReturnValueOnce(pending);

    const calls = Array.from({ length: 3 }, () => session.refreshAccessToken().catch((err) => err as Error));

    await Promise.resolve();
    await Promise.resolve();
    // e.g. a subway/elevator wifi blip — the request never reached the
    // server, so this says nothing about whether refresh-1 is still valid.
    rejectRefresh!(new ApiError(0, 'Could not reach the server. Check your connection.', null, true));

    const results = await Promise.all(calls);

    expect(mockedAuthClient.refresh).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result).toBeInstanceOf(ApiError);
      expect((result as ApiError).network).toBe(true);
    }
    // Session survives the network blip: access token, in-memory refresh
    // token, and persisted refresh token are all untouched.
    expect(session.getAccessToken()).toBe('access-1');
    expect(session.getStatus()).toBe('signedIn');
    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });
});

describe('session access-token storage', () => {
  it('never persists the access token to expo-secure-store', async () => {
    mockedAuthClient.login.mockResolvedValueOnce({
      access_token: 'super-secret-access-token',
      refresh_token: 'refresh-1',
      expires_in: 900,
    });
    await session.signIn('user@example.com', 'password123456');

    for (const call of mockedSecureStore.setItemAsync.mock.calls) {
      expect(call[1]).not.toBe('super-secret-access-token');
    }
    expect(session.getAccessToken()).toBe('super-secret-access-token');
  });

  it('signOut clears the persisted refresh token and calls per-device logout, not a global one', async () => {
    mockedAuthClient.login.mockResolvedValueOnce({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 900,
    });
    await session.signIn('user@example.com', 'password123456');

    mockedAuthClient.logout.mockResolvedValueOnce(undefined);
    await session.signOut();

    // Per-device: the refresh token identifying *this* session's sid is what
    // gets sent, not a bulk "log out everywhere" call.
    expect(mockedAuthClient.logout).toHaveBeenCalledWith('access-1', 'refresh-1');
    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalled();
    expect(session.getAccessToken()).toBeNull();
    expect(session.getStatus()).toBe('signedOut');
    // Plan S7, HUMAN_GATE G2: every clearSession() path wipes the media cache too.
    expect(mockedClearMediaCache).toHaveBeenCalled();
  });

  it('a genuine auth rejection during refresh also wipes the media cache (the other forced sign-out path)', async () => {
    mockedAuthClient.login.mockResolvedValueOnce({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 900,
    });
    await session.signIn('user@example.com', 'password123456');

    mockedAuthClient.refresh.mockRejectedValueOnce(new ApiError(401, 'Invalid or expired refresh token'));
    await expect(session.refreshAccessToken()).rejects.toBeInstanceOf(ApiError);

    expect(mockedClearMediaCache).toHaveBeenCalled();
  });
});

describe('session S7 — media cache wipe on every clearSession() path', () => {
  it('the no-refresh-token forced path (refreshAccessToken with nothing stored) also wipes the media cache', async () => {
    await expect(session.refreshAccessToken()).rejects.toBeInstanceOf(ApiError);
    expect(mockedClearMediaCache).toHaveBeenCalled();
  });

  it('a throwing clearMediaCache never stops the tokens from being cleared', async () => {
    mockedAuthClient.login.mockResolvedValueOnce({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 900,
    });
    await session.signIn('user@example.com', 'password123456');

    mockedClearMediaCache.mockRejectedValueOnce(new Error('wipe failed'));

    await expect(session.signOut()).resolves.toBeUndefined();

    expect(session.getAccessToken()).toBeNull();
    expect(session.getStatus()).toBe('signedOut');
    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalled();
  });

  it('a fresh sign-in re-opens media-cache fills via allowFillsAfterSignIn (S9 finding S1 wiring)', async () => {
    // `fill.ts` is no longer mocked here at all (the circular-import fix means it carries
    // no native dependency), so its real `allowFillsAfterSignIn` can be spied on directly —
    // Gilfoyle re-check's own suggestion, closing the "verified by manual trace only" gap.
    const spy = jest.spyOn(fill, 'allowFillsAfterSignIn');

    mockedAuthClient.login.mockResolvedValueOnce({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 900 });
    await session.signIn('user@example.com', 'password123456');
    expect(spy).toHaveBeenCalledTimes(1);

    mockedAuthClient.refresh.mockResolvedValueOnce({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 900 });
    await session.refreshAccessToken();
    expect(spy).toHaveBeenCalledTimes(2);

    spy.mockRestore();
  });

  it('applyTokenPair joins a still-draining prior wipe before re-opening fills, bounded by its own short cap', async () => {
    const callOrder: string[] = [];
    let resolveWipe!: () => void;
    mockedClearMediaCache.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveWipe = resolve)));
    mockedAuthClient.login.mockResolvedValueOnce({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 900 });
    await session.signIn('user@example.com', 'password123456');

    const spy = jest.spyOn(fill, 'allowFillsAfterSignIn').mockImplementation(() => {
      callOrder.push('allowFillsAfterSignIn');
    });
    await session.signOut(); // starts the (slow, not-yet-resolved) wipe

    mockedAuthClient.login.mockResolvedValueOnce({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 900 });
    const signInPromise = session.signIn('user2@example.com', 'password123456').then(() => {
      callOrder.push('signInResolved');
    });

    // Let the sign-in's own promise chain actually reach the join point (login resolves
    // instantly, saveRefreshToken resolves instantly, so a couple of microtask ticks is
    // enough) before resolving the wipe — proves the ORDER below demonstrates the join,
    // not coincidence.
    await Promise.resolve();
    await Promise.resolve();
    callOrder.push('aboutToResolveWipe');
    resolveWipe();
    await signInPromise;

    expect(callOrder).toEqual(['aboutToResolveWipe', 'allowFillsAfterSignIn', 'signInResolved']);
    spy.mockRestore();
  });
});

describe('session bootstrap', () => {
  it('resolves signedOut with no refresh call when no refresh token is stored', async () => {
    const status = await session.bootstrap();
    expect(status).toBe('signedOut');
    expect(mockedAuthClient.refresh).not.toHaveBeenCalled();
  });

  it('refreshes once using a stored refresh token and resolves signedIn on success', async () => {
    await mockedSecureStore.setItemAsync('rhemapod.refreshToken', 'stored-refresh');
    mockedAuthClient.refresh.mockResolvedValueOnce({
      access_token: 'access-fresh',
      refresh_token: 'refresh-fresh',
      expires_in: 900,
    });

    const status = await session.bootstrap();

    expect(status).toBe('signedIn');
    expect(mockedAuthClient.refresh).toHaveBeenCalledWith('stored-refresh');
    expect(session.getAccessToken()).toBe('access-fresh');
  });

  it('resolves signedOut when the stored refresh token is rejected', async () => {
    await mockedSecureStore.setItemAsync('rhemapod.refreshToken', 'stale-refresh');
    mockedAuthClient.refresh.mockRejectedValueOnce(new ApiError(401, 'Invalid or expired refresh token'));

    const status = await session.bootstrap();

    expect(status).toBe('signedOut');
    expect(session.getAccessToken()).toBeNull();
    expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalled();
  });

  it('resolves signedIn without clearing the stored refresh token when the cold-start refresh fails on a network error', async () => {
    await mockedSecureStore.setItemAsync('rhemapod.refreshToken', 'stored-refresh');
    mockedAuthClient.refresh.mockRejectedValueOnce(
      new ApiError(0, 'Could not reach the server. Check your connection.', null, true),
    );

    const status = await session.bootstrap();

    // Optimistic: a wifi blip on app open must not force the user back
    // through sign-in — the persisted refresh token is presumed still valid
    // and untouched. There's no fresh access token yet; the first
    // authenticated request will trigger client.ts's own 401-refresh-retry
    // once connectivity returns.
    expect(status).toBe('signedIn');
    expect(session.getAccessToken()).toBeNull();
    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(await mockedSecureStore.getItemAsync('rhemapod.refreshToken')).toBe('stored-refresh');
  });

  it('resolves signedOut (not stuck on loading) when SecureStore itself throws reading the stored token', async () => {
    mockedSecureStore.getItemAsync.mockRejectedValueOnce(new Error('Keychain unavailable'));

    const status = await session.bootstrap();

    expect(status).toBe('signedOut');
    expect(mockedAuthClient.refresh).not.toHaveBeenCalled();
    expect(mockedSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });
});
