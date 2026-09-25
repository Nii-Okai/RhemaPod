import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, LinkButton } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';

export interface SectionErrorProps {
  message: string;
  onRetry: () => void;
}

/**
 * Same error-banner + Retry shape `QueryState.tsx` already uses for Browse/Search,
 * reimplemented locally for Home: Home's sections need a *skeleton* loading state
 * (`HeroSkeleton`/`ShelfSkeleton`), not `QueryState`'s spinner, so this reuses only its
 * error-branch visual/copy convention, not the component itself (three call sites here —
 * hero, continue-watching, series — is what justifies pulling it out at all).
 */
export function SectionError({ message, onRetry }: SectionErrorProps) {
  return (
    <View style={styles.banner}>
      <AppText variant="ui.label" style={styles.text}>
        {message}
      </AppText>
      <View style={styles.retry}>
        <LinkButton label="Retry" onPress={onRetry} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.status.rose.bg,
    borderColor: colors.status.rose.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  text: {
    color: colors.status.rose.text,
  },
  retry: {
    alignSelf: 'flex-start',
  },
});
