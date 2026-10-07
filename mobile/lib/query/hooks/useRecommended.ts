import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';

/**
 * `GET /api/v1/me/recommended` — Home's "Recommended for you" shelf.
 * Category/speaker affinity derived from the caller's own playback history,
 * falling back to Trending when that history has nothing to work with
 * (`content_service.list_recommended_sermons`'s own docstring has the full
 * fallback chain). Member-only, unlike `useTrending` — the personalization
 * itself requires knowing who's asking.
 */
export function useRecommended() {
  return useQuery({
    queryKey: queryKeys.me.recommended(),
    queryFn: ({ signal }) => api.get('/me/recommended', { init: { signal } }),
  });
}
