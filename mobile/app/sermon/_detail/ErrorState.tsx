import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, PrimaryButton } from '../../../components';
import { spacing } from '../../../theme/spacing';

export interface DetailErrorProps {
  onRetry: () => void;
}

/**
 * Error state (design spec §8.4) — the nav header persists elsewhere in the screen (the
 * caller renders `DetailHeader` around this); this is only the hero-through-tags
 * replacement block. No status-specific copy — the fetch doesn't return a user-facing
 * failure reason, unlike the Downloads screen's failed-item state.
 */
export function DetailError({ onRetry }: DetailErrorProps) {
  return (
    <View style={styles.centered}>
      <AppText variant="ui.body" tone="secondary" style={styles.text}>
        Something went wrong loading this sermon.
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
