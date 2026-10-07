/**
 * `/search` doubles as the filtered-browse endpoint (its own docstring: "Every filter is
 * optional — with no `q` this is a filtered browse") — `useSearchResults` is the one hook
 * behind both Search's query results and the category/speaker drill-down lists
 * (`app/category/[id].tsx`, `app/speaker/[id].tsx`), keyed on whatever params the caller
 * passes so a text search and a `category_id` browse never collide in the cache.
 *
 * `useSearchSuggest` is deliberately driven by an already-debounced `query` — see
 * `lib/hooks/useDebouncedValue.ts` and its call site in `app/search.tsx` (a top-level
 * stack route since Isaac's ask, session 2026-10-02 — Browse absorbed the dedicated
 * Search tab, pushing here instead of switching tabs) — never the raw per-keystroke
 * input, or this would self-throttle against the per-user rate limiter (plan L14/W4.3).
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';

export interface SearchResultsParams {
  q?: string;
  category_id?: string;
  speaker_id?: string;
  limit?: number;
  offset?: number;
}

export function useSearchResults(params: SearchResultsParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.search.results(params),
    queryFn: ({ signal }) => api.get('/search', { params: { query: params }, init: { signal } }),
    enabled: options.enabled ?? true,
  });
}

/** Backend floor (`Query(min_length=2)`) — a shorter `q` 422s, so gate client-side too. */
export const SUGGEST_MIN_LENGTH = 2;

/** `q` must already be >= `SUGGEST_MIN_LENGTH` chars (the backend's own `min_length`) — callers gate on that via `enabled`. */
export function useSearchSuggest(query: string) {
  const trimmed = query.trim();
  const enabled = trimmed.length >= SUGGEST_MIN_LENGTH;

  return useQuery({
    queryKey: queryKeys.search.suggest(trimmed),
    queryFn: ({ signal }) => api.get('/search/suggest', { params: { query: { q: trimmed } }, init: { signal } }),
    enabled,
    // Suggestions are cheap and ephemeral — the client-wide 5 min staleTime
    // (queryClient.ts) is tuned for catalogue lists, not a live-typed box.
    staleTime: 30_000,
  });
}
