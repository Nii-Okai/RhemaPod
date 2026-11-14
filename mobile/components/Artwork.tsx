import React from 'react';
import { Image, type ImageProps, type ImageSource } from 'expo-image';

/** How long a freshly downloaded piece of art takes to fade in. Short enough to feel
    instant, long enough that art never "pops". Art already in the memory cache (a shelf
    scrolled back into view, a screen revisited) shows on its first frame with no fade. */
export const ART_FADE_MS = 180;

export interface ArtworkProps extends Omit<ImageProps, 'source' | 'cachePolicy' | 'recyclingKey'> {
  /** Remote URL or local `file://` path. Empty/undefined renders nothing but the frame's
      own background, so callers can keep their tinted fallback surface. */
  uri?: string | null;
  /** Bundled image shown when `uri` is empty (e.g. the countdown card's stock photo). */
  fallback?: number;
}

/**
 * The cache key for a piece of art: its URL without the query string.
 *
 * The API hands out image URLs signed for a 24-hour window
 * (`app/core/storage.py:stable_image_url`), so the signature changes every day while the
 * object behind it never does: every image key has a fresh UUID per upload, so a new
 * cover is always a new path. Keying the cache on the path keeps art cached for good
 * instead of re-downloading the whole catalogue each day. Local `file://` paths have no
 * query and pass through unchanged.
 */
export function artworkCacheKey(uri: string): string {
  const q = uri.indexOf('?');
  return q === -1 ? uri : uri.slice(0, q);
}

/**
 * Every piece of sermon, series, playlist and profile art in the app goes through this.
 *
 * Built on `expo-image` rather than React Native's `Image` so art is cached in memory and
 * on disk across launches (React Native's `Image` re-downloads on Android and keeps no
 * disk cache of its own on iOS), decoded off the main thread, and faded in instead of
 * popping. `recyclingKey` is the art's cache key, so a recycled row in a `FlashList` blanks straight
 * away rather than briefly flashing the previous row's art.
 *
 * Callers size the frame and give it a tinted background; that background is the
 * placeholder while art loads.
 */
export function Artwork({ uri, fallback, transition = ART_FADE_MS, contentFit = 'cover', ...rest }: ArtworkProps) {
  const cacheKey = uri ? artworkCacheKey(uri) : null;
  const source: ImageSource | number | null = uri && cacheKey ? { uri, cacheKey } : (fallback ?? null);
  return (
    <Image
      source={source}
      cachePolicy="memory-disk"
      recyclingKey={cacheKey}
      transition={transition}
      contentFit={contentFit}
      {...rest}
    />
  );
}
