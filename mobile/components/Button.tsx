import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';
import { AppText } from './Text';

export interface PrimaryButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  loading?: boolean;
}

/**
 * The white-pill primary action (spec §4/§1.1) — the only filled non-gold primary
 * button. Gold is reserved for accents/links/progress, never a general primary action.
 */
export function PrimaryButton({ label, loading = false, disabled, ...rest }: PrimaryButtonProps) {
  const isDisabled = Boolean(disabled) || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [styles.primaryBase, pressed && styles.primaryPressed, isDisabled && styles.disabled]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={colors.primaryButton.text} />
      ) : (
        <AppText variant="ui.button" tone="inverse">
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

export interface LinkButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
}

/**
 * The gold text-link secondary action (spec §4/§1.1). No ghost/outline variant exists in
 * any confirmed in-scope screen — don't add one here; a future need should follow the
 * admin portal's existing ghost-button convention rather than being invented fresh.
 */
export function LinkButton({ label, disabled, ...rest }: LinkButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      style={disabled ? styles.linkDisabled : undefined}
      {...rest}
    >
      {({ pressed }) => (
        <AppText variant="ui.button" tone={pressed && !disabled ? 'goldHover' : 'gold'}>
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primaryBase: {
    backgroundColor: colors.primaryButton.bg,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryPressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.4,
  },
  linkDisabled: {
    opacity: 0.4,
  },
});
