/**
 * `GET /series`, `GET /series/{id}`, `GET /series/{id}/episodes` (plan W4.1/W4.4).
 *
 * The episodes read is already renumbered contiguous 1..N server-side (plan
 * L11/W2.3, `content_service.renumber_for_display`) — this hook does no
 * client-side renumbering and must never re-sort or re-number what the
 * server returns. An episode with `episode_number: null` stays null; it is
 * not part of the numbered sequence.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type SeriesPublic = components['schemas']['SeriesPublic'];
export type SeriesEpisode = components['schemas']['SermonListItem'];

/**
 * `GET /api/v1/series` — member-readable (no auth-role guard on the route; confirmed
 * against `app/api/series.py`'s `list_series` — unlike its `POST`/`PATCH`/`DELETE`
 * siblings, which are editor-gated). Drives both Home's "Series" shelf (design spec
 * §3 Home: "with episode counts" — `episode_count` is already on `SeriesPublic`, no
 * fan-out needed) and the tablet rail's Series tab (P3) — same flat list, two
 * consumers. A series card navigates to `/series/[id]`, owned by W4.4 — this hook
 * and its callers only push that route, they don't render its screen.
 */
export function useSeriesList() {
  return useQuery({
    queryKey: queryKeys.series.list(),
    queryFn: ({ signal }) => api.get('/series', { init: { signal } }),
  });
}

export function useSeriesDetail(seriesId: string) {
  return useQuery({
    queryKey: queryKeys.series.detail(seriesId),
    queryFn: ({ signal }) =>
      api.get('/series/{series_id}', { params: { path: { series_id: seriesId } }, init: { signal } }),
    enabled: Boolean(seriesId),
  });
}

export function useSeriesEpisodes(seriesId: string) {
  return useQuery({
    queryKey: queryKeys.series.episodes(seriesId),
    queryFn: ({ signal }) =>
      api.get('/series/{series_id}/episodes', { params: { path: { series_id: seriesId } }, init: { signal } }),
    enabled: Boolean(seriesId),
  });
}
