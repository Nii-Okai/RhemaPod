import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './Text';
import { PrimaryButton } from './Button';
import { spacing } from '../theme/spacing';

export interface DetailErrorProps {
  onRetry: () => void;
  /** Defaults to sermon-detail's original copy, its first consumer — series detail
      (its second, Isaac's ask, session 2026-09-30) passes its own. */
  message?: string;
}

/**
 * Error state (design spec §8.4), promoted here once Series detail became a second
 * consumer — the nav header persists elsewhere in the screen (the caller renders its
 * own chrome, e.g. `CastCloseHeader`, around this); this is only the hero-through-content
 * replacement block. No status-specific copy — the fetch doesn't return a user-facing
 * failure reason, unlike the Downloads screen's failed-item state.
 */
export function DetailError({ onRetry, message = 'Something went wrong loading this sermon.' }: DetailErrorProps) {
  return (
    <View style={styles.centered}>
      <AppText variant="ui.body" tone="secondary" style={styles.text}>
        {message}
      </AppText>
      <PrimaryButton label="Try again" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.lg,
  },
  text: {
    textAlign: 'center',
  },
});
