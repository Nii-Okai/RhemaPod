import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, PlatformIcon } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';

/** The warm note under the reset form (canvas A5): Google and Apple accounts have no password. */
export function SocialTip() {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.card}>
      <PlatformIcon name="information-circle-outline" size={22} color={colors.verse.icon} />
      <AppText variant="ui.body" tone="primary" style={styles.text}>
        Signed up with Google or Apple? Keep using that button. No password needed.
      </AppText>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: 24,
    backgroundColor: colors.verse.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.verse.border,
  },
  text: {
    flex: 1,
  },
}));
