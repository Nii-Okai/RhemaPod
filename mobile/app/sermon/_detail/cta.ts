import { formatDuration } from '../../../lib/format/duration';
import { isPlayable, type SermonDetail } from './isPlayable';
import type { components } from '../../../lib/api/schema';

export type ProgressPublic = components['schemas']['ProgressPublic'];

export interface SermonDetailCta {
  disabled: boolean;
  label: string;
  accessibilityLabel: string;
  /** Full duration (Fresh) or remaining time (Resume) — `null` in the no-media/locked state. */
  secondaryReadout: string | null;
  /** Only set in the no-media/locked state (§8.3). */
  caption: string | null;
}

const NO_MEDIA_CAPTION = 'Video is still processing — check back soon.';

/**
 * CTA label/state per design spec §8.4, resolving Fresh-vs-Resume off
 * `GET /sermons/{id}/progress` directly rather than the bounded `/me/continue-watching` list (see `useSermonProgress.ts`'s
 * docstring for why: continue-watching is capped at the endpoint's own `limit=10`).
 *
 * "Fresh" also covers a `completed: true` progress row: a fully-watched sermon has nothing
 * left to resume, so it shows as Fresh (full duration, Play/Listen) the same as "never
 * played". (The addendum, §8.4, defines Fresh vs. Resume only for the continue-watching
 * list, which never returns a completed sermon.)
 */
export function resolveCta(detail: SermonDetail, progress: ProgressPublic | null): SermonDetailCta {
  if (!isPlayable(detail)) {
    return {
      disabled: true,
      label: 'Not available yet',
      accessibilityLabel: 'Not available yet',
      secondaryReadout: null,
      caption: NO_MEDIA_CAPTION,
    };
  }

  const hasVideo = detail.media_refs.some((ref) => ref.type === 'video');
  const isResuming = progress !== null && !progress.completed && progress.position_seconds > 0;

  if (isResuming) {
    const remaining =
      detail.duration_seconds !== null ? Math.max(0, detail.duration_seconds - progress.position_seconds) : null;
    const remainingLabel = remaining !== null ? formatDuration(remaining) : null;
    return {
      disabled: false,
      label: 'Resume',
      accessibilityLabel: remainingLabel ? `Resume sermon, ${remainingLabel} remaining` : 'Resume sermon',
      secondaryReadout: remainingLabel,
      caption: null,
    };
  }

  return {
    disabled: false,
    label: hasVideo ? 'Play' : 'Listen',
    accessibilityLabel: hasVideo ? 'Play sermon' : 'Listen to sermon',
    secondaryReadout: detail.duration_seconds !== null ? formatDuration(detail.duration_seconds) : null,
    caption: null,
  };
}
