import { useEffect } from 'react';

interface PagedQuery {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isError: boolean;
  fetchNextPage: () => Promise<unknown>;
}

/**
 * Keeps paging a `useInfiniteQuery` until every page is in, while `enabled`.
 *
 * For a list whose order the server can't produce: `/search` only sorts newest first,
 * so "Oldest first" on a topic page needs the whole list before it can reverse it.
 * Stops on an error so a failing page can't loop.
 */
export function useFetchAllPages(query: PagedQuery, enabled: boolean): void {
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = query;
  useEffect(() => {
    if (enabled && hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage();
  }, [enabled, hasNextPage, isFetchingNextPage, isError, fetchNextPage]);
}
