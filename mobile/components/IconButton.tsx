import React from 'react';
import { Pressable, StyleSheet, type PressableProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

export interface IconButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  size?: number;
  /**
   * Required — no default. An icon-only control with no accessible name is a dead end for
   * screen-reader users (design spec §8.7); this forces every call site to supply one
   * rather than silently shipping a glyph with no accessible name.
   */
  accessibilityLabel: string;
}

/**
 * Icon-only pressable (design spec §8.6) — first used by the sermon-detail back control
 * (§8.7, both platforms) and the Android top app bar's back arrow (§8.5). The player's
 * transport/back/overflow controls (W4.2) are the confirmed second consumer, which is
 * what clears this primitive's promotion bar.
 */
export function IconButton({ icon, size = 24, accessibilityLabel, disabled, ...rest }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={spacing.sm}
      style={({ pressed }) => [styles.base, pressed && !disabled && styles.pressed, disabled && styles.disabled]}
      {...rest}
    >
      <Ionicons name={icon} size={size} color={colors.text.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
});
