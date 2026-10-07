import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SkeletonBlock } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';

/**
 * Static loading placeholder for Home's hero (design spec §3 Home: "loading: skeleton
 * shelves, standard pattern, not source-specified"). Sized to `HeroCard`'s own real
 * footprint — a 4:3 art block, then the footer's meta bar below it (no title bar: the
 * real card renders no separate title text, since sermon art already carries it) —
 * matching §8.4's skeleton convention (same "no shimmer/motion" rule, §1.4).
 */
export function HeroSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading home" style={styles.card}>
      <View style={styles.art} />
      <View style={styles.body}>
        <SkeletonBlock height={11} width="45%" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface.raised,
  },
  art: {
    aspectRatio: 4 / 3,
    backgroundColor: colors.border.card,
  },
  body: {
    gap: spacing.sm,
    padding: spacing.lg,
  },
});
