import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';

/**
 * `GET /api/v1/catalog/sermons/new-releases` — Home's "New Releases" shelf. Public,
 * like every other `/catalog` read: the same newest-published-first ordering the
 * hero itself uses, just capped to shelf size server-side
 * (`content_service.list_new_release_sermons`).
 */
export function useNewReleases() {
  return useQuery({
    queryKey: queryKeys.sermons.newReleases(),
    queryFn: ({ signal }) => api.get('/catalog/sermons/new-releases', { init: { signal } }),
  });
}
