import React from 'react';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { MAX_AGE_MS, sqliteQueryPersister } from './persister';
import { queryClient } from './queryClient';

/**
 * Wired into the root layout (`app/_layout.tsx`) alongside — not instead of
 * — `AuthProvider` (W3.2): the two are independent (`session.ts` is a plain
 * module `lib/api/client.ts` reads directly, no React context involved), so
 * there's no ordering requirement between them.
 *
 * `PersistQueryClientProvider` (not the plain `QueryClientProvider`) is
 * what makes L16's persistence real rather than aspirational: on mount it
 * restores whatever was previously written to `expo-sqlite` via
 * `sqliteQueryPersister` before rendering proceeds with a live cache, and
 * subscribes to persist every subsequent change back out (throttled, see
 * `persister.ts`).
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: sqliteQueryPersister, maxAge: MAX_AGE_MS }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
