/**
 * Proves L16's persistence is real, not aspirational (W3.3 verification:
 * "a cached catalogue list renders with the network disabled"). A query
 * populated in one `QueryClient`, persisted through `sqliteQueryPersister`,
 * is restored into a *second*, independently-created `QueryClient` — the
 * next cold start — and rendered by `useQuery` whose `queryFn` always
 * rejects (standing in for the device being offline). The cached catalogue
 * data must resolve from the restored cache, not hang or error.
 */
import React from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { persistQueryClientRestore, persistQueryClientSave } from '@tanstack/react-query-persist-client';
import { renderHook, waitFor } from '@testing-library/react-native';
import { networkError } from '../../api/errors';
import { sqliteQueryPersister } from '../persister';
import { queryKeys } from '../queryClient';

jest.mock('expo-sqlite/kv-store', () => {
  // In-memory stand-in for the SQLite-backed `AsyncStorage` `expo-sqlite/
  // kv-store` exports — real SQLite doesn't run under Jest, but this
  // preserves the module's actual contract (async get/set/remove of string
  // values keyed by string) so `sqliteQueryPersister` never knows it isn't
  // talking to a real database file. Declared at module scope, reset only
  // in `beforeEach`, so within a single test it survives across the two
  // independent `QueryClient`s standing in for "before" and "after an app
  // restart".
  let store: Record<string, string> = {};
  return {
    AsyncStorage: {
      getItem: jest.fn(async (key: string) => store[key] ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: jest.fn(async (key: string) => {
        delete store[key];
      }),
      __reset: () => {
        store = {};
      },
    },
  };
});

function mockedSqliteStorage() {
  return jest.requireMock('expo-sqlite/kv-store').AsyncStorage as {
    getItem: jest.Mock;
    setItem: jest.Mock;
    removeItem: jest.Mock;
    __reset: () => void;
  };
}

const FIXTURE = [{ id: 'sermon-1', title: 'Cached Sermon' }];

function offlineQueryFn(): Promise<never> {
  return Promise.reject(networkError());
}

describe('sqliteQueryPersister', () => {
  beforeEach(() => {
    mockedSqliteStorage().__reset();
  });

  it('round-trips a persisted query through the mocked SQLite-backed storage', async () => {
    const writer = new QueryClient();
    writer.setQueryData(queryKeys.sermons.list(), FIXTURE);

    await persistQueryClientSave({ queryClient: writer, persister: sqliteQueryPersister });

    // The write actually reached the SQLite-backed storage, not a no-op.
    const persisted = await mockedSqliteStorage().getItem('rhemapod-query-cache');
    expect(typeof persisted).toBe('string');
    expect(persisted).toContain('Cached Sermon');

    const reader = new QueryClient();
    await persistQueryClientRestore({ queryClient: reader, persister: sqliteQueryPersister });

    expect(reader.getQueryData(queryKeys.sermons.list())).toEqual(FIXTURE);

    writer.clear();
    reader.clear();
  });

  it('renders a cached catalogue list from persisted cache with the network disabled', async () => {
    const writer = new QueryClient();
    writer.setQueryData(queryKeys.sermons.list(), FIXTURE);
    await persistQueryClientSave({ queryClient: writer, persister: sqliteQueryPersister });

    // A brand new client — the next cold start — whose queryFn always
    // rejects with the same `ApiError` a real dropped connection produces.
    const reader = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await persistQueryClientRestore({ queryClient: reader, persister: sqliteQueryPersister });

    function wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={reader}>{children}</QueryClientProvider>;
    }

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: queryKeys.sermons.list(),
          queryFn: offlineQueryFn,
          // §A.8's offline catalogue browsing is a deliberate
          // graceful-degrade decision, not connectivity-assumed: a
          // restored list stays fresh (no forced background revalidate)
          // rather than immediately re-attempting a request the device
          // has no way to complete. Phase 4 screens needing a shorter
          // window than the client-wide 5 min default (`queryClient.ts`)
          // set their own `staleTime`; this test pins it so the assertion
          // below is about the persisted-cache read, not the retry policy
          // (covered separately in `retryPolicy.test.ts`).
          staleTime: Infinity,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(FIXTURE);
    });
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isError).toBe(false);

    writer.clear();
    reader.clear();
  });
});
