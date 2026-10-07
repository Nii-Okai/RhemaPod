import { formatDuration } from '../../../lib/format/duration';
import type { SeriesEpisode } from '../../../lib/query/hooks/useSeries';
import type { ProgressPublic } from '../../../lib/query/hooks/useWatchHistory';

export interface SeriesDetailCta {
  label: 'Resume' | 'Play' | 'Play Again';
  accessibilityLabel: string;
  /** Remaining time (Resume) or full duration (Play/Play Again) — `null` when the
      target episode's own `duration_seconds` isn't known yet. */
  secondaryReadout: string | null;
  episodeId: string;
  /** The target episode's own title — `DownloadPillButton` needs it (download records
      are keyed and labeled per-sermon, same as sermon-detail's own download control),
      so the CTA carries it rather than the screen re-deriving it with a second lookup. */
  episodeTitle: string;
}

/**
 * Series-detail's Play/Resume CTA (Isaac's ask, session 2026-09-30 — Netflix's title-page
 * Play button, which always targets a specific episode, never the series itself) — the
 * sermon-detail screen's own `resolveCta` (`app/sermon/_detail/cta.ts`) picks Fresh vs.
 * Resume for one known sermon; this picks *which episode* first, off the same
 * `/me/history` read the episode rows already use (`buildHistoryMap`), no extra call:
 *
 *  1. An episode already in progress (has a history row, not completed, position > 0) —
 *     Resume that one, same remaining-time math as sermon-detail's own Resume state.
 *  2. Else the first never-played episode in list order (already contiguous 1..N
 *     server-side) — Play.
 *  3. Else every episode is watched — Play Again, from the top.
 *
 * `null` only when the series has no episodes at all — nothing to play.
 */
export function resolveSeriesCta(
  episodes: SeriesEpisode[],
  history: Map<string, ProgressPublic>,
): SeriesDetailCta | null {
  if (episodes.length === 0) return null;

  const inProgress = episodes.find((ep) => {
    const p = history.get(ep.id);
    return p !== undefined && !p.completed && p.position_seconds > 0;
  });
  if (inProgress) {
    const progress = history.get(inProgress.id) as ProgressPublic;
    const remaining =
      inProgress.duration_seconds !== null
        ? Math.max(0, inProgress.duration_seconds - progress.position_seconds)
        : null;
    const remainingLabel = remaining !== null ? formatDuration(remaining) : null;
    return {
      label: 'Resume',
      accessibilityLabel: remainingLabel ? `Resume, ${remainingLabel} remaining` : 'Resume',
      secondaryReadout: remainingLabel,
      episodeId: inProgress.id,
      episodeTitle: inProgress.title,
    };
  }

  const unwatched = episodes.find((ep) => !history.has(ep.id));
  if (unwatched) {
    return {
      label: 'Play',
      accessibilityLabel: `Play ${unwatched.title}`,
      secondaryReadout: unwatched.duration_seconds !== null ? formatDuration(unwatched.duration_seconds) : null,
      episodeId: unwatched.id,
      episodeTitle: unwatched.title,
    };
  }

  const first = episodes[0];
  return {
    label: 'Play Again',
    accessibilityLabel: `Play ${first.title} again`,
    secondaryReadout: first.duration_seconds !== null ? formatDuration(first.duration_seconds) : null,
    episodeId: first.id,
    episodeTitle: first.title,
  };
}
