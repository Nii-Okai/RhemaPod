import React from 'react';
import { Pressable, StyleSheet, type PressableProps } from 'react-native';
import { createThemedStyles, useTheme } from '../theme/ThemeContext';
import { spacing } from '../theme/spacing';
import { darkColors as onArt } from '../theme/colors';
import { PlatformIcon, type AppIconName } from './PlatformIcon';

export interface CircleButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  icon: AppIconName;
  /** Required: an icon-only control needs a spoken name. */
  accessibilityLabel: string;
  /** `glass` is for a button drawn on art or a dark wash, light on dark in both themes. */
  tone?: 'card' | 'glass' | 'flat';
  iconSize?: number;
}

/**
 * Daybreak's round 44pt icon button (canvas `.ib`): a white card disc with a hairline
 * border in light, a navy one in dark. Back, Share and More on every detail screen.
 */
export function CircleButton({ icon, accessibilityLabel, tone = 'card', iconSize = 22, disabled, ...rest }: CircleButtonProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const glyph = tone === 'glass' ? onArt.text.primary : colors.text.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={spacing.xs}
      style={({ pressed }) => [styles.base, styles[tone], pressed && styles.pressed, disabled && styles.disabled]}
      {...rest}
    >
      <PlatformIcon name={icon} size={iconSize} color={glyph} />
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  base: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: colors.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
  },
  glass: {
    backgroundColor: onArt.overlay.chipFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: onArt.overlay.chipBorder,
  },
  flat: {},
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
}));
