/**
 * `GET /series`, `GET /series/{id}`, `GET /series/{id}/episodes` (plan W4.1/W4.4).
 *
 * The episodes read is already renumbered contiguous 1..N server-side (plan
 * L11/W2.3, `content_service.renumber_for_display`) — this hook does no
 * client-side renumbering and must never re-sort or re-number what the
 * server returns. An episode with `episode_number: null` stays null; it is
 * not part of the numbered sequence.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type SeriesPublic = components['schemas']['SeriesPublic'];
export type SeriesEpisode = components['schemas']['SermonListItem'];
type LikeState = components['schemas']['LikeState'];

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

/** `PUT`/`DELETE /series/{series_id}/like` — the series-page sibling of
 * `useToggleSermonLike`; see that hook's own doc comment for the full reasoning
 * (same server idempotency, same "pick the direction from the caller's current
 * `liked_by_me`" design, same write-the-response-into-cache-not-refetch pattern). */
export function useToggleSeriesLike(seriesId: string) {
  const queryClient = useQueryClient();
  const applyState = (state: LikeState) => {
    queryClient.setQueryData<SeriesPublic>(queryKeys.series.detail(seriesId), (series) =>
      series ? { ...series, liked_by_me: state.liked, like_count: state.like_count } : series,
    );
  };
  const like = useMutation({
    mutationFn: () => api.put('/series/{series_id}/like', { params: { path: { series_id: seriesId } } }),
    onSuccess: applyState,
  });
  const unlike = useMutation({
    mutationFn: () => api.delete('/series/{series_id}/like', { params: { path: { series_id: seriesId } } }),
    onSuccess: applyState,
  });
  return {
    toggle: (currentlyLiked: boolean) => void (currentlyLiked ? unlike.mutate() : like.mutate()),
    isPending: like.isPending || unlike.isPending,
  };
}

export function useSeriesEpisodes(seriesId: string) {
  return useQuery({
    queryKey: queryKeys.series.episodes(seriesId),
    queryFn: ({ signal }) =>
      api.get('/series/{series_id}/episodes', { params: { path: { series_id: seriesId } }, init: { signal } }),
    enabled: Boolean(seriesId),
  });
}
