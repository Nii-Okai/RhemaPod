import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type UpcomingSermon = components['schemas']['UpcomingSermon'];

/**
 * `GET /catalog/sermons/upcoming` — the next scheduled sermon (title, release time and
 * names only), or `null` when nothing is scheduled. Feeds Signature Home's countdown.
 * Public, like the other `/catalog` reads.
 */
export function useUpcomingSermon() {
  return useQuery({
    queryKey: queryKeys.sermons.upcoming(),
    queryFn: ({ signal }) => api.get('/catalog/sermons/upcoming', { init: { signal } }),
  });
}
