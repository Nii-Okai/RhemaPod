import React from 'react';
import { Pressable, View } from 'react-native';
import { AppText, PlatformIcon } from '../../../components';
import { spacing } from '../../../theme/spacing';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import type { ThemePreference } from '../../../lib/settings/themePreference';

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; detail?: string }> = [
  { value: 'system', label: 'System default', detail: "Match your phone's setting" },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export interface AppearanceSectionProps {
  /** The last save failed; the choice has already reverted — this is the visible reason. */
  error?: string | null;
  onError?: (message: string | null) => void;
}

/**
 * Me › Appearance — System default / Light / Dark (light-mode rollout, Isaac's decision
 * 2026-10-21: follow the phone by default, with an in-app override). Three radio rows
 * rather than a segmented control: the app has no segmented primitive, and a row per
 * option leaves room for "System default"'s explanation. The choice is device-only and
 * applies immediately; the screen renders it only while `lightModeAvailable`.
 */
export function AppearanceSection({ error = null, onError }: AppearanceSectionProps) {
  const { preference, setPreference, colors } = useTheme();
  const styles = useStyles();

  const choose = (value: ThemePreference) => {
    if (value === preference) return;
    onError?.(null);
    setPreference(value).catch(() => onError?.("Couldn't save your appearance setting. Try again."));
  };

  return (
    <View style={styles.section} accessibilityRole="radiogroup" accessibilityLabel="Appearance">
      <AppText variant="ui.label" tone="tertiary" style={styles.heading}>
        Appearance
      </AppText>
      {OPTIONS.map((option) => {
        const selected = option.value === preference;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={option.label}
            onPress={() => choose(option.value)}
            style={styles.row}
          >
            <View style={styles.rowText}>
              <AppText variant="ui.bodyLarge">{option.label}</AppText>
              {option.detail ? (
                <AppText variant="ui.badge" tone="tertiary">
                  {option.detail}
                </AppText>
              ) : null}
            </View>
            {selected ? <PlatformIcon name="checkmark" size={20} color={colors.accent.goldText} /> : null}
          </Pressable>
        );
      })}
      {error ? (
        <AppText variant="ui.badge" style={styles.errorText} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  section: {
    gap: spacing.xs,
  },
  heading: {
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingVertical: spacing.sm,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  errorText: {
    color: c.status.rose.text,
  },
}));
