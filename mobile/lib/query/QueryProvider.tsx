import React from 'react';
import { defaultShouldDehydrateQuery, type Query } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { MAX_AGE_MS, sqliteQueryPersister } from './persister';
import { installQueryLifecycle } from './lifecycle';
import { queryClient, queryKeys } from './queryClient';

/**
 * Bump to discard every previously persisted cache on next launch. Bumped for the
 * sermon-comments release: the Notes endpoints and their cached `['notes', ...]` entries
 * are gone, and a restored cache must not carry them (or any shape written before the
 * comments keys existed) into the new build.
 */
export const PERSIST_BUSTER = 'sermon-comments-1';

/**
 * Comment threads and the blocked-users list are user-generated and per-viewer (blocked
 * authors are filtered server-side). They are never written to the on-disk cache: a stale
 * restore could show a comment the viewer has since blocked or that has since been hidden,
 * and the player shows "Comments unavailable offline" rather than serving old threads.
 *
 * `stream` is excluded for the same shape of reason, found at S8/S9 review (B1/D11/D2):
 * a restored `/stream` response can be up to `MAX_AGE_MS` (24h) old, while its signed URL
 * expires in ~6h, so a cold-started reopen could otherwise show entitlement as confirmed
 * from a response that's actually stale or already expired. The media cache's "every hit
 * re-validates" guarantee (`useCachedSource.ts`) depends on this response always coming
 * from a live fetch, never a disk restore. This also keeps presigned URLs, however
 * short-lived, out of the persisted on-disk query cache entirely.
 */
export function shouldPersistQuery(query: Query): boolean {
  const root = query.queryKey[0];
  if (root === queryKeys.comments.all[0]) return false;
  if (root === queryKeys.me.all[0] && query.queryKey[1] === 'blocks') return false;
  if (root === queryKeys.stream.all[0]) return false;
  return defaultShouldDehydrateQuery(query);
}

/**
 * A mutation that's paused by a dropped connection (e.g. posting a comment while offline)
 * is, by TanStack's own default, dehydrated right alongside queries — which would write
 * the caller's own in-flight comment body out to the on-disk SQLite persistence cache.
 * Mutations are never persisted here: they either settle before the app backgrounds or
 * are lost, same as any other in-memory, non-retried request in this client (see
 * `queryClient.ts`'s `mutations.retry: false`).
 */
export function shouldPersistMutation(): boolean {
  return false;
}

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
  React.useEffect(() => {
    installQueryLifecycle();
  }, []);
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: sqliteQueryPersister,
        maxAge: MAX_AGE_MS,
        buster: PERSIST_BUSTER,
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery, shouldDehydrateMutation: shouldPersistMutation },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
