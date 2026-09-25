import React from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import { colors } from '../theme/colors';
import { radius, type RadiusToken } from '../theme/radius';

export interface SkeletonBlockProps {
  width?: DimensionValue;
  height: number;
  radiusToken?: RadiusToken;
}

/**
 * Static, non-animated loading placeholder (design spec §8.4/§8.6) — `border.card` fill,
 * sized per call site to each region's real footprint rather than a generic guess. §1.4
 * encodes zero skeleton motion anywhere in this app; this primitive doesn't invent one
 * past that section's own stated restraint.
 *
 * One confirmed MVP use per screen today (sermon-detail's loading state, §8.4); Home's
 * shelf skeletons (W4.1) are the second concrete use that clears the promotion bar (§8.6).
 */
export function SkeletonBlock({ width = '100%', height, radiusToken = 'md' }: SkeletonBlockProps) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.base, { width, height, borderRadius: radius[radiusToken] }]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.border.card,
  },
});
