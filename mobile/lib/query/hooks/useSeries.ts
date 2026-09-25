/**
 * `GET /series`, `GET /series/{id}`, `GET /series/{id}/episodes` (plan W4.4).
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

/** Tablet rail's Series tab (P3) — flat list, each item already carries `episode_count`. */
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
