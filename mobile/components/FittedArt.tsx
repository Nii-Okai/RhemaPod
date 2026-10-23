import React, { useState } from 'react';
import { Image, StyleSheet, View, type ImageLoadEventData, type LayoutChangeEvent, type NativeSyntheticEvent } from 'react-native';
import { darkColors as onArt } from '../theme/colors';

/** Within this much of the frame's own shape, the art just fills it (a sliver of crop). */
const CLOSE_ENOUGH = 0.08;
const BACKDROP_BLUR = 18;

// Width/height of every piece of art seen this session, so a shelf scrolled back into
// view (or the same cover on another shelf) lays out right on its first frame.
const knownRatios = new Map<string, number>();

/** Exported for tests. */
export function artFitFor(artRatio: number | null, frameRatio: number | null): 'fill' | 'fit' {
  if (!artRatio || !frameRatio) return 'fit';
  return Math.abs(artRatio / frameRatio - 1) <= CLOSE_ENOUGH ? 'fill' : 'fit';
}

export interface FittedArtProps {
  uri: string;
  testID?: string;
}

/**
 * Sermon/series artwork in a frame of any shape, never cropped (Nii's ask, 2026-10-23:
 * shelf covers were losing their titles to `cover` crops). Church art is designed as a
 * square poster with the title and speaker set in it, while the shelves draw landscape,
 * square and portrait frames. When the art's shape matches the frame (within 8%) it simply
 * fills it; otherwise the whole piece sits centred over a blurred, dimmed copy of itself
 * — the same treatment Announcements already uses for posters. The blur layer is only
 * drawn when it's needed, so matching art costs nothing extra.
 *
 * Fills its parent (absolute), so drop it into any sized, `overflow: 'hidden'` frame.
 * Dark in both themes: it's a photo surface.
 */
export function FittedArt({ uri, testID }: FittedArtProps) {
  const [frameRatio, setFrameRatio] = useState<number | null>(null);
  const [artRatio, setArtRatio] = useState<number | null>(() => knownRatios.get(uri) ?? null);
  const fit = artFitFor(artRatio, frameRatio);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setFrameRatio(width / height);
  };
  const onLoad = (e: NativeSyntheticEvent<ImageLoadEventData>) => {
    const { width, height } = e.nativeEvent.source ?? {};
    if (width && height) {
      knownRatios.set(uri, width / height);
      setArtRatio(width / height);
    }
  };

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {fit === 'fit' && artRatio !== null ? (
        <>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={BACKDROP_BLUR} />
          <View style={styles.dim} />
        </>
      ) : null}
      <Image
        testID={testID}
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode={fit === 'fill' ? 'cover' : 'contain'}
        onLoad={onLoad}
        accessible={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: onArt.surface.app,
    opacity: 0.35,
  },
});
