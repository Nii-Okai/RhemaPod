import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { formatDuration } from '../../../lib/format/duration';
import { formatPlaybackSpeed } from './cyclePlaybackSpeed';
import { PlayerSeekBar } from './PlayerSeekBar';
import type { PlaybackSpeed } from '../../../lib/settings/playbackPreferences';

/** One skip step, in seconds — the rewind/forward buttons and the seek bar's a11y step. */
export const SEEK_SECONDS = 10;

export interface PlaybackOverlayControlsProps {
  isPlaying: boolean;
  isBuffering: boolean;
  /** The sermon finished: the play control becomes Replay. */
  isEnded: boolean;
  onTogglePlay: () => void;
  onReplay: () => void;
  onSeekBy: (seconds: number) => void;
}

interface CircleButtonProps {
  size: number;
  iconSize: number;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  busy?: boolean;
}

/**
 * Circular overlay control (design spec §1.2). The translucent disc is a sibling backing
 * layer rather than a parent opacity, so the icon never inherits the fade.
 */
function CircleButton({ size, iconSize, icon, label, onPress, busy = false }: CircleButtonProps) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
          <View
            style={[styles.circleBacking, { borderRadius: size / 2 }, pressed && styles.circleBackingPressed]}
          />
          {busy ? (
            <ActivityIndicator color={colors.accent.goldText} />
          ) : (
            <Ionicons name={icon} size={iconSize} color={colors.text.primary} />
          )}
        </View>
      )}
    </Pressable>
  );
}

/** Rewind 10 / play-pause / forward 10, centred over the video (design spec §1.2). */
export function PlaybackOverlayControls({
  isPlaying,
  isBuffering,
  isEnded,
  onTogglePlay,
  onReplay,
  onSeekBy,
}: PlaybackOverlayControlsProps) {
  return (
    <View style={styles.overlayRow}>
      <CircleButton
        size={56}
        iconSize={28}
        icon="play-back-outline"
        label={`Rewind ${SEEK_SECONDS} seconds`}
        onPress={() => onSeekBy(-SEEK_SECONDS)}
      />
      {isEnded ? (
        <CircleButton size={72} iconSize={40} icon="reload" label="Replay" onPress={onReplay} />
      ) : (
        <CircleButton
          size={72}
          iconSize={40}
          icon={isPlaying ? 'pause' : 'play'}
          label={isBuffering ? 'Buffering' : isPlaying ? 'Pause' : 'Play'}
          busy={isBuffering}
          onPress={onTogglePlay}
        />
      )}
      <CircleButton
        size={56}
        iconSize={28}
        icon="play-forward-outline"
        label={`Skip forward ${SEEK_SECONDS} seconds`}
        onPress={() => onSeekBy(SEEK_SECONDS)}
      />
    </View>
  );
}

export interface PlayerBottomBarProps {
  currentTimeSeconds: number;
  /** `null` before the player has resolved a duration (still loading). */
  durationSeconds: number | null;
  playbackSpeed: PlaybackSpeed;
  /** `null` when no sleep timer is armed. */
  sleepRemainingSeconds: number | null;
  isFullscreen: boolean;
  onSeekTo: (seconds: number) => void;
  onSeekBy: (seconds: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onCycleSpeed: () => void;
  onOpenSleepTimer: () => void;
  onToggleFullscreen: () => void;
}

/**
 * The bottom row of the video's own controls overlay (design spec §1.3, revised
 * 2026-10-08): scrubbable seek, elapsed / total, speed pill, sleep moon, native-fullscreen
 * toggle. Rendered by `VideoSurface` inside its tap-to-toggle overlay, anchored to the
 * video's bottom edge — there is no separate below-player bar. Row 2 wraps rather than
 * overflowing at large Dynamic Type.
 */
export function PlayerBottomBar({
  currentTimeSeconds,
  durationSeconds,
  playbackSpeed,
  sleepRemainingSeconds,
  isFullscreen,
  onSeekTo,
  onSeekBy,
  onScrubStart,
  onScrubEnd,
  onCycleSpeed,
  onOpenSleepTimer,
  onToggleFullscreen,
}: PlayerBottomBarProps) {
  const timeLabel = `${formatDuration(currentTimeSeconds)} of ${formatDuration(durationSeconds)}`;

  return (
    <View style={styles.bar}>
      <PlayerSeekBar
        currentTimeSeconds={currentTimeSeconds}
        durationSeconds={durationSeconds}
        onSeek={onSeekTo}
        onAdjust={onSeekBy}
        adjustStepSeconds={SEEK_SECONDS}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
      />
      <View style={styles.row}>
        <AppText variant="mono.tight" tone="secondary" accessibilityLabel={timeLabel} style={styles.time}>
          {`${formatDuration(currentTimeSeconds)} / ${formatDuration(durationSeconds)}`}
        </AppText>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Playback speed, ${formatPlaybackSpeed(playbackSpeed)}`}
          onPress={onCycleSpeed}
          hitSlop={spacing.sm}
          style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
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
          hitSlop={spacing.sm}
          style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
        >
          <Ionicons
            name={sleepRemainingSeconds !== null ? 'moon' : 'moon-outline'}
            size={18}
            color={sleepRemainingSeconds !== null ? colors.accent.goldText : colors.text.secondary}
          />
          {sleepRemainingSeconds !== null ? (
            <AppText variant="ui.badge" tone="gold">
              {formatDuration(sleepRemainingSeconds)}
            </AppText>
          ) : null}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
          onPress={onToggleFullscreen}
          hitSlop={spacing.sm}
          style={({ pressed }) => [styles.fullscreen, pressed && styles.pressed]}
        >
          <Ionicons name={isFullscreen ? 'contract' : 'expand'} size={22} color={colors.text.primary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxl,
  },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border.card,
  },
  circleBacking: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface.app,
    opacity: 0.6,
  },
  circleBackingPressed: {
    opacity: 0.8,
  },
  bar: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: spacing.sm,
    columnGap: spacing.sm,
  },
  time: {
    flexGrow: 1,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 32,
    backgroundColor: colors.track.default,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  fullscreen: {
    minHeight: 32,
    minWidth: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
