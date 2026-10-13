import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { AppText } from '../Text';
import { FadeTitle } from '../FadeTitle';
import { PressableScale } from '../PressableScale';
import { ProgressBar } from '../ProgressBar';
import { colors } from '../../theme/colors';
import { radius } from '../../theme/radius';
import { spacing } from '../../theme/spacing';
import { formatDuration } from '../../lib/format/duration';
import type { ContinueWatchingItem } from '../../lib/query/hooks/useContinueWatching';

export interface ContinueWatchingCardProps {
  item: ContinueWatchingItem;
  onPress: () => void;
}

const CARD_WIDTH = 200;
const TITLE_WIDTH = CARD_WIDTH - spacing.md * 2;

/** Remaining time, floored at 0 — never a negative "-2:14 left" if a stale duration lags a position update. */
function remainingLabel(item: ContinueWatchingItem): string | null {
  if (item.duration_seconds === null) return null;
  const remaining = Math.max(0, item.duration_seconds - item.position_seconds);
  return `${formatDuration(remaining)} left`;
}

/** "Category · N:NN left" — category before the remaining time (Isaac's ask, session
 * 2026-10-10), same `[category, stat].filter(Boolean).join(' · ')` shape `DownloadRow`'s
 * own meta line already uses, rendered together in one `mono` line rather than the
 * category getting its own non-mono segment — matching that existing precedent instead
 * of inventing a second convention for "category paired with a stat". */
function metaLineFor(item: ContinueWatchingItem): string | null {
  const parts = [item.category_name, remainingLabel(item)].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Home's "Continue watching" shelf card (design spec §3 Home: "in-progress items with
 * time-remaining"). Compact-density card per §4's "two density variants" note — a fixed-
 * width shelf card, not the grid-width `SermonCard` category/speaker drill-down use.
 *
 * The progress bar overlaid on the art's bottom edge reuses the shared `ProgressBar`
 * (track + gold fill, §4 — the same primitive download-progress rows use) rather than a
 * one-off bar, and reads `percent_complete` straight off the API response instead of
 * deriving it from `position_seconds`/`duration_seconds` itself — the backend
 * (`analytics_service.continue_watching`) already computes and caps that value server-side.
 * Omitted entirely (not drawn at 0%) when `percent_complete` is `null` — that only happens
 * when `duration_seconds` itself is unknown, in which case there's nothing true to show.
 */
export function ContinueWatchingCard({ item, onPress }: ContinueWatchingCardProps) {
  const metaLine = metaLineFor(item);
  const label = metaLine ? `${item.title}, ${metaLine}` : item.title;
  const progress = item.percent_complete !== null ? item.percent_complete / 100 : null;

  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.card}>
      <View style={styles.artWrap}>
        {item.thumbnail_url ? (
          <Image source={{ uri: item.thumbnail_url }} style={styles.art} resizeMode="cover" />
        ) : (
          <View style={styles.artFallback} />
        )}
        {progress !== null ? (
          <View style={styles.progressOverlay}>
            <ProgressBar
              progress={progress}
              accessibilityLabel={`${Math.round(progress * 100)} percent watched`}
              height={3}
            />
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <FadeTitle width={TITLE_WIDTH}>{item.title}</FadeTitle>
        {metaLine ? (
          <AppText variant="mono.meta" tone="tertiary">
            {metaLine}
          </AppText>
        ) : null}
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
  artWrap: {
    width: CARD_WIDTH,
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
  progressOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  body: {
    padding: spacing.md,
    gap: spacing.xs,
  },
});
