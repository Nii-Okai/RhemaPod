import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import type { SeriesListItem } from '../../../lib/query/hooks/useSeries';

export interface SeriesCardProps {
  series: SeriesListItem;
  onPress: () => void;
}

const CARD_WIDTH = 160;

function episodeLabel(count: number): string {
  return count === 1 ? '1 episode' : `${count} episodes`;
}

/**
 * Home's "Series" shelf card (design spec §3 Home: "with episode counts"; §4 "Series
 * shelf — horizontal-scroll row of series cards with episode counts"). Navigates to
 * `/series/[id]` — a bare `router.push`, per plan W4.4 owning that route's screen; this
 * card does not import or render anything from that screen.
 */
export function SeriesCard({ series, onPress }: SeriesCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${series.title}, ${episodeLabel(series.episode_count)}`}
      style={styles.card}
    >
      {series.thumbnail_url ? (
        <Image source={{ uri: series.thumbnail_url }} style={styles.art} resizeMode="cover" />
      ) : (
        <View style={styles.artFallback} />
      )}
      <View style={styles.body}>
        <AppText variant="display.compact" numberOfLines={1}>
          {series.title}
        </AppText>
        <AppText variant="mono.meta" tone="tertiary">
          {episodeLabel(series.episode_count)}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface.raised,
  },
  art: {
    width: CARD_WIDTH,
    aspectRatio: 1,
  },
  artFallback: {
    width: CARD_WIDTH,
    aspectRatio: 1,
    backgroundColor: colors.surface.sunken,
  },
  body: {
    padding: spacing.md,
    gap: spacing.xs,
  },
});
