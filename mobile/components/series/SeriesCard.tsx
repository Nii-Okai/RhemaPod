import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { AppText } from '../Text';
import { FadeTitle } from '../FadeTitle';
import { PressableScale } from '../PressableScale';
import { colors } from '../../theme/colors';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import type { SeriesPublic } from '../../lib/query/hooks/useSeries';

export interface SeriesCardProps {
  series: SeriesPublic;
  onPress: () => void;
}

const CARD_WIDTH = 200;
const TITLE_WIDTH = CARD_WIDTH - spacing.md * 2;

function episodeLabel(count: number): string {
  return count === 1 ? '1 episode' : `${count} episodes`;
}

/**
 * A series card with a thumbnail, title, and episode count — originally Home's "Series"
 * shelf card only (design spec §3 Home: "with episode counts"), promoted here once
 * series detail's own "Related" tab (Isaac's ask, session 2026-09-30) became a second
 * consumer. Navigates to `/series/[id]` — a bare `router.push`, per plan W4.4 owning
 * that route's screen; this card does not import or render anything from that screen.
 *
 * `art`'s aspect ratio (16:9) matches `ContinueWatchingCard`'s own — was square (1:1)
 * before, which made this card noticeably taller than that shelf's for no content reason.
 * `resizeMode="cover"` center-crops by default, so this (like the width) needed no extra
 * centering logic of its own.
 */
export function SeriesCard({ series, onPress }: SeriesCardProps) {
  return (
    <PressableScale
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
        <FadeTitle width={TITLE_WIDTH}>{series.title}</FadeTitle>
        <AppText variant="mono.meta" tone="tertiary">
          {episodeLabel(series.episode_count)}
        </AppText>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface.raised,
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
