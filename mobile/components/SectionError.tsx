import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './Text';
import { LinkButton } from './Button';
import { createThemedStyles } from '../theme/ThemeContext';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';

export interface SectionErrorProps {
  message: string;
  onRetry: () => void;
}

/**
 * Same error-banner + Retry shape `QueryState.tsx` already uses for Browse/Search,
 * kept as its own component rather than folded into `QueryState`: a shelf section
 * (Home's hero/continue-watching/series, the Library tab's own continue-watching
 * shelf) needs a *skeleton* loading state (`HeroSkeleton`/`ShelfSkeleton`), not
 * `QueryState`'s spinner, so this reuses only its error-branch visual/copy
 * convention, not the component itself. Promoted here from Home's own `_home/`
 * folder once the Library tab became a second consumer, same promotion bar
 * `Sheet`/`ConfirmDialog` already cleared this session.
 */
export function SectionError({ message, onRetry }: SectionErrorProps) {
  const styles = useStyles();
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

const useStyles = createThemedStyles((colors) => ({
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
}));
