import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, PlatformIcon, PrimaryButton, Sheet } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import { formatDuration } from '../../../lib/format/duration';
import { PLAYBACK_SPEEDS, type PlaybackSpeed } from '../../../lib/settings/playbackPreferences';

const OPTIONS_MINUTES = [15, 30, 45, 60] as const;

export interface SleepTimerSheetProps {
  visible: boolean;
  /** Whether a countdown is currently armed: governs whether "Turn off" is offered. */
  hasActiveTimer: boolean;
  /** Seconds left on the armed timer, shown as a pill beside the heading. */
  remainingSeconds?: number | null;
  onSelect: (minutes: number | null) => void;
  /** With both of these the sheet also offers the playback speed (canvas C6). */
  speed?: PlaybackSpeed;
  onSpeed?: (speed: PlaybackSpeed) => void;
  onClose: () => void;
}

/**
 * Sleep timer and speed (Daybreak canvas C6): a paper sheet with the four timer lengths
 * as a grid of pills, "Turn off" while one is running, then the speeds as a segmented
 * control that the app remembers for next time, and Done.
 */
export function SleepTimerSheet({
  visible,
  hasActiveTimer,
  remainingSeconds = null,
  onSelect,
  speed,
  onSpeed,
  onClose,
}: SleepTimerSheetProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const choose = (minutes: number | null) => {
    onSelect(minutes);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.section}>
        <View style={styles.headRow}>
          <AppText variant="display.row" accessibilityRole="header">
            Sleep timer
          </AppText>
          {hasActiveTimer && remainingSeconds !== null ? (
            <View style={styles.leftPill}>
              <PlatformIcon name="moon-outline" size={14} color={colors.iris.ink} />
              <AppText variant="ui.badge" style={styles.leftText}>
                {`${formatDuration(remainingSeconds)} left`}
              </AppText>
            </View>
          ) : null}
        </View>
        <View style={styles.grid}>
          {OPTIONS_MINUTES.map((minutes) => (
            <Pressable
              key={minutes}
              accessibilityRole="button"
              accessibilityLabel={`${minutes} minutes`}
              onPress={() => choose(minutes)}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            >
              <AppText variant="ui.bodyBold">{`${minutes} min`}</AppText>
            </Pressable>
          ))}
        </View>
        {hasActiveTimer ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Turn off sleep timer"
            onPress={() => choose(null)}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          >
            <AppText variant="ui.bodyBold" style={styles.off}>
              Turn off
            </AppText>
          </Pressable>
        ) : null}
      </View>

      {speed !== undefined && onSpeed ? (
        <>
          <View style={styles.divider} />
          <View style={styles.section}>
            <View style={styles.headRow}>
              <AppText variant="display.row" accessibilityRole="header">
                Speed
              </AppText>
              <AppText variant="ui.badge" tone="tertiary">
                Remembered for next time
              </AppText>
            </View>
            <View style={styles.segments} accessibilityRole="radiogroup">
              {PLAYBACK_SPEEDS.map((option) => {
                const on = option === speed;
                return (
                  <Pressable
                    key={option}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${option} times speed`}
                    onPress={() => onSpeed(option)}
                    style={[styles.segment, on && styles.segmentOn]}
                  >
                    <AppText variant="ui.bodyBold" tone={on ? 'primary' : 'secondary'}>
                      {`${option}×`}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </>
      ) : null}

      <PrimaryButton label="Done" onPress={onClose} fullWidth />
    </Sheet>
  );
}

const useStyles = createThemedStyles((colors) => ({
  section: {
    gap: spacing.md + 2,
    paddingBottom: spacing.sm,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  leftPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 24,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: 12,
    backgroundColor: colors.iris.soft,
  },
  leftText: {
    color: colors.iris.ink,
  },
  grid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  option: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.raised,
  },
  pressed: {
    opacity: 0.7,
  },
  off: {
    color: colors.status.rose.text,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border.default,
    marginVertical: spacing.sm,
  },
  segments: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 18,
    backgroundColor: colors.surface.sunken,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOn: {
    backgroundColor: colors.surface.raised,
  },
}));
