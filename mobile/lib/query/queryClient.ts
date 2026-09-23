import { QueryClient } from '@tanstack/react-query';
import { retryDelay, shouldRetry } from './retryPolicy';

/**
 * Query-key convention (W3.3, §A.8). A hierarchical factory per domain,
 * following the widely-used TanStack Query "query key factory" pattern —
 * each level nests under the one above so a broad invalidation
 * (`queryClient.invalidateQueries({ queryKey: queryKeys.sermons.all })`)
 * catches every list/detail variant underneath it, while a narrow one
 * (`queryKeys.sermons.detail(id)`) only touches that one entity.
 *
 * `sermons` is built out below as the concrete instance (it's also the
 * plan's own example, §A.8). Phase 4 adds sibling domains — `series`,
 * `announcements`, `notes`, etc. — by mirroring this exact shape:
 *
 *   <domain>: {
 *     all: ['<domain>'] as const,
 *     lists: () => [...all, 'list'] as const,
 *     list: (params = {}) => [...lists(), params] as const,
 *     details: () => [...all, 'detail'] as const,
 *     detail: (id) => [...details(), id] as const,
 *   }
 *
 * Do not hand-roll ad-hoc arrays like `['sermon', id]` at a call site in
 * Phase 4 — every key must originate from this factory so invalidation and
 * the persister's `filters` (if a screen ever needs to persist/evict a
 * narrower slice than "everything") stay correct.
 */
export const queryKeys = {
  sermons: {
    all: ['sermons'] as const,
    lists: () => [...queryKeys.sermons.all, 'list'] as const,
    list: (params: Record<string, unknown> = {}) => [...queryKeys.sermons.lists(), params] as const,
    details: () => [...queryKeys.sermons.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.sermons.details(), id] as const,
  },
} as const;

/**
 * `gcTime` (formerly `cacheTime`) bounds how long an unused query survives
 * before eviction — it must be >= `persister.ts`'s `MAX_AGE_MS`, or
 * TanStack Query garbage-collects data before the persister ever gets a
 * chance to write it out. Kept in sync here rather than imported from
 * `persister.ts` to avoid a circular import (the persister has no need to
 * know about the client).
 *
 * `staleTime` is 5 minutes: catalogue content (sermons, series,
 * announcements) is edited by staff, not by the listener, so treating a
 * just-fetched list as fresh for a few minutes avoids re-fetching on every
 * tab focus without risking noticeably stale content.
 *
 * Retry/backoff is `retryPolicy.ts`'s pair, not TanStack's own default —
 * see that module's docstring for why (429 handling, §A.8's "no retry
 * storms" requirement). Mutations default to no retry: a mutation retried
 * automatically behind the caller's back (e.g. a double-submitted POST) is
 * a correctness bug waiting to happen; any mutation that specifically wants
 * retry sets it explicitly at the call site.
 */
const GC_TIME_MS = 24 * 60 * 60 * 1000; // 24h — keep in sync with persister.ts's MAX_AGE_MS
const STALE_TIME_MS = 5 * 60 * 1000; // 5 min

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_TIME_MS,
      gcTime: GC_TIME_MS,
      retry: shouldRetry,
      retryDelay,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: false,
    },
  },
});
