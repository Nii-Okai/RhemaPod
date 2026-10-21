import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../../components';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import { formatDuration } from '../../../lib/format/duration';
import { PlayerSeekBar } from '../_player/PlayerSeekBar';
import { SEEK_SECONDS } from '../_player/TransportControls';

export interface SignatureSeekRowProps {
  currentTimeSeconds: number;
  /** `null` before the player has resolved a duration. */
  durationSeconds: number | null;
  onSeekTo: (seconds: number) => void;
  onSeekBy: (seconds: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
}

/**
 * The Signature player's always-visible seek row, under the video rather than on its
 * auto-hiding overlay: the same drag-to-scrub bar, in the page's own theme colours, over
 * mono elapsed and remaining times.
 */
export function SignatureSeekRow({
  currentTimeSeconds,
  durationSeconds,
  onSeekTo,
  onSeekBy,
  onScrubStart,
  onScrubEnd,
}: SignatureSeekRowProps) {
  const { colors } = useTheme();
  const remaining = durationSeconds ? Math.max(0, durationSeconds - currentTimeSeconds) : null;

  return (
    <View style={styles.row}>
      <PlayerSeekBar
        currentTimeSeconds={currentTimeSeconds}
        durationSeconds={durationSeconds}
        onSeek={onSeekTo}
        onAdjust={onSeekBy}
        adjustStepSeconds={SEEK_SECONDS}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
        palette={{ track: colors.track.default, fill: colors.accent.gold, thumb: colors.text.primary }}
      />
      <View
        style={styles.times}
        accessible
        accessibilityLabel={`${formatDuration(currentTimeSeconds)} of ${formatDuration(durationSeconds)}`}
      >
        <AppText variant="mono.meta" tone="secondary">
          {formatDuration(currentTimeSeconds)}
        </AppText>
        <AppText variant="mono.meta" tone="secondary">
          {remaining === null ? formatDuration(null) : `-${formatDuration(remaining)}`}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: spacing.lg,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -spacing.sm,
  },
});
