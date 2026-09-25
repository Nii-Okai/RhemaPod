import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Test-only `QueryClient` — no retry (so an error case resolves on the
 * first attempt instead of the real client's backoff, see retryPolicy.ts)
 * and no persistence. Shared by every W4.3 hook/screen test that renders
 * something wrapped by TanStack Query.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function wrapWithQueryClient(client: QueryClient = createTestQueryClient()) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
