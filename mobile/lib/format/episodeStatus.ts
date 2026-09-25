import { formatDuration } from './duration';
import type { ProgressPublic } from '../query/hooks/useWatchHistory';

/** Keyed by `sermon_id` — `useWatchHistory()`'s response shape, one call per screen. */
export function buildHistoryMap(history: ProgressPublic[]): Map<string, ProgressPublic> {
  const map = new Map<string, ProgressPublic>();
  for (const entry of history) {
    map.set(entry.sermon_id, entry);
  }
  return map;
}

export interface EpisodeStatusInput {
  id: string;
  duration_seconds: number | null;
}

/**
 * "watched" / "17:04 left" / "new" (design spec 1h), derived from the one
 * `/me/history` call `useWatchHistory` makes — never a per-episode fetch. No
 * matching row: never played, "new". A completed row: "watched", regardless
 * of duration data. An in-progress row: "`<remaining>` left", computed from
 * the episode's own `duration_seconds` (already on `SermonListItem`, no
 * extra call) minus the recorded `position_seconds` — but if the episode's
 * duration isn't known yet (the media pipeline is still probing it, the
 * same nullable case `formatDuration` itself handles), this falls back to a
 * plain "in progress" rather than fabricating a remaining-time figure from
 * missing data.
 */
export function deriveEpisodeStatus(
  episode: EpisodeStatusInput,
  history: Map<string, ProgressPublic>,
): string {
  const progress = history.get(episode.id);
  if (!progress) return 'new';
  if (progress.completed) return 'watched';

  if (episode.duration_seconds === null || episode.duration_seconds === undefined) {
    return 'in progress';
  }
  const remaining = Math.max(episode.duration_seconds - progress.position_seconds, 0);
  return `${formatDuration(remaining)} left`;
}
