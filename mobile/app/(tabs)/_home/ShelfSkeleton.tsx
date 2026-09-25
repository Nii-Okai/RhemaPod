import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SkeletonBlock } from '../../../components';
import { spacing } from '../../../theme/spacing';

export interface ShelfSkeletonProps {
  loadingLabel: string;
}

const CARD_WIDTH = 160;

/**
 * Static loading placeholder for a Home shelf (Continue watching / Series) — three
 * fixed-width card-shaped blocks, matching each real shelf card's own footprint
 * (`ContinueWatchingCard`/`SeriesCard`, both 160px wide).
 */
export function ShelfSkeleton({ loadingLabel }: ShelfSkeletonProps) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={loadingLabel} style={styles.row}>
      {[0, 1, 2].map((key) => (
        <SkeletonBlock key={key} width={CARD_WIDTH} height={140} radiusToken="lg" />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
});
