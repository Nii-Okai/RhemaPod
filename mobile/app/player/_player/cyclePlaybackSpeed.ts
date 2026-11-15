import { PLAYBACK_SPEEDS, type PlaybackSpeed } from '../../../lib/settings/playbackPreferences';

/**
 * Cycles to the next speed in `lib/settings/playbackPreferences.ts`'s own
 * `PLAYBACK_SPEEDS` list ("the five speeds design spec 1d's transport control exposes
 * elsewhere in the app"), wrapping back to the first after the last. Reuses that list
 * rather than declaring a second one here. This control is the only way to change
 * playback speed; `defaultSpeed`/`PLAYBACK_SPEEDS` stay the shared source of truth.
 *
 * Defensive against an unrecognized current value (e.g. a future migration that widens
 * the list) by falling back to the first entry rather than throwing on `indexOf`
 * returning `-1`.
 */
export function nextPlaybackSpeed(current: PlaybackSpeed): PlaybackSpeed {
  const index = PLAYBACK_SPEEDS.indexOf(current);
  const nextIndex = index === -1 ? 0 : (index + 1) % PLAYBACK_SPEEDS.length;
  return PLAYBACK_SPEEDS[nextIndex];
}

/** `1` -> `"1×"`, `1.25` -> `"1.25×"` — same formatting convention as `PlaybackSection`'s `speedLabel`. */
export function formatPlaybackSpeed(speed: PlaybackSpeed): string {
  return `${speed}×`;
}
