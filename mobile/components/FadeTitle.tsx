import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './Text';
import { useTheme } from '../theme/ThemeContext';
import { scaledLineHeight } from '../theme/typography';

export interface FadeTitleProps {
  children: string;
  width: number;
}

const FONT_SIZE = 14;
const LINE_HEIGHT_RATIO = 1.2;
const FADE_WIDTH = 28;

/**
 * Single-line shelf-card title that fades into the card's own background at the right
 * edge instead of ending in an ellipsis (Isaac's reference: a streaming app's card
 * titles) — `ellipsizeMode="clip"` (no "…" glyph) plus a right-edge overlay of
 * `colors.fade`'s stacked bands, which assume the card sitting behind this title is
 * `surface.raised` (true of every current call site: `ContinueWatchingCard`,
 * `SeriesCard`). `width` must be the *caller's* own content width (card width minus its
 * own horizontal padding) — this component has no way to know that itself.
 *
 * Bold by explicit ask (both call sites' own commit). NOTE: theme/typography.ts documents
 * Newsreader (`display.compact`, used here) as "Always weight 400 — no bold serif
 * anywhere in the source... a hard constraint from the brief." This knowingly overrides
 * that locked rule — centralized here now instead of duplicated per call site, but still
 * worth knowing it's a rule being broken, not followed.
 *
 * Two concrete call sites today (`ContinueWatchingCard`, `SeriesCard`) — the bar this
 * codebase's other promoted primitives (`Tag`, `SkeletonBlock`) use for living in
 * `components/` rather than staying screen-local.
 */
export function FadeTitle({ children, width }: FadeTitleProps) {
  const { colors } = useTheme();
  return (
    <View style={{ width }}>
      <AppText variant="display.compact" numberOfLines={1} ellipsizeMode="clip" style={styles.title}>
        {children}
      </AppText>
      <View style={styles.fade} pointerEvents="none">
        {colors.fade.layers.map((layerColor, index) => (
          <View key={index} style={[styles.fadeLayer, { backgroundColor: layerColor }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: FONT_SIZE,
    lineHeight: scaledLineHeight(FONT_SIZE, LINE_HEIGHT_RATIO),
    fontWeight: 'bold',
  },
  fade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: FADE_WIDTH,
    flexDirection: 'row',
  },
  fadeLayer: {
    flex: 1,
  },
});
