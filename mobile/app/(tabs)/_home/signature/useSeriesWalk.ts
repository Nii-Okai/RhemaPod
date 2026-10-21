import type { ContinueWatchingItem } from '../../../../lib/query/hooks/useContinueWatching';
import { useSeriesEpisodes } from '../../../../lib/query/hooks/useSeries';
import { useWatchHistory } from '../../../../lib/query/hooks/useWatchHistory';
import { buildSeriesWalk } from './seriesWalk';

/**
 * The walk for the most recently played series — the first continue-watching row that
 * belongs to one. Both reads are skipped entirely when nothing in progress is part of a
 * series, and the card stays hidden until both have landed.
 */
export function useSeriesWalk(continueWatching: ContinueWatchingItem[]) {
  const current = continueWatching.find((item) => item.series_id) ?? null;
  const seriesId = current?.series_id ?? '';
  const episodes = useSeriesEpisodes(seriesId);
  const history = useWatchHistory(seriesId || undefined, { enabled: Boolean(seriesId) });

  const walk =
    current && episodes.data && history.data ? buildSeriesWalk(current, episodes.data, history.data) : null;

  const refetch = async () => {
    if (!seriesId) return;
    await Promise.all([episodes.refetch(), history.refetch()]);
  };

  return { walk, refetch };
}
