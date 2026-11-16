import type { SeriesPublic } from '../../../lib/query/hooks/useSeries';

export function episodeCountLabel(count: number): string {
  return count === 1 ? '1 episode' : `${count} episodes`;
}

/** "{N episodes} · {category}" — the category segment is dropped when the series is
    uncategorised, never rendered as "· ". */
export function seriesMetaLine(detail: Pick<SeriesPublic, 'episode_count' | 'category_name'>): string {
  const parts = [episodeCountLabel(detail.episode_count)];
  if (detail.category_name) parts.push(detail.category_name);
  return parts.join(' · ');
}
