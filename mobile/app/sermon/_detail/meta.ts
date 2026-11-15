import { formatPublishedYear } from '../../../lib/format/publishedDate';
import type { SermonDetail } from './isPlayable';

/**
 * The single meta line under the title: published year (no "published" keyword),
 * category, and tier on one line. Tier itself renders as the
 * screen's own `Tag` chip alongside this text, same split series detail's own meta row
 * already uses — this only returns the text half.
 */
export function sermonMetaLine(detail: Pick<SermonDetail, 'published_at' | 'category_name'>): string {
  const parts: string[] = [];
  if (detail.published_at) parts.push(formatPublishedYear(detail.published_at));
  if (detail.category_name) parts.push(detail.category_name);
  return parts.join(' · ');
}
