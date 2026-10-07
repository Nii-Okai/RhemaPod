import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';

/**
 * `GET /api/v1/catalog/sermons/trending` — Home's "Trending" shelf. Public,
 * like every other `/catalog` read: most-played published sermons over the
 * last 30 days (`content_service.list_trending_sermons`'s own docstring has
 * the reasoning for that window and why it isn't cached like the full
 * catalog list is).
 */
export function useTrending() {
  return useQuery({
    queryKey: queryKeys.sermons.trending(),
    queryFn: ({ signal }) => api.get('/catalog/sermons/trending', { init: { signal } }),
  });
}
