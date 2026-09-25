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
 * CTA label/state per design spec §8.4, using the Conductor's decision (W4.1) to resolve
 * Fresh-vs-Resume off `GET /sermons/{id}/progress` directly rather than the addendum's
 * originally-bound, bounded `/me/continue-watching` list (see `useSermonProgress.ts`'s
 * docstring for why: continue-watching is capped at the endpoint's own `limit=10`).
 *
 * "Fresh" also covers a `completed: true` progress row — the addendum (§8.4) only ever
 * defines Fresh vs. Resume off the old bounded list, which by construction never returns
 * a completed sermon; a fully-watched sermon has nothing left to resume, so it collapses
 * to Fresh (full duration, Play/Listen) the same as "never played". This is a small,
 * necessary extrapolation of the addendum's own definition onto the new data source, not
 * a new product decision — flagged here, not silently assumed.
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
