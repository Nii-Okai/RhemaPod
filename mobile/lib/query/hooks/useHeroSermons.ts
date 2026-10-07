import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';

/**
 * `GET /api/v1/catalog/sermons/hero` — Home's hero carousel. Public, like every other
 * `/catalog` read: up to 3 newest-published sermons, capped to one per series so the
 * carousel doesn't spend two of its three slots on back-to-back episodes of the same
 * series (`content_service.list_hero_sermons`).
 */
export function useHeroSermons() {
  return useQuery({
    queryKey: queryKeys.sermons.hero(),
    queryFn: ({ signal }) => api.get('/catalog/sermons/hero', { init: { signal } }),
  });
}
