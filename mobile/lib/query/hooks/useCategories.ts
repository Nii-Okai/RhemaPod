import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type Category = components['schemas']['CategoryPublic'];

/**
 * `GET /api/v1/categories` (plan W4.3). Flat, one level, each row already
 * carries `sermon_count` computed server-side (Option B: published-only for
 * the common viewer, full count for a staff caller) — never fan out a
 * per-category count request.
 */
export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories.list(),
    queryFn: ({ signal }) => api.get('/categories', { init: { signal } }),
  });
}
