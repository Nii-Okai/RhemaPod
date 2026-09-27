import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText, IconButton, ProgressBar } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { formatDuration } from '../../../lib/format/duration';
import { formatPlaybackSpeed } from './cyclePlaybackSpeed';
import type { PlaybackSpeed } from '../../../lib/settings/playbackPreferences';

const SEEK_SECONDS = 15;

export interface TransportControlsProps {
  isPlaying: boolean;
  currentTimeSeconds: number;
  /** `null` before the player has resolved a duration (still loading). */
  durationSeconds: number | null;
  playbackSpeed: PlaybackSpeed;
  /** `null` when no sleep timer is armed. */
  sleepRemainingSeconds: number | null;
  onTogglePlay: () => void;
  onSeekBy: (seconds: number) => void;
  onCycleSpeed: () => void;
  onOpenSleepTimer: () => void;
}

/**
 * Player screen's transport row (design spec §3 Player: "transport controls, speed,
 * sleep timer"). Seeking is fixed-increment (±15s) rather than drag-to-scrub — this app's
 * design system has no draggable-slider primitive yet (`ProgressBar` is a read-only
 * `accessibilityRole="progressbar"` indicator, shared with the Downloads-screen progress
 * row, spec §4), and building one is a new interaction primitive with no second concrete
 * use case today, not something this slice should invent unprompted. Flagged, not silently
 * scoped down: `status.md` records this as the one missing manual-scrub gesture.
 */
export function TransportControls({
  isPlaying,
  currentTimeSeconds,
  durationSeconds,
  playbackSpeed,
  sleepRemainingSeconds,
  onTogglePlay,
  onSeekBy,
  onCycleSpeed,
  onOpenSleepTimer,
}: TransportControlsProps) {
  const progress = durationSeconds && durationSeconds > 0 ? currentTimeSeconds / durationSeconds : 0;
  const timeLabel = `${formatDuration(currentTimeSeconds)} of ${formatDuration(durationSeconds)}`;

  return (
    <View style={styles.wrap}>
      <ProgressBar progress={progress} accessibilityLabel={timeLabel} />
      <View style={styles.timeRow}>
        <AppText variant="mono.meta" tone="tertiary">
          {formatDuration(currentTimeSeconds)}
        </AppText>
        <AppText variant="mono.meta" tone="tertiary">
          {formatDuration(durationSeconds)}
        </AppText>
      </View>

      <View style={styles.primaryRow}>
        <IconButton
          icon="play-back-outline"
          size={28}
          accessibilityLabel={`Rewind ${SEEK_SECONDS} seconds`}
          onPress={() => onSeekBy(-SEEK_SECONDS)}
        />
        <IconButton
          icon={isPlaying ? 'pause' : 'play'}
          size={40}
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
          onPress={onTogglePlay}
        />
        <IconButton
          icon="play-forward-outline"
          size={28}
          accessibilityLabel={`Skip forward ${SEEK_SECONDS} seconds`}
          onPress={() => onSeekBy(SEEK_SECONDS)}
        />
      </View>

      <View style={styles.secondaryRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Playback speed, ${formatPlaybackSpeed(playbackSpeed)}`}
          onPress={onCycleSpeed}
          style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
        >
          <AppText variant="ui.badge" tone="secondary">
            {formatPlaybackSpeed(playbackSpeed)}
          </AppText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            sleepRemainingSeconds !== null
              ? `Sleep timer, ${formatDuration(sleepRemainingSeconds)} remaining`
              : 'Sleep timer, off'
          }
          onPress={onOpenSleepTimer}
          style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
        >
          <Ionicons
            name={sleepRemainingSeconds !== null ? 'moon' : 'moon-outline'}
            size={16}
            color={sleepRemainingSeconds !== null ? colors.accent.goldText : colors.text.secondary}
          />
          {sleepRemainingSeconds !== null ? (
            <AppText variant="ui.badge" tone="gold" style={styles.chipLabel}>
              {formatDuration(sleepRemainingSeconds)}
            </AppText>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  primaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxl,
    paddingVertical: spacing.sm,
  },
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.track.default,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipLabel: {
    marginLeft: 2,
  },
});
