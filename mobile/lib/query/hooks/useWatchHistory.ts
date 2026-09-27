/**
 * `GET /me/history` (plan W4.4) — the single call the series-detail screen
 * uses to derive per-episode status ("watched" / "17:04 left" / "new"),
 * matched client-side by `sermon_id` (see `lib/format/episodeStatus.ts`).
 * Deliberately not a per-episode fan-out (plan W4.4: "derive it from what
 * the API gives you ... not a fan-out per episode. If honest per-episode
 * status needs a fan-out or a backend change, stop and report instead of
 * inventing it" — `/me/history` covers both the completed and in-progress
 * cases in one call).
 *
 * Unscoped (no `seriesId`): app-wide reading capped at `WATCH_HISTORY_LIMIT`
 * (100), most-recently-played first (`analytics_service.history`, no
 * series/sermon filter). An episode played long enough ago to fall off that
 * cap reads as "new" here even though the user did watch it — an accepted,
 * documented caveat for any caller of this hook's unscoped form.
 *
 * Scoped to a `seriesId` (Decision 6): `GET /me/history?series_id=<id>`
 * returns every one of the caller's progress rows for sermons in that
 * series — the backend ignores `limit` once `series_id` is set, bounded
 * instead by its own much higher `SERIES_HISTORY_LIMIT` safety ceiling (see
 * `analytics_service.py`) — so a long-running series no longer misreads an
 * old watch as "new" once it exceeds the app-wide 100-row cap. The
 * series/episode screen (`app/series/[id].tsx`) always calls this scoped
 * form now.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type ProgressPublic = components['schemas']['ProgressPublic'];

/** The backend's own ceiling (`Query(..., le=100)`, `analytics_service.history`'s own clamp) — applies only to the unscoped read. */
export const WATCH_HISTORY_LIMIT = 100;

export function useWatchHistory(seriesId?: string) {
  return useQuery({
    queryKey: seriesId ? queryKeys.me.historyForSeries(seriesId) : queryKeys.me.history(WATCH_HISTORY_LIMIT),
    queryFn: ({ signal }) =>
      api.get('/me/history', {
        params: { query: seriesId ? { series_id: seriesId } : { limit: WATCH_HISTORY_LIMIT } },
        init: { signal },
      }),
  });
}
