import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../../components';
import type { ColorTokens } from '../../../theme/colors';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import { LEAF_SM } from '../../(tabs)/_home/signature/leaf';

export type AlertVariant = 'error' | 'warning' | 'success';

/**
 * Status-pair backed banner for the auth screens' error/success states
 * (wrong credentials, rate limit, network failure, "reset link sent").
 * `wheat` (used for `warning`) has no `text` token of its own in
 * `theme/colors.ts` — its dot color doubles as its text color, same pairing
 * the spec uses for wheat notice surfaces elsewhere.
 */
function variantStyle(colors: ColorTokens, variant: AlertVariant): { bg: string; border: string; text: string } {
  switch (variant) {
    case 'error':
      return { bg: colors.status.rose.bg, border: colors.status.rose.border, text: colors.status.rose.text };
    case 'warning':
      return { bg: colors.status.wheat.bg, border: colors.status.wheat.border, text: colors.accent.goldText };
    case 'success':
      return { bg: colors.status.sage.bg, border: colors.status.sage.bg, text: colors.status.sage.text };
  }
}

export function InlineAlert({
  variant,
  title,
  children,
}: {
  variant: AlertVariant;
  title: string;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const c = variantStyle(colors, variant);
  return (
    <View style={[styles.base, { backgroundColor: c.bg, borderColor: c.border }]}>
      <AppText variant="ui.label" style={{ color: c.text }}>
        {title}
      </AppText>
      {children ? (
        <AppText variant="ui.body" tone="secondary" style={styles.detail}>
          {children}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: StyleSheet.hairlineWidth,
    ...LEAF_SM,
    padding: spacing.md,
    gap: spacing.xs,
  },
  detail: {
    marginTop: 0,
  },
});
