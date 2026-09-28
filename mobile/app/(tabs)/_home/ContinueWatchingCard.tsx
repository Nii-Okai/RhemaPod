import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { formatDuration } from '../../../lib/format/duration';
import type { ContinueWatchingItem } from '../../../lib/query/hooks/useContinueWatching';

export interface ContinueWatchingCardProps {
  item: ContinueWatchingItem;
  onPress: () => void;
}

const CARD_WIDTH = 160;

/** Remaining time, floored at 0 — never a negative "-2:14 left" if a stale duration lags a position update. */
function remainingLabel(item: ContinueWatchingItem): string | null {
  if (item.duration_seconds === null) return null;
  const remaining = Math.max(0, item.duration_seconds - item.position_seconds);
  return `${formatDuration(remaining)} left`;
}

/**
 * Home's "Continue watching" shelf card (design spec §3 Home: "in-progress items with
 * time-remaining"). Compact-density card per §4's "two density variants" note — a fixed-
 * width shelf card, not the full-width `SermonResultRow` used by Search/Browse drill-down.
 */
export function ContinueWatchingCard({ item, onPress }: ContinueWatchingCardProps) {
  const remaining = remainingLabel(item);
  const label = remaining ? `${item.title}, ${remaining}` : item.title;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      {item.thumbnail_url ? (
        <Image source={{ uri: item.thumbnail_url }} style={styles.art} resizeMode="cover" />
      ) : (
        <View style={styles.artFallback} />
      )}
      <View style={styles.body}>
        <AppText variant="display.compact" numberOfLines={2}>
          {item.title}
        </AppText>
        {remaining ? (
          <AppText variant="mono.meta" tone="tertiary">
            {remaining}
          </AppText>
        ) : null}
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
  cardPressed: {
    opacity: 0.7,
  },
  art: {
    width: CARD_WIDTH,
    aspectRatio: 16 / 9,
  },
  artFallback: {
    width: CARD_WIDTH,
    aspectRatio: 16 / 9,
    backgroundColor: colors.surface.sunken,
  },
  body: {
    padding: spacing.md,
    gap: spacing.xs,
  },
});
