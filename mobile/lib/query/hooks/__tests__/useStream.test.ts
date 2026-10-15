import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { useStream } from '../useStream';
import { api } from '../../../api/typedClient';

jest.mock('../../../api/typedClient', () => ({ api: { get: jest.fn() } }));
const mockedGet = api.get as jest.Mock;

/**
 * S8/S9 review, finding B1/D11/D2: the media cache's "every hit re-validates
 * entitlement" guarantee needs `/stream` to actually refetch on every mount, never
 * silently serve stale/cached data. Checked directly against the query's own resolved
 * options in the cache (not a live two-mount timing test — that style of test proved
 * flaky/hang-prone here across both real and fake timers, for reasons not worth chasing
 * further given how directly this check proves the same thing) — the client's own
 * default `staleTime` (5 minutes, `queryClient.ts`) is deliberately left in place here to
 * prove `useStream`'s per-query override actually wins over it, not just that both
 * happen to already agree.
 */
describe('useStream (S8/S9 review, finding B1/D11/D2)', () => {
  it('overrides staleTime to 0 and refetchOnMount to "always", regardless of the client default', async () => {
    mockedGet.mockResolvedValue({ expires_in: 21600, sermon_id: 's1', variants: [] });
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(() => useStream('s1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const query = client.getQueryCache().find({ queryKey: ['stream', 'detail', 's1'] });
    const options = query?.options as unknown as { staleTime?: number; refetchOnMount?: string };
    expect(options?.staleTime).toBe(0);
    expect(options?.refetchOnMount).toBe('always');
  });
});
