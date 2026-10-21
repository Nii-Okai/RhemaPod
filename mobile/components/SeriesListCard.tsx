import React from 'react';
import { Image, Pressable, View } from 'react-native';
import { AppText } from './Text';
import { Card } from './Card';
import { createThemedStyles } from '../theme/ThemeContext';
import { spacing } from '../theme/spacing';
import type { SeriesPublic } from '../lib/query/hooks/useSeries';

export interface SeriesListCardProps {
  series: SeriesPublic;
  onPress: () => void;
}

function countLabel(count: number): string {
  return count === 1 ? '1 episode' : `${count} episodes`;
}

/**
 * The all-series list's row (`(tabs)/series.tsx`, reached from the tablet rail and, since
 * W4.1, Home's "See all series" link too) — full-width art on top, title + episode count
 * below. `Card padded={false}` gives the rounded-corner/border/overflow-hidden frame the
 * art needs; the text block below pads itself.
 */
export function SeriesListCard({ series, onPress }: SeriesListCardProps) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${series.title}, ${countLabel(series.episode_count)}`}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
    >
      <Card padded={false}>
        {series.thumbnail_url ? (
          <Image source={{ uri: series.thumbnail_url }} style={styles.art} resizeMode="cover" />
        ) : (
          <View style={styles.artFallback} />
        )}
        <View style={styles.body}>
          <AppText variant="display.compact">{series.title}</AppText>
          <AppText variant="mono.meta" tone="tertiary" style={styles.meta}>
            {countLabel(series.episode_count)}
          </AppText>
        </View>
      </Card>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  pressable: {
    marginBottom: spacing.lg,
  },
  pressed: {
    opacity: 0.7,
  },
  art: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  artFallback: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: colors.surface.sunken,
  },
  body: {
    padding: spacing.lg,
  },
  meta: {
    marginTop: spacing.xs,
  },
}));
