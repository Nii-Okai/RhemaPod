import React, { useEffect } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import { AppText } from './Text';
import { PrimaryButton } from './Button';
import { spacing } from '../theme/spacing';

export interface DetailNotAvailableProps {
  subject: 'sermon' | 'series' | 'playlist';
  onGoHome: () => void;
}

const BODY = "It may have been removed, or it isn't shared with your account.";

/**
 * Calm empty state for a shared link whose target is gone (404: deleted, unpublished, or
 * not visible to this viewer — the API deliberately doesn't say which). Not an error
 * toast and not a retry prompt: retrying a 404 can't help. The caller renders its own
 * header chrome around this, same as `DetailError`.
 *
 * Announced on mount: Android via the polite live region on the container, iOS via
 * `announceForAccessibility` (live regions are Android-only).
 */
export function DetailNotAvailable({ subject, onGoHome }: DetailNotAvailableProps) {
  const title = `This ${subject} isn't available`;

  useEffect(() => {
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(`${title}. ${BODY}`);
  }, [title]);

  return (
    <View style={styles.centered} accessibilityLiveRegion="polite">
      <AppText variant="ui.body" accessibilityRole="header" style={styles.text}>
        {title}
      </AppText>
      <AppText variant="ui.body" tone="secondary" style={styles.text}>
        {BODY}
      </AppText>
      <PrimaryButton label="Go to Home" onPress={onGoHome} />
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
