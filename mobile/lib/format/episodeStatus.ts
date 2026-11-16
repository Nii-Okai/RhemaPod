import type { ProgressPublic } from '../query/hooks/useWatchHistory';

/**
 * Keyed by `sermon_id` — `useWatchHistory()`'s response shape, one call per screen. Feeds
 * series detail's Play/Resume CTA (`app/series/_detail/cta.ts`'s `resolveSeriesCta`),
 * which needs to know which episode is in progress to decide what to resume.
 */
export function buildHistoryMap(history: ProgressPublic[]): Map<string, ProgressPublic> {
  const map = new Map<string, ProgressPublic>();
  for (const entry of history) {
    map.set(entry.sermon_id, entry);
  }
  return map;
}
