import type { SermonListItem } from '../query/hooks/useSermons';

/**
 * Keyed by sermon id — built once from the already-cached full catalog
 * (`useSermons()`, `GET /catalog/sermons`) rather than a per-row fan-out
 * fetch, the same "derive it from what you already have" convention
 * `lib/format/episodeStatus.ts`'s `buildHistoryMap` established. Shared by
 * every screen that renders a list keyed only by `sermon_id` (notes,
 * watch history) and needs a title/duration to show alongside it.
 */
export function buildSermonTitleMap(sermons: SermonListItem[]): Map<string, SermonListItem> {
  const map = new Map<string, SermonListItem>();
  for (const sermon of sermons) {
    map.set(sermon.id, sermon);
  }
  return map;
}
