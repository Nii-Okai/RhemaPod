import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';
import { userMessageFor } from '../lib/api/errors';
import { LinkButton } from './Button';
import { AppText } from './Text';

export interface QueryStateProps {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  /** True once loaded successfully but the list/result set has zero items. */
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  onRetry?: () => void;
  /** Announced to screen readers while `isLoading` — e.g. "Loading categories". */
  loadingLabel: string;
  children: React.ReactNode;
}

/**
 * One populated/empty/loading/error switch, shared by every read-only list
 * this slice renders (categories, speakers, search results, category/speaker
 * drill-down) — five call sites landing in this one PR is what justifies
 * pulling it out instead of repeating the switch per screen.
 */
export function QueryState({
  isLoading,
  isError,
  error,
  isEmpty,
  emptyTitle,
  emptyDescription,
  onRetry,
  loadingLabel,
  children,
}: QueryStateProps) {
  if (isLoading) {
    return (
      <View style={styles.centered} accessibilityRole="progressbar" accessibilityLabel={loadingLabel}>
        <ActivityIndicator color={colors.accent.gold} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.banner}>
        <AppText variant="ui.label" style={styles.errorText}>
          {userMessageFor(error)}
        </AppText>
        {onRetry ? (
          <View style={styles.retry}>
            <LinkButton label="Retry" onPress={onRetry} />
          </View>
        ) : null}
      </View>
    );
  }

  if (isEmpty) {
    return (
      <View style={styles.centered}>
        <AppText variant="ui.bodyLarge" style={styles.emptyTitle}>
          {emptyTitle}
        </AppText>
        {emptyDescription ? (
          <AppText variant="ui.body" tone="secondary" style={styles.emptyDescription}>
            {emptyDescription}
          </AppText>
        ) : null}
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  centered: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  banner: {
    backgroundColor: colors.status.rose.bg,
    borderColor: colors.status.rose.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  errorText: {
    color: colors.status.rose.text,
  },
  retry: {
    alignSelf: 'flex-start',
  },
  emptyTitle: {
    textAlign: 'center',
  },
  emptyDescription: {
    textAlign: 'center',
  },
});
