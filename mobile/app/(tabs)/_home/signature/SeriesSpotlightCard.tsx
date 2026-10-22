import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText, PlatformIcon } from '../../../../components';
import { createThemedStyles, useTheme } from '../../../../theme/ThemeContext';
import { radius } from '../../../../theme/radius';
import { spacing } from '../../../../theme/spacing';
import type { SeriesPublic } from '../../../../lib/query/hooks/useSeries';
import { Flame } from './Flame';
import { LEAF_SM } from './leaf';

export interface SeriesSpotlightCardProps {
  series: SeriesPublic;
  onPress: () => void;
}

/**
 * The top of Home's Series section for a viewer with no "your walk" yet — nothing in
 * progress for `useSeriesWalk` to build one from (every brand-new account; Isaac's ask,
 * 2026-10-22: the section jumped straight to the plain two-column grid with no flame
 * treatment up top at all). Features one series (the caller's choice — `SignatureHome`
 * picks the first the catalog API returns) with the same card shape and flame accent as
 * `SeriesWalkCard`, but honestly: no per-episode flame row, since there's no progress to
 * show yet. Opens the series, same destination `SeriesWalkCard`'s own tap does.
 */
export function SeriesSpotlightCard({ series, onPress }: SeriesSpotlightCardProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const episodes = `${series.episode_count} ${series.episode_count === 1 ? 'episode' : 'episodes'}`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${series.title}. ${episodes}. Start this series.`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.thumb}>
        {series.thumbnail_url ? (
          <Image source={{ uri: series.thumbnail_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : null}
      </View>
      <View style={styles.text}>
        <View style={styles.eyebrowRow}>
          <Flame width={9} fill={colors.accent.gold} />
          <AppText variant="mono.meta" tone="gold">
            START A SERIES
          </AppText>
        </View>
        <AppText variant="ui.bodyLarge" numberOfLines={2}>
          {series.title}
        </AppText>
        <AppText variant="ui.body" tone="secondary" numberOfLines={1}>
          {episodes}
        </AppText>
      </View>
      <View style={styles.chevron}>
        <PlatformIcon name="chevron-forward" size={18} color={colors.text.tertiary} />
      </View>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    ...LEAF_SM,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
  },
  pressed: {
    opacity: 0.85,
  },
  thumb: {
    ...LEAF_SM,
    width: 72,
    height: 72,
    overflow: 'hidden',
    backgroundColor: colors.surface.sunken,
  },
  text: {
    flex: 1,
    gap: spacing.xs,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm - 2,
  },
  chevron: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
