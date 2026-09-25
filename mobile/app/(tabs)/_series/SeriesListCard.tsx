import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { AppText, Card } from '../../../components';
import { spacing } from '../../../theme/spacing';
import type { SeriesPublic } from '../../../lib/query/hooks/useSeries';

export interface SeriesListCardProps {
  series: SeriesPublic;
  onPress: () => void;
}

function countLabel(count: number): string {
  return count === 1 ? '1 episode' : `${count} episodes`;
}

/**
 * Tablet Series rail tab's list row (plan W4.4, P3) — deliberately minimal:
 * the design spec draws no dedicated screen for this destination, only the
 * rail slot itself and Home's "Series" shelf (which W4.1 owns), so this
 * mirrors Browse's `CategoryCard` composition (title + mono count) rather
 * than inventing new visual language for a screen the spec never drew.
 */
export function SeriesListCard({ series, onPress }: SeriesListCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${series.title}, ${countLabel(series.episode_count)}`}
      style={styles.pressable}
    >
      <Card>
        <AppText variant="display.compact">{series.title}</AppText>
        <AppText variant="mono.meta" tone="tertiary" style={styles.meta}>
          {countLabel(series.episode_count)}
        </AppText>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    marginBottom: spacing.md,
  },
  meta: {
    marginTop: spacing.xs,
  },
});
