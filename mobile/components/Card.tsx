import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { createThemedStyles } from '../theme/ThemeContext';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';

export interface CardProps extends ViewProps {
  padded?: boolean;
}

/**
 * Generic elevated-surface container (`surface.raised` + `border.card`) — the base every
 * screen-specific card (sermon card, series shelf card, category card, ...) composes on
 * top of. Those domain-specific compositions belong to the screens that need them, not
 * here.
 */
export function Card({ padded = true, style, ...rest }: CardProps) {
  const styles = useStyles();
  return <View style={[styles.base, padded && styles.padded, style]} {...rest} />;
}

const useStyles = createThemedStyles((colors) => ({
  base: {
    backgroundColor: colors.surface.raised,
    borderColor: colors.border.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  padded: {
    padding: spacing.lg,
  },
}));
