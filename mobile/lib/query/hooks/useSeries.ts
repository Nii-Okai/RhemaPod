import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type SeriesListItem = components['schemas']['SeriesPublic'];

/**
 * `GET /api/v1/series` — member-readable (no auth-role guard on the route; confirmed
 * against `app/api/series.py`'s `list_series` — unlike its `POST`/`PATCH`/`DELETE`
 * siblings, which are editor-gated). Drives Home's "Series" shelf (design spec §3 Home:
 * "with episode counts" — `episode_count` is already on `SeriesPublic`, no fan-out
 * needed). A series card navigates to `/series/[id]`, owned by W4.4 — this hook and
 * Home's shelf only push that route, they don't render its screen.
 */
export function useSeries() {
  return useQuery({
    queryKey: queryKeys.series.list(),
    queryFn: ({ signal }) => api.get('/series', { init: { signal } }),
  });
}
