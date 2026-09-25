import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../Text';
import { spacing } from '../../theme/spacing';
import type { SeriesEpisode } from '../../lib/query/hooks/useSeries';

export interface EpisodeRowProps {
  episode: SeriesEpisode;
  /** "watched" / "17:04 left" / "new" — see `lib/format/episodeStatus.ts`. */
  status: string;
  onPress: () => void;
}

/**
 * One series-episode row (design spec 1h): mono episode number, title, and
 * a mono status meta line — the design spec's own "mono meta line
 * (duration, status)" convention (§4), the same one `SermonResultRow`
 * already applies to duration + speaker.
 *
 * `episode.episode_number` is rendered exactly as the server sends it on
 * `GET /series/{id}/episodes` (already contiguous 1..N, gaps hidden
 * server-side per plan L11/W2.3) — this component never renumbers, and an
 * unnumbered episode (`episode_number: null`) renders with no number at
 * all, never "00" or any placeholder digit.
 */
export function EpisodeRow({ episode, status, onPress }: EpisodeRowProps) {
  const number = episode.episode_number !== null ? String(episode.episode_number).padStart(2, '0') : null;
  const accessibleParts = [number ? `Episode ${number}` : null, episode.title, status].filter(
    (part): part is string => Boolean(part),
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibleParts.join(', ')}
      style={styles.row}
    >
      {number ? (
        <AppText variant="mono.tight" tone="gold" style={styles.number}>
          {number}
        </AppText>
      ) : null}
      <View style={styles.textBlock}>
        <AppText variant="display.compact" numberOfLines={2}>
          {episode.title}
        </AppText>
        <AppText variant="mono.meta" tone="tertiary" style={styles.meta}>
          {status}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  number: {
    width: 24,
  },
  textBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  meta: {
    marginTop: 0,
  },
});
