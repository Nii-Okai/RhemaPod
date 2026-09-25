import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type SermonListItem = components['schemas']['SermonListItem'];
export type SermonDetail = components['schemas']['SermonDetail'];

/**
 * `GET /api/v1/catalog/sermons` — the public, published-only catalog read (plan
 * decision, W4.1: the task brief's unprefixed `GET /sermons` is staff-only and 403s a
 * signed-in member; `SermonDetail`'s own docstring confirms `/catalog/sermons/{id}` is
 * "the public read"). Server-ordered `published_at DESC NULLS LAST`
 * (`content_service.list_published_sermons`) — the Home hero (P5) is simply this list's
 * first item, no client-side sort or pin.
 */
export function useSermons() {
  return useQuery({
    queryKey: queryKeys.sermons.list(),
    queryFn: ({ signal }) => api.get('/catalog/sermons', { init: { signal } }),
  });
}

/** `GET /api/v1/catalog/sermons/{sermon_id}` — `SermonDetail`, bound per design spec §8.0. */
export function useSermonDetail(sermonId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.sermons.detail(sermonId),
    queryFn: ({ signal }) =>
      api.get('/catalog/sermons/{sermon_id}', { params: { path: { sermon_id: sermonId } }, init: { signal } }),
    enabled: options.enabled ?? true,
  });
}
