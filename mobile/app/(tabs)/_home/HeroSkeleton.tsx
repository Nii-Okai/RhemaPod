import React from 'react';
import { View } from 'react-native';
import { SkeletonBlock } from '../../../components';
import { createThemedStyles } from '../../../theme/ThemeContext';
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
  const styles = useStyles();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading home" style={styles.card}>
      <View style={styles.art} />
      <View style={styles.body}>
        <SkeletonBlock height={11} width="45%" />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
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
}));
