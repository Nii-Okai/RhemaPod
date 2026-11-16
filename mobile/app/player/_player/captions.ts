import {
  CAPTION_LANGUAGES,
  type CaptionLanguageCode,
  type CaptionPreference,
} from '../../../lib/settings/playbackPreferences';

/** The fields this module reads off expo-video's `SubtitleTrack` (not exported by 2.0.x). */
export interface SubtitleTrack {
  id?: string;
  language: string;
  label: string;
}

/**
 * Subtitle tracks come from the video's HLS manifest: the backend attaches an English
 * caption track (generated from the sermon audio) and a French one (translated from it)
 * to every video on Cloudflare Stream, which lists them in the manifest. This module maps
 * those native tracks onto the two languages the app offers.
 */

const ALIASES: Record<CaptionLanguageCode, readonly string[]> = {
  en: ['en', 'eng'],
  fr: ['fr', 'fra', 'fre'],
};

function codeOf(track: SubtitleTrack): CaptionLanguageCode | null {
  const base = (track.language ?? '').toLowerCase().split(/[-_]/)[0];
  for (const code of CAPTION_LANGUAGES) {
    if (ALIASES[code].includes(base)) return code;
  }
  return null;
}

/** The app's caption languages this video actually carries, English first. */
export function availableCaptionLanguages(tracks: readonly SubtitleTrack[]): CaptionLanguageCode[] {
  const present = new Set(tracks.map(codeOf).filter((c): c is CaptionLanguageCode => c !== null));
  return CAPTION_LANGUAGES.filter((code) => present.has(code));
}

/**
 * The track to show for a preference. Captions on but the chosen language missing on this
 * video falls back to English (the default language), then to whatever exists.
 */
export function trackForPreference<T extends SubtitleTrack>(
  tracks: readonly T[],
  preference: CaptionPreference,
): T | null {
  if (preference === 'off') return null;
  const order: CaptionLanguageCode[] = [preference, 'en', ...CAPTION_LANGUAGES];
  for (const code of order) {
    const track = tracks.find((t) => codeOf(t) === code);
    if (track) return track;
  }
  return null;
}

/** The CC control's tap order: Off → English → Français → Off, skipping missing languages. */
export function nextCaptionPreference(
  current: CaptionPreference,
  available: readonly CaptionLanguageCode[],
): CaptionPreference {
  const cycle: CaptionPreference[] = ['off', ...available];
  const index = cycle.indexOf(current);
  return cycle[(index + 1) % cycle.length];
}

/** What the CC control shows for the language actually on screen. */
export function captionBadge(active: CaptionLanguageCode | null): string {
  return active ? active.toUpperCase() : 'CC';
}

export function captionAccessibilityLabel(active: CaptionLanguageCode | null): string {
  if (active === 'en') return 'Subtitles, English';
  if (active === 'fr') return 'Subtitles, French';
  return 'Subtitles, off';
}

export function activeCaptionLanguage(track: SubtitleTrack | null): CaptionLanguageCode | null {
  return track ? codeOf(track) : null;
}
