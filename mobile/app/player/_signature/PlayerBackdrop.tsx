import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Artwork } from '../../../components/Artwork';
import { useTheme } from '../../../theme/ThemeContext';

/**
 * How much of the page colour lies over the blurred art, top to bottom. The top is where
 * the colour shows most (behind the header, the Watch/Listen switch and the title); it
 * thickens toward the queue and comments, which sit on their own cards anyway.
 *
 * Chosen for readability first: even over pure white art in the dark theme, or pure black
 * art in the light one (far harsher than any real cover once blurred), primary text keeps
 * at least 4.5:1 everywhere and secondary text 3:1 (`__tests__/PlayerBackdrop.test.tsx`).
 */
export const BACKDROP_SCRIM = [
  { offset: 0, opacity: 0.7 },
  { offset: 0.55, opacity: 0.76 },
  { offset: 1, opacity: 0.94 },
] as const;

// The art is drawn at a quarter of the screen and scaled up: the platform blur works on
// far fewer pixels (cheap, and Android caps its blur radius at 25), and the upscale
// smooths it further. The overscan hides the soft, see-through edges a blur leaves.
const SHRINK = 4;
const OVERSCAN = 1.25;
const BLUR = 20;
/** Long, so the colour drifts rather than snaps when the queue moves to the next sermon. */
const CROSSFADE_MS = 600;

/**
 * The full player's background (Nii, 2026-11-15): the sermon's own art, heavily blurred,
 * under a wash of the page colour, so every sermon's player takes on the colours of its
 * cover the way Apple Music's and Spotify's do. Works in both themes because the wash is
 * the theme's own page colour: a dark glow in the dark theme, a pale tint in the light one,
 * with text in its usual colours on top. Without art it is just the plain page.
 *
 * No new native code: `expo-image`'s blur and `react-native-svg`, both already in the app.
 */
export function PlayerBackdrop({ uri }: { uri?: string | null }) {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const artWidth = Math.ceil(width / SHRINK);
  const artHeight = Math.ceil(height / SHRINK);

  return (
    <View testID="player-backdrop" style={styles.fill} pointerEvents="none">
      {uri ? (
        <View style={styles.center}>
          <Artwork
            testID="player-backdrop-art"
            uri={uri}
            blurRadius={BLUR}
            transition={CROSSFADE_MS}
            accessible={false}
            style={{ width: artWidth, height: artHeight, transform: [{ scale: SHRINK * OVERSCAN }] }}
          />
        </View>
      ) : null}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="playerBackdrop" x1="0" y1="0" x2="0" y2="1">
            {BACKDROP_SCRIM.map((stop) => (
              <Stop key={stop.offset} offset={stop.offset} stopColor={colors.surface.app} stopOpacity={uri ? stop.opacity : 1} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#playerBackdrop)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
