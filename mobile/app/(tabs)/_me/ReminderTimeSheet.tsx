import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { AppText, PlatformIcon, PrimaryButton, Sheet, type AppIconName } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import { formatReminderTime, type ReminderTime } from '../../../lib/settings/notificationPreferences';

const MINUTE_STEP = 5;

const PRESETS: { label: string; time: ReminderTime }[] = [
  { label: 'Early', time: { hour: 6, minute: 0 } },
  { label: 'Morning', time: { hour: 7, minute: 0 } },
  { label: 'Midday', time: { hour: 12, minute: 0 } },
  { label: 'Evening', time: { hour: 21, minute: 0 } },
];

/** Moves the hour on by `delta` around the 12-hour face (11 → 12 → 1), leaving AM/PM alone. */
export function stepHour(time: ReminderTime, delta: number): ReminderTime {
  const base = time.hour < 12 ? 0 : 12;
  return { ...time, hour: base + ((((time.hour - base + delta) % 12) + 12) % 12) };
}

/**
 * Moves the minute to the next (or previous) multiple of five, wrapping within the hour:
 * 7:03 goes up to 7:05 and down to 7:00, 7:55 goes up to 7:00.
 */
export function stepMinute(time: ReminderTime, direction: 1 | -1): ReminderTime {
  const { minute } = time;
  let next: number;
  if (direction === 1) {
    next = (Math.floor(minute / MINUTE_STEP) + 1) * MINUTE_STEP;
  } else {
    next = minute % MINUTE_STEP === 0 ? minute - MINUTE_STEP : Math.floor(minute / MINUTE_STEP) * MINUTE_STEP;
  }
  return { ...time, minute: (next + 60) % 60 };
}

export function setPeriod(time: ReminderTime, period: 'AM' | 'PM'): ReminderTime {
  const isAm = time.hour < 12;
  if (period === 'AM' && !isAm) return { ...time, hour: time.hour - 12 };
  if (period === 'PM' && isAm) return { ...time, hour: time.hour + 12 };
  return time;
}

export interface ReminderTimeSheetProps {
  visible: boolean;
  initialTime: ReminderTime;
  saving?: boolean;
  onClose: () => void;
  onSave: (time: ReminderTime) => void;
}

/**
 * Picks when the Daily Rhema reminder fires. Plain React Native (no native picker
 * module), so it ships in an over-the-air update without a new app build. Hours and
 * minutes step with chevrons (minutes in fives), AM/PM is a pair of chips, and a row of
 * presets covers the common choices in one tap.
 */
export function ReminderTimeSheet({ visible, initialTime, saving = false, onClose, onSave }: ReminderTimeSheetProps) {
  const styles = useStyles();
  const [time, setTime] = useState<ReminderTime>(initialTime);

  useEffect(() => {
    if (visible) setTime(initialTime);
    // Only reset when the sheet opens, not when the saved value echoes back.
  }, [visible]);

  const displayHour = time.hour % 12 === 0 ? 12 : time.hour % 12;
  const period = time.hour < 12 ? 'AM' : 'PM';

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.topBar}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          hitSlop={spacing.sm}
          style={styles.cancel}
        >
          <AppText variant="ui.body">Cancel</AppText>
        </Pressable>
        <AppText variant="display.row" accessibilityRole="header" style={styles.heading}>
          Reminder time
        </AppText>
        <View style={styles.cancel} />
      </View>

      <AppText variant="ui.body" tone="tertiary" style={styles.centered}>
        Your Daily Rhema reminder arrives at this time every day, wherever your phone is set.
      </AppText>

      <View style={styles.clock} accessibilityLabel={`Reminder at ${formatReminderTime(time)}`}>
        <Stepper
          label="Hour"
          value={String(displayHour)}
          onUp={() => setTime((t) => stepHour(t, 1))}
          onDown={() => setTime((t) => stepHour(t, -1))}
        />
        <AppText variant="display.hero" style={styles.colon}>
          :
        </AppText>
        <Stepper
          label="Minute"
          value={String(time.minute).padStart(2, '0')}
          onUp={() => setTime((t) => stepMinute(t, 1))}
          onDown={() => setTime((t) => stepMinute(t, -1))}
        />
        <View style={styles.periods}>
          {(['AM', 'PM'] as const).map((option) => {
            const active = option === period;
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityLabel={option}
                accessibilityState={{ selected: active }}
                onPress={() => setTime((t) => setPeriod(t, option))}
                style={({ pressed }) => [styles.periodChip, active && styles.chipActive, pressed && styles.pressed]}
              >
                <AppText variant="ui.bodyBold" style={active ? styles.chipTextActive : null}>
                  {option}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.presets}>
        {PRESETS.map((preset) => {
          const active = preset.time.hour === time.hour && preset.time.minute === time.minute;
          const when = formatReminderTime(preset.time);
          return (
            <Pressable
              key={preset.label}
              accessibilityRole="button"
              accessibilityLabel={`${preset.label}, ${when}`}
              accessibilityState={{ selected: active }}
              onPress={() => setTime(preset.time)}
              style={({ pressed }) => [styles.presetChip, active && styles.chipActive, pressed && styles.pressed]}
            >
              <AppText variant="ui.badge" style={active ? styles.chipTextActive : null}>
                {preset.label}
              </AppText>
              <AppText variant="ui.label" tone={active ? undefined : 'tertiary'} style={active ? styles.chipTextActive : null}>
                {when}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          label={`Remind me at ${formatReminderTime(time)}`}
          fullWidth
          loading={saving}
          onPress={() => onSave(time)}
        />
      </View>
    </Sheet>
  );
}

function Stepper({ label, value, onUp, onDown }: { label: string; value: string; onUp: () => void; onDown: () => void }) {
  const styles = useStyles();
  return (
    <View style={styles.stepper}>
      <StepButton icon="chevron-up" accessibilityLabel={`${label} later`} onPress={onUp} />
      <AppText variant="display.hero" style={styles.digits} accessibilityLabel={`${label} ${value}`}>
        {value}
      </AppText>
      <StepButton icon="chevron-down" accessibilityLabel={`${label} earlier`} onPress={onDown} />
    </View>
  );
}

function StepButton({
  icon,
  accessibilityLabel,
  onPress,
}: {
  icon: AppIconName;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={spacing.xs}
      style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
    >
      <PlatformIcon name={icon} size={22} color={colors.text.secondary} />
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cancel: {
    minWidth: 56,
    minHeight: 44,
    justifyContent: 'center',
  },
  heading: {
    flex: 1,
    textAlign: 'center',
  },
  centered: {
    textAlign: 'center',
  },
  clock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  stepper: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  stepButton: {
    width: 56,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.raised,
  },
  digits: {
    minWidth: 56,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  colon: {
    marginBottom: spacing.xs,
  },
  periods: {
    gap: spacing.sm,
    marginLeft: spacing.sm,
  },
  periodChip: {
    width: 64,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border.default,
  },
  presets: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  presetChip: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border.default,
  },
  // Selected is an ink tile, like the profile sheet's gender chips.
  chipActive: {
    backgroundColor: colors.text.primary,
    borderColor: colors.text.primary,
  },
  chipTextActive: {
    color: colors.surface.app,
  },
  pressed: {
    opacity: 0.7,
  },
  actions: {
    marginTop: spacing.xs,
  },
}));
