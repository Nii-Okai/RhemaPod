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
 * `announcements`, etc. — by mirroring this exact shape:
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
    trending: () => [...queryKeys.sermons.all, 'trending'] as const,
    newReleases: () => [...queryKeys.sermons.all, 'new-releases'] as const,
    prophetsCatalog: () => [...queryKeys.sermons.all, 'prophets-catalog'] as const,
    hero: () => [...queryKeys.sermons.all, 'hero'] as const,
  },
  // W4.3 — mirrors the `sermons` shape above per this factory's own doc comment.
  categories: {
    all: ['categories'] as const,
    lists: () => [...queryKeys.categories.all, 'list'] as const,
    list: (params: Record<string, unknown> = {}) => [...queryKeys.categories.lists(), params] as const,
  },
  speakers: {
    all: ['speakers'] as const,
    lists: () => [...queryKeys.speakers.all, 'list'] as const,
    list: (params: Record<string, unknown> = {}) => [...queryKeys.speakers.lists(), params] as const,
  },
  /**
   * `/search` also serves as the filtered-browse endpoint (no `q`) for the
   * category/speaker drill-down lists — `results(params)` covers both, keyed
   * on whatever filter combination the caller passes so a text search and a
   * `category_id` browse never collide in the cache.
   */
  search: {
    all: ['search'] as const,
    // `object`, not `Record<string, unknown>`: callers pass a named params interface
    // (`SearchResultsParams`), which has no index signature of its own.
    results: (params: object = {}) => [...queryKeys.search.all, 'results', params] as const,
    // Distinct key namespace from `results` above — an `useInfiniteQuery` cache entry
    // ({pages, pageParams}) has a different shape than a plain `useQuery` one (a flat
    // `SearchResults`), so the two must never collide under the same key even when
    // called with identical params (`AddToPlaylistSheet`'s own paginated Sermons/
    // Episodes tabs, Isaac's ask, session 2026-10-10 — "not all episodes are showing,"
    // the 20-result-cap root cause).
    resultsInfinite: (params: object = {}) => [...queryKeys.search.all, 'results-infinite', params] as const,
    suggest: (q: string) => [...queryKeys.search.all, 'suggest', q] as const,
  },
  // W4.4 — mirrors the `sermons` shape above per this factory's own doc comment.
  series: {
    all: ['series'] as const,
    lists: () => [...queryKeys.series.all, 'list'] as const,
    list: (params: Record<string, unknown> = {}) => [...queryKeys.series.lists(), params] as const,
    details: () => [...queryKeys.series.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.series.details(), id] as const,
    episodes: (id: string) => [...queryKeys.series.detail(id), 'episodes'] as const,
  },
  announcements: {
    all: ['announcements'] as const,
    lists: () => [...queryKeys.announcements.all, 'list'] as const,
    list: (params: Record<string, unknown> = {}) => [...queryKeys.announcements.lists(), params] as const,
  },
  verses: {
    all: ['verses'] as const,
    today: () => [...queryKeys.verses.all, 'today'] as const,
  },
  /**
   * The caller's own `/me/*` reads, folded into one domain rather than split across
   * `me` and a standalone `continueWatching` (W4.1/W4.4 reconciliation — both are reads
   * scoped to the authenticated caller and nothing else needs that scoping split out):
   * `GET /me/continue-watching` (started-but-unfinished, capped at the endpoint's own
   * default of 10 — W4.1's Home shelf) and `GET /me/history` (up to 100 rows,
   * most-recent-first — W4.4's series-episode status derivation, or, scoped to a
   * `series_id`, up to `SERIES_HISTORY_LIMIT` rows for that series alone — Decision 6).
   * Distinct endpoints, distinct semantics, same `/me/*` scoping.
   */
  me: {
    all: ['me'] as const,
    continueWatching: () => [...queryKeys.me.all, 'continueWatching'] as const,
    recommended: () => [...queryKeys.me.all, 'recommended'] as const,
    history: (limit: number) => [...queryKeys.me.all, 'history', limit] as const,
    historyForSeries: (seriesId: string) => [...queryKeys.me.all, 'history', 'series', seriesId] as const,
    // `GET /auth/me` (W4.6) — a different path prefix than the rest of this domain's
    // `/me/*` reads, but the same "the caller's own data" scoping, so it's folded in here
    // rather than opening a new top-level domain for one endpoint.
    profile: () => [...queryKeys.me.all, 'profile'] as const,
    // `GET /me/blocks` — the authors the caller has blocked (Me > Blocked users).
    blocks: () => [...queryKeys.me.all, 'blocks'] as const,
  },
  // Per-sermon resume position — `GET /sermons/{sermon_id}/progress`, deliberately
  // separate from `sermons.detail(id)` (SermonDetail) since the two responses are
  // different resources that happen to share a path segment.
  progress: {
    all: ['progress'] as const,
    details: () => [...queryKeys.progress.all, 'detail'] as const,
    detail: (sermonId: string) => [...queryKeys.progress.details(), sermonId] as const,
  },
  // W4.2 — `GET /sermons/{sermon_id}/stream`, the signed-playback-URL read. Short-lived
  // by design (`expires_in`, ~6h server default) — kept out of `sermons` since it's a
  // distinct resource (signed URLs, not sermon metadata) that happens to share a path
  // segment, mirroring the `progress` domain's own reasoning above.
  stream: {
    all: ['stream'] as const,
    details: () => [...queryKeys.stream.all, 'detail'] as const,
    detail: (sermonId: string) => [...queryKeys.stream.details(), sermonId] as const,
  },
  // `GET /sermons/{sermon_id}/comments` — one sermon's comment thread (offset-paginated,
  // newest first). Its own domain, like `progress`/`stream`: a per-sermon resource that
  // shares a path segment with `sermons` but is a different, user-generated resource.
  comments: {
    all: ['comments'] as const,
    forSermon: (sermonId: string) => [...queryKeys.comments.all, 'sermon', sermonId] as const,
  },
  // The Library tab's playlists (Isaac's ask, session 2026-10-10) — mirrors the
  // `sermons`/`series` shape; `list()` takes no params (GET /playlists is always
  // "all of the caller's own playlists", there's no filter to key on).
  playlists: {
    all: ['playlists'] as const,
    lists: () => [...queryKeys.playlists.all, 'list'] as const,
    list: () => [...queryKeys.playlists.lists()] as const,
    details: () => [...queryKeys.playlists.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.playlists.details(), id] as const,
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
