import React from 'react';
import { ActivityIndicator, Image, Pressable, View, useWindowDimensions } from 'react-native';
import { AppText, PlatformIcon } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { formatDuration } from '../../../lib/format/duration';
import type { PlaybackSpeed } from '../../../lib/settings/playbackPreferences';
import { PlayerSeekBar } from '../_player/PlayerSeekBar';

const SEEK_SECONDS = 10;

export type PlayerMode = 'watch' | 'listen';

/** The Watch / Listen switch above the stage (Daybreak canvas C3/C4). */
export function ModeSwitch({ mode, onChange }: { mode: PlayerMode; onChange: (mode: PlayerMode) => void }) {
  const styles = useStyles();
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchTrack} accessibilityRole="tablist" accessibilityLabel="Player mode">
        {(['watch', 'listen'] as const).map((key) => {
          const active = mode === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(key)}
              style={[styles.switchItem, active && styles.switchItemOn]}
            >
              <AppText variant="ui.label" tone={active ? 'primary' : 'secondary'}>
                {key === 'watch' ? 'Watch' : 'Listen'}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export interface ListenPanelProps {
  artworkUrl: string | null;
  isPlaying: boolean;
  isBuffering: boolean;
  isEnded: boolean;
  currentTimeSeconds: number;
  durationSeconds: number | null;
  playbackSpeed: PlaybackSpeed;
  sleepRemainingSeconds: number | null;
  onTogglePlay: () => void;
  onReplay: () => void;
  onSeekBy: (seconds: number) => void;
  onSeekTo: (seconds: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onCycleSpeed: () => void;
  onOpenSleepTimer: () => void;
}

/**
 * Listen mode (Daybreak canvas C4): the sermon's art large and square, then the seek bar
 * with elapsed and remaining time, a big gold play/pause between back and forward 10
 * seconds, and Speed and Sleep under it. Same player, same controls as Watch; the video
 * just isn't drawn, which suits a sermon heard on a walk or a drive.
 */
export function ListenPanel({
  artworkUrl,
  isPlaying,
  isBuffering,
  isEnded,
  currentTimeSeconds,
  durationSeconds,
  playbackSpeed,
  sleepRemainingSeconds,
  onTogglePlay,
  onReplay,
  onSeekBy,
  onSeekTo,
  onScrubStart,
  onScrubEnd,
  onCycleSpeed,
  onOpenSleepTimer,
}: ListenPanelProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  // Sized to the screen's height as well as its width, so the title block and comments
  // under it keep their room on a shorter phone.
  const artSize = Math.max(112, Math.min(width - spacing.xxl * 4, 184, Math.round(height * 0.19)));
  const remaining = durationSeconds ? Math.max(0, durationSeconds - currentTimeSeconds) : null;

  return (
    <View testID="listen-panel" style={styles.panel}>
      <View style={[styles.art, { width: artSize, height: artSize }]}>
        {artworkUrl ? (
          <Image source={{ uri: artworkUrl }} style={styles.artImage} accessible={false} />
        ) : (
          <PlatformIcon name="volume-high-outline" size={56} color={colors.feature.sun} />
        )}
      </View>

      <View style={styles.seek}>
        <PlayerSeekBar
          currentTimeSeconds={currentTimeSeconds}
          durationSeconds={durationSeconds}
          onSeek={onSeekTo}
          onAdjust={onSeekBy}
          adjustStepSeconds={SEEK_SECONDS}
          onScrubStart={onScrubStart}
          onScrubEnd={onScrubEnd}
        />
        <View style={styles.times}>
          <AppText variant="mono.meta" tone="secondary">
            {formatDuration(currentTimeSeconds)}
          </AppText>
          <AppText variant="mono.meta" tone="secondary">
            {remaining !== null ? `-${formatDuration(remaining)}` : ''}
          </AppText>
        </View>
      </View>

      {/* Speed and Sleep sit at the ends of the transport row rather than on a row of
          their own, so the comments under the title keep their room (Nii's phone test,
          2026-11-11: Listen cut the comments off). */}
      <View style={styles.transport}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${playbackSpeed}x`}
          onPress={onCycleSpeed}
          style={({ pressed }) => [styles.tool, pressed && styles.pressed]}
        >
          <AppText variant="ui.bodyBold">{`${playbackSpeed}×`}</AppText>
          <AppText variant="ui.badge" tone="secondary">
            Speed
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Rewind ${SEEK_SECONDS} seconds`}
          onPress={() => onSeekBy(-SEEK_SECONDS)}
          style={({ pressed }) => [styles.side, pressed && styles.pressed]}
        >
          <PlatformIcon name="play-back-outline" size={30} color={colors.text.primary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isEnded ? 'Replay' : isBuffering ? 'Buffering' : isPlaying ? 'Pause' : 'Play'}
          onPress={isEnded ? onReplay : onTogglePlay}
          style={({ pressed }) => [styles.main, pressed && styles.pressed]}
        >
          {isBuffering ? (
            <ActivityIndicator color={colors.sunButton.text} />
          ) : (
            <PlatformIcon name={isEnded ? 'reload' : isPlaying ? 'pause' : 'play'} size={34} color={colors.sunButton.text} />
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Skip forward ${SEEK_SECONDS} seconds`}
          onPress={() => onSeekBy(SEEK_SECONDS)}
          style={({ pressed }) => [styles.side, pressed && styles.pressed]}
        >
          <PlatformIcon name="play-forward-outline" size={30} color={colors.text.primary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sleepRemainingSeconds !== null ? `Sleep timer, ${formatDuration(sleepRemainingSeconds)} left` : 'Sleep timer'}
          onPress={onOpenSleepTimer}
          style={({ pressed }) => [styles.tool, pressed && styles.pressed]}
        >
          <PlatformIcon name="moon-outline" size={20} color={colors.text.primary} />
          <AppText variant="ui.badge" tone={sleepRemainingSeconds !== null ? 'gold' : 'secondary'}>
            {sleepRemainingSeconds !== null ? formatDuration(sleepRemainingSeconds) : 'Sleep'}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  switchRow: {
    alignItems: 'center',
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface.app,
  },
  switchTrack: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.sunken,
  },
  switchItem: {
    minWidth: 84,
    minHeight: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchItemOn: {
    backgroundColor: colors.surface.raised,
  },
  panel: {
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  art: {
    borderRadius: 32,
    overflow: 'hidden',
    backgroundColor: colors.feature.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artImage: {
    width: '100%',
    height: '100%',
  },
  seek: {
    alignSelf: 'stretch',
    gap: spacing.xs,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  transport: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  side: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.sunButton.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  tool: {
    width: 52,
    alignItems: 'center',
    gap: 2,
    minHeight: 44,
    justifyContent: 'center',
  },
}));
