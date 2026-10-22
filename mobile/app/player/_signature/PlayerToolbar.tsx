import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, PlatformIcon } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import { formatDuration } from '../../../lib/format/duration';
import type { PlaybackSpeed } from '../../../lib/settings/playbackPreferences';
import { formatPlaybackSpeed } from '../_player/cyclePlaybackSpeed';

export type PlayerPane = 'queue' | 'comments';

export interface PlayerToolbarProps {
  playbackSpeed: PlaybackSpeed;
  /** `null` when no sleep timer is armed. */
  sleepRemainingSeconds: number | null;
  onCycleSpeed: () => void;
  onOpenSleepTimer: () => void;
  /** Which panel fills the space above — only when playing a playlist, which is the one
   * case with two panels to switch between. `null` hides Queue and Comments. */
  pane: PlayerPane | null;
  onSelectPane: (pane: PlayerPane) => void;
  bottomInset: number;
}

/**
 * The Signature player's bottom toolbar. Speed and the sleep timer move here from the video
 * overlay so they're always in reach; Queue and Comments switch the panel above when the
 * player was opened from a playlist (the queue is still what opens first, per Isaac's
 * 2026-10-11 ask). The mockup's Listen tool is left out: the app has no audio-only switch.
 */
export function PlayerToolbar({
  playbackSpeed,
  sleepRemainingSeconds,
  onCycleSpeed,
  onOpenSleepTimer,
  pane,
  onSelectPane,
  bottomInset,
}: PlayerToolbarProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const sleeping = sleepRemainingSeconds !== null;

  return (
    <View style={[styles.bar, { paddingBottom: spacing.sm + bottomInset }]}>
      <Tool
        label="Speed"
        accessibilityLabel={`Playback speed, ${formatPlaybackSpeed(playbackSpeed)}`}
        onPress={onCycleSpeed}
        glyph={
          <AppText variant="mono.tight" style={styles.speedGlyph}>
            {formatPlaybackSpeed(playbackSpeed)}
          </AppText>
        }
      />
      <Tool
        label={sleeping ? formatDuration(sleepRemainingSeconds) : 'Sleep'}
        accessibilityLabel={
          sleeping ? `Sleep timer, ${formatDuration(sleepRemainingSeconds)} remaining` : 'Sleep timer, off'
        }
        active={sleeping}
        onPress={onOpenSleepTimer}
        glyph={
          <PlatformIcon
            name={sleeping ? 'moon' : 'moon-outline'}
            size={22}
            color={sleeping ? colors.accent.goldText : colors.text.secondary}
          />
        }
      />
      {pane ? (
        <>
          <Tool
            label="Queue"
            accessibilityLabel="Show queue"
            active={pane === 'queue'}
            selectable
            onPress={() => onSelectPane('queue')}
            glyph={
              <PlatformIcon
                name="list"
                size={22}
                color={pane === 'queue' ? colors.accent.goldText : colors.text.secondary}
              />
            }
          />
          <Tool
            label="Comments"
            accessibilityLabel="Show comments"
            active={pane === 'comments'}
            selectable
            onPress={() => onSelectPane('comments')}
            glyph={
              <PlatformIcon
                name="chatbubble-outline"
                size={22}
                color={pane === 'comments' ? colors.accent.goldText : colors.text.secondary}
              />
            }
          />
        </>
      ) : null}
    </View>
  );
}

interface ToolProps {
  label: string;
  accessibilityLabel: string;
  glyph: React.ReactNode;
  onPress: () => void;
  active?: boolean;
  /** A pane switch (Queue / Comments) rather than an action — reports `selected`. */
  selectable?: boolean;
}

function Tool({ label, accessibilityLabel, glyph, onPress, active = false, selectable = false }: ToolProps) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole={selectable ? 'tab' : 'button'}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selectable ? { selected: active } : undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.tool, pressed && styles.pressed]}
    >
      <View style={styles.glyph}>{glyph}</View>
      <AppText variant="ui.badge" tone={active ? 'gold' : 'secondary'} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  bar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    marginTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.default,
    backgroundColor: colors.surface.app,
  },
  tool: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  glyph: {
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedGlyph: {
    color: colors.text.primary,
  },
  pressed: {
    opacity: 0.7,
  },
}));
