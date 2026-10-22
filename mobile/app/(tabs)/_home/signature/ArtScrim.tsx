import React from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { darkColors as onArt } from '../../../../theme/colors';

/**
 * Fade from clear to the dark panel colour along the bottom of a piece of art. A true
 * SVG gradient: stacked flat bands showed as visible stripes over light artwork on a
 * phone (Nii's test, 2026-10-21). Dark in both themes — it sits on the art.
 */
export function ArtScrim({ height = '45%' }: { height?: DimensionValue }) {
  return (
    <View style={[styles.scrim, { height }]} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="artScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={onArt.surface.app} stopOpacity={0} />
            <Stop offset="0.5" stopColor={onArt.surface.app} stopOpacity={0.45} />
            <Stop offset="1" stopColor={onArt.surface.app} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#artScrim)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
