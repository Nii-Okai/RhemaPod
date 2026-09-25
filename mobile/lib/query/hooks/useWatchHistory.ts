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
 * Caveat, accepted and documented rather than silently papered over: this
 * endpoint caps at 100 rows across the *entire* app, most-recently-played
 * first (`analytics_service.history`, no series/sermon filter). An episode
 * played long enough ago to fall off that cap reads as "new" here even
 * though the user did watch it. There is no per-series/-sermon-scoped
 * history read in the current backend contract to avoid this.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/typedClient';
import { queryKeys } from '../queryClient';
import type { components } from '../../api/schema';

export type ProgressPublic = components['schemas']['ProgressPublic'];

/** The backend's own ceiling (`Query(..., le=100)`, `analytics_service.history`'s own clamp). */
export const WATCH_HISTORY_LIMIT = 100;

export function useWatchHistory() {
  return useQuery({
    queryKey: queryKeys.me.history(WATCH_HISTORY_LIMIT),
    queryFn: ({ signal }) =>
      api.get('/me/history', { params: { query: { limit: WATCH_HISTORY_LIMIT } }, init: { signal } }),
  });
}
