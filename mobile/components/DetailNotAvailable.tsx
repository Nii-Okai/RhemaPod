import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './Text';
import { PrimaryButton } from './Button';
import { spacing } from '../theme/spacing';

export interface DetailNotAvailableProps {
  subject: 'sermon' | 'series' | 'playlist';
  onGoHome: () => void;
}

/**
 * Calm empty state for a shared link whose target is gone (404: deleted, unpublished, or
 * not visible to this viewer — the API deliberately doesn't say which). Not an error
 * toast and not a retry prompt: retrying a 404 can't help. The caller renders its own
 * header chrome around this, same as `DetailError`.
 */
export function DetailNotAvailable({ subject, onGoHome }: DetailNotAvailableProps) {
  return (
    <View style={styles.centered}>
      <AppText variant="ui.body" tone="secondary" style={styles.text}>
        {`This ${subject} is no longer available`}
      </AppText>
      <PrimaryButton label="Go home" onPress={onGoHome} />
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
