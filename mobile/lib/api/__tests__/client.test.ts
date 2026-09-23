/**
 * Integration-level proof of the plan's own framing (§A.3 #6): "A cold Home
 * screen fires several queries at once" — several concurrent `apiFetch`
 * calls, not several concurrent direct `refreshAccessToken()` calls. Uses
 * the real `session.ts` (only its own dependencies — `authClient` and
 * `expo-secure-store` — are mocked) so this exercises the actual
 * apiFetch → 401 → session.refreshAccessToken() → retry path end to end.
 * `lib/auth/__tests__/session.test.ts` covers the single-flight mechanism's
 * own edge cases in isolation.
 */
import * as authClient from '../authClient';
import { apiFetch } from '../client';
import { ApiError } from '../errors';
import * as session from '../../auth/session';

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

jest.mock('../authClient', () => ({
  login: jest.fn(),
  register: jest.fn(),
  refresh: jest.fn(),
  forgotPassword: jest.fn(),
  logout: jest.fn(),
}));

const mockedAuthClient = authClient as jest.Mocked<typeof authClient>;

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null } as Headers,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await session.signOut();
  jest.clearAllMocks();
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn();
});

describe('apiFetch happy path', () => {
  it('attaches the bearer access token and returns the parsed body on 200', async () => {
    mockedAuthClient.login.mockResolvedValueOnce({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 900,
    });
    await session.signIn('user@example.com', 'password123456');

    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { hello: 'world' }));

    const result = await apiFetch<{ hello: string }>('/sermons');

    expect(result).toEqual({ hello: 'world' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer access-1');
  });
});

describe('apiFetch 401 → single-flight refresh → retry', () => {
  it('funnels N concurrent apiFetch 401s into exactly one refresh call, then retries all N', async () => {
    mockedAuthClient.login.mockResolvedValueOnce({
      access_token: 'access-old',
      refresh_token: 'refresh-1',
      expires_in: 900,
    });
    await session.signIn('user@example.com', 'password123456');

    mockedAuthClient.refresh.mockResolvedValueOnce({
      access_token: 'access-new',
      refresh_token: 'refresh-2',
      expires_in: 900,
    });

    let callCount = 0;
    const N = 5;
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation(async () => {
      callCount += 1;
      // The first N calls are every concurrent request's *initial* attempt
      // (all made with the stale access token) — each must see a 401. Only
      // once every one of those has failed and the shared refresh has
      // resolved do the N retries happen, each of which must succeed.
      if (callCount <= N) {
        return jsonResponse(401, { detail: 'Not authenticated', correlation_id: null });
      }
      return jsonResponse(200, { ok: true });
    });

    const calls = Array.from({ length: N }, (_, i) => apiFetch<{ ok: boolean }>(`/protected-${i}`));
    const results = await Promise.all(calls);

    expect(mockedAuthClient.refresh).toHaveBeenCalledTimes(1);
    expect(mockedAuthClient.refresh).toHaveBeenCalledWith('refresh-1');
    expect(results).toHaveLength(N);
    for (const result of results) {
      expect(result).toEqual({ ok: true });
    }
    expect(fetchMock).toHaveBeenCalledTimes(N * 2);

    // Every retry (the second half of the calls, in completion order) used
    // the rotated access token, not the stale one.
    const retryHeaders = fetchMock.mock.calls.slice(N).map(([, init]) => (init.headers as Headers).get('authorization'));
    for (const header of retryHeaders) {
      expect(header).toBe('Bearer access-new');
    }
    expect(session.getAccessToken()).toBe('access-new');
  });

  it('rejects every waiting request and signs out when the shared refresh fails', async () => {
    mockedAuthClient.login.mockResolvedValueOnce({
      access_token: 'access-old',
      refresh_token: 'refresh-1',
      expires_in: 900,
    });
    await session.signIn('user@example.com', 'password123456');

    mockedAuthClient.refresh.mockRejectedValueOnce(new ApiError(401, 'Invalid or expired refresh token'));

    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(jsonResponse(401, { detail: 'Not authenticated', correlation_id: null }));

    const N = 3;
    const calls = Array.from({ length: N }, () => apiFetch('/protected').catch((err) => err as Error));
    const results = await Promise.all(calls);

    expect(mockedAuthClient.refresh).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result).toBeInstanceOf(ApiError);
    }
    // None of the N requests get a retry attempt once refresh has failed for
    // all of them — N initial attempts only, no wasted retries.
    expect(fetchMock).toHaveBeenCalledTimes(N);
    expect(session.getAccessToken()).toBeNull();
    expect(session.getStatus()).toBe('signedOut');
  });
});

describe('apiFetch network failure', () => {
  it('surfaces a network ApiError instead of throwing a raw exception', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(apiFetch('/sermons', { auth: false })).rejects.toMatchObject({
      network: true,
    });
  });
});
