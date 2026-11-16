import { formatDuration } from '../../../../lib/format/duration';
import { buildHistoryMap } from '../../../../lib/format/episodeStatus';
import type { ContinueWatchingItem } from '../../../../lib/query/hooks/useContinueWatching';
import type { SeriesEpisode } from '../../../../lib/query/hooks/useSeries';
import type { ProgressPublic } from '../../../../lib/query/hooks/useWatchHistory';

export type FlameState = 'done' | 'current' | 'ahead';

export interface WalkStep {
  id: string;
  /** "PT 3" — the episode's display number, or its position when it has none. */
  label: string;
  state: FlameState;
}

export interface SeriesWalk {
  seriesId: string;
  seriesTitle: string;
  /** The in-progress episode the card resumes. */
  current: ContinueWatchingItem;
  /** 1-based place of `current` among the series' published episodes. */
  position: number;
  total: number;
  /** Time left in `current`, or null when its duration is unknown. */
  remaining: string | null;
  /** One flame per episode, windowed to `MAX_FLAMES` around `current`. */
  steps: WalkStep[];
  doneCount: number;
}

/** More flames than this stop fitting one row on a phone. */
export const MAX_FLAMES = 10;

/**
 * "Your walk" for one series: a flame per episode, filled once the viewer has finished
 * it, glowing on the one they're partway through. Built only from data the app already
 * reads — the episode list and the viewer's history scoped to that series (the same pair
 * the series page uses for its own episode status).
 *
 * Returns null when `current` isn't among the published episodes (a stale
 * continue-watching row) — the card is then left out rather than drawn wrong.
 */
export function buildSeriesWalk(
  current: ContinueWatchingItem,
  episodes: SeriesEpisode[],
  history: ProgressPublic[],
): SeriesWalk | null {
  const index = episodes.findIndex((episode) => episode.id === current.id);
  if (index < 0 || !current.series_id) return null;

  const progress = buildHistoryMap(history);
  const all: WalkStep[] = episodes.map((episode, i) => ({
    id: episode.id,
    label: `PT ${episode.episode_number ?? i + 1}`,
    state: episode.id === current.id ? 'current' : progress.get(episode.id)?.completed ? 'done' : 'ahead',
  }));

  const start = Math.max(0, Math.min(index - Math.floor(MAX_FLAMES / 2) + 1, all.length - MAX_FLAMES));
  const remaining =
    current.duration_seconds !== null
      ? formatDuration(Math.max(0, current.duration_seconds - current.position_seconds))
      : null;

  return {
    seriesId: current.series_id,
    seriesTitle: current.series_title ?? current.title,
    current,
    position: index + 1,
    total: episodes.length,
    remaining,
    steps: all.slice(start, start + MAX_FLAMES),
    doneCount: all.filter((step) => step.state === 'done').length,
  };
}
