import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../../../components';
import { createThemedStyles, useTheme } from '../../../../theme/ThemeContext';
import { radius } from '../../../../theme/radius';
import { spacing } from '../../../../theme/spacing';
import { fontFamily } from '../../../../theme/typography';
import type { ThemePreference } from '../../../../lib/settings/themePreference';

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; detail?: string }> = [
  { value: 'system', label: 'System', detail: 'Match phone' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export interface ThemeSwitchProps {
  /** The last save failed; the choice has already reverted — this is the visible reason. */
  error?: string | null;
  onError?: (message: string | null) => void;
}

/**
 * Appearance as one three-way switch — System / Light / Dark side by side (Nii's edit to
 * the Signature You mockup, 2026-10-21), replacing `AppearanceSection`'s three radio
 * rows. Same preference, same optimistic save and revert through `useTheme()`.
 */
export function ThemeSwitch({ error = null, onError }: ThemeSwitchProps) {
  const { preference, setPreference } = useTheme();
  const styles = useStyles();

  const choose = (value: ThemePreference) => {
    if (value === preference) return;
    onError?.(null);
    setPreference(value).catch(() => onError?.("Couldn't save your appearance setting. Try again."));
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.track} accessibilityRole="radiogroup" accessibilityLabel="Appearance">
        {OPTIONS.map((option) => {
          const selected = option.value === preference;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={option.label}
              onPress={() => choose(option.value)}
              style={[styles.segment, selected && styles.segmentOn]}
            >
              <AppText variant="ui.label" tone={selected ? 'primary' : 'secondary'}>
                {option.label}
              </AppText>
              {option.detail ? (
                <AppText variant="ui.badge" tone="tertiary" style={styles.detail}>
                  {option.detail}
                </AppText>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <AppText variant="ui.badge" style={styles.errorText} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  wrap: {
    gap: spacing.sm,
  },
  track: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.xl,
    backgroundColor: c.surface.sunken,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border.default,
  },
  segment: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segmentOn: {
    backgroundColor: c.surface.raised,
    borderColor: c.border.card,
  },
  detail: {
    fontFamily: fontFamily.ui,
  },
  errorText: {
    color: c.status.rose.text,
  },
}));
