import { formatDuration } from '../../../lib/format/duration';
import type { SeriesEpisode } from '../../../lib/query/hooks/useSeries';
import type { ProgressPublic } from '../../../lib/query/hooks/useWatchHistory';
import type { SeriesDetailCta } from '../_detail/cta';

export type EpisodeState = 'done' | 'started' | 'ahead';

export interface EpisodeProgress {
  state: EpisodeState;
  /** 0–1, drawn as the bar along the bottom of the episode's art. */
  fraction: number;
  /** "1:22 · WATCHED", "1:30 · 0:41 LEFT", or just the duration. */
  meta: string;
}

/**
 * Where the viewer is in one episode, from the series-scoped history the screen already
 * reads for its Resume button. An episode with no duration on file shows no bar and no
 * time left, rather than a guess.
 */
export function episodeProgress(episode: SeriesEpisode, progress: ProgressPublic | undefined): EpisodeProgress {
  const duration = episode.duration_seconds;
  const durationLabel = duration !== null ? formatDuration(duration) : null;
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ');

  if (progress?.completed) {
    return { state: 'done', fraction: 1, meta: join(durationLabel, 'WATCHED') };
  }
  if (progress && progress.position_seconds > 0) {
    const fraction = duration ? Math.min(1, progress.position_seconds / duration) : 0;
    const left = duration !== null ? `${formatDuration(Math.max(0, duration - progress.position_seconds))} LEFT` : null;
    return { state: 'started', fraction, meta: join(durationLabel, left) };
  }
  return { state: 'ahead', fraction: 0, meta: durationLabel ?? '' };
}

/** "Part 2" when the episode is numbered, else its title. */
export function partName(episode: SeriesEpisode): string {
  return episode.episode_number !== null ? `Part ${episode.episode_number}` : episode.title;
}

/**
 * The Resume/Play pill's two halves: "Resume Part 2" and "0:41 LEFT". `resolveSeriesCta`
 * already picks the episode and the time; this only words it the Signature way.
 */
export function ctaWording(cta: SeriesDetailCta, episode: SeriesEpisode | undefined): { label: string; readout: string | null } {
  const name = episode ? partName(episode) : cta.episodeTitle;
  if (cta.label === 'Resume') {
    return { label: `Resume ${name}`, readout: cta.secondaryReadout ? `${cta.secondaryReadout} LEFT` : null };
  }
  if (cta.label === 'Play Again') return { label: 'Play again', readout: cta.secondaryReadout };
  return { label: `Play ${name}`, readout: cta.secondaryReadout };
}

/**
 * The speaker under the title. Series carry no speaker of their own, so this is the one
 * the episodes share — and nothing when they name more than one, rather than picking.
 */
export function sharedSpeaker(episodes: SeriesEpisode[]): string | null {
  const names = new Set(episodes.map((episode) => episode.speaker_name).filter((name): name is string => Boolean(name)));
  return names.size === 1 ? [...names][0] : null;
}

/**
 * Related, as the classic tab builds it (`RelatedSermons`): other sermons in the series'
 * category, minus this series' own episodes, one episode per other series. Kept beside
 * the Signature grid rather than shared while both skins ship behind the flag.
 */
export function pickRelated<T extends { series_id?: string | null }>(results: T[], seriesId: string): T[] {
  const seen = new Set<string>();
  return results.filter((sermon) => {
    if (!sermon.series_id) return true;
    if (sermon.series_id === seriesId || seen.has(sermon.series_id)) return false;
    seen.add(sermon.series_id);
    return true;
  });
}
