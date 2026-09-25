import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SkeletonBlock } from '../../../components';
import { spacing } from '../../../theme/spacing';

/**
 * Static loading placeholder for Home's hero (design spec §3 Home: "loading: skeleton
 * shelves, standard pattern, not source-specified"). Sized to the hero's own real
 * footprint — 16:9 art block, two title bars, one meta bar — matching §8.4's skeleton
 * convention (same "no shimmer/motion" rule, §1.4).
 */
export function HeroSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading home" style={styles.card}>
      <SkeletonBlock height={200} radiusToken="xl" />
      <View style={styles.body}>
        <SkeletonBlock height={14} width="40%" />
        <SkeletonBlock height={26} width="70%" />
        <SkeletonBlock height={11} width="45%" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
  },
  body: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
});
