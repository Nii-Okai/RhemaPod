import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../../components';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';

/**
 * "or continue with" — sits between the email/password form's primary button and the
 * stacked social buttons (sign-in.tsx / register.tsx, Isaac's ask, session 2026-10-15:
 * "organise the page to look better").
 */
export function OrDivider({ label = 'or continue with' }: { label?: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.line} />
      <AppText variant="ui.badge" tone="tertiary">
        {label}
      </AppText>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border.default,
  },
});
