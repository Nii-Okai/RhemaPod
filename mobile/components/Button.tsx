import React from 'react';
import { ActivityIndicator, Pressable, View, type PressableProps } from 'react-native';
import { createThemedStyles, useTheme } from '../theme/ThemeContext';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';
import { AppText } from './Text';
import { PlatformIcon, type AppIconName } from './PlatformIcon';

export interface PrimaryButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  loading?: boolean;
  /** Leading glyph — series detail's Play CTA (Isaac's ask, session 2026-09-30,
      Netflix's own Play button) is this prop's first user. */
  icon?: AppIconName;
  /** Stretches to fill its container instead of sizing to the label — series detail's
      Play button (same ask) is this prop's first user; every existing call site keeps
      the original content-sized pill by leaving this at its default. */
  fullWidth?: boolean;
}

/**
 * The white-pill primary action (spec §4/§1.1) — the only filled non-gold primary
 * button. Gold is reserved for accents/links/progress, never a general primary action.
 */
export function PrimaryButton({ label, loading = false, disabled, icon, fullWidth = false, ...rest }: PrimaryButtonProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const isDisabled = Boolean(disabled) || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.primaryBase,
        fullWidth && styles.fullWidth,
        pressed && styles.primaryPressed,
        isDisabled && styles.disabled,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={colors.primaryButton.text} />
      ) : (
        <View style={styles.contentRow}>
          {icon ? <PlatformIcon name={icon} size={18} color={colors.primaryButton.text} /> : null}
          <AppText variant="ui.button" tone="inverse">
            {label}
          </AppText>
        </View>
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
  const styles = useStyles();
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

const useStyles = createThemedStyles((colors) => ({
  primaryBase: {
    backgroundColor: colors.primaryButton.bg,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
}));
