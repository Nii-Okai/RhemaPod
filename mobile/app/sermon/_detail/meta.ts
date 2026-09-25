import { formatDuration } from '../../../lib/format/duration';
import { formatPublishedDate } from '../../../lib/format/publishedDate';
import type { SermonDetail } from './isPlayable';

/** "Standalone" or "{series_title}, part {episode_number}" (design spec §8.1.5). */
export function formatPlacement(
  detail: Pick<SermonDetail, 'series_id' | 'series_title' | 'episode_number'>,
): string {
  if (!detail.series_id) return 'Standalone';
  const title = detail.series_title ?? 'Series';
  return detail.episode_number != null ? `${title}, part ${detail.episode_number}` : title;
}

/** Distinct `media_refs[].type` values collapsed to the spec's three-way label, or `null` when empty. */
export function formatMediaFormat(mediaRefs: SermonDetail['media_refs']): string | null {
  const types = new Set(mediaRefs.map((ref) => ref.type));
  if (types.size === 0) return null;
  if (types.has('video') && types.has('audio')) return 'audio + video';
  return types.has('video') ? 'video' : 'audio';
}

/**
 * Meta row 1 (§8.1.5): placement · duration · format — up to 3 segments joined by " · ".
 * The format segment is omitted outside the playable state (§8.3: "nothing to report").
 */
export function metaRow1(detail: SermonDetail, playable: boolean): string {
  const parts = [formatPlacement(detail)];
  if (detail.duration_seconds !== null) parts.push(formatDuration(detail.duration_seconds));
  if (playable) {
    const format = formatMediaFormat(detail.media_refs);
    if (format) parts.push(format);
  }
  return parts.join(' · ');
}

/**
 * Meta row 2 (§8.1.5): "published {date} · {N} renditions". The renditions clause is
 * dropped outside the playable state (§8.3); the whole row is omitted if `published_at`
 * is null (shouldn't happen given the published-only assumption, but never render
 * "published —").
 */
export function metaRow2(detail: SermonDetail, playable: boolean): string | null {
  if (!detail.published_at) return null;
  const date = formatPublishedDate(detail.published_at);
  if (playable && detail.media_refs.length > 0) {
    const count = detail.media_refs.length;
    return `published ${date} · ${count} rendition${count === 1 ? '' : 's'}`;
  }
  return `published ${date}`;
}
