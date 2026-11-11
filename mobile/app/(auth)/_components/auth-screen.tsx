import React from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, CircleButton, type AppTextVariant } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';

/**
 * The shared shell for sign in, create account, forgot password and verify email
 * (Daybreak redesign, canvas A3 to A6). The form sits straight on the page, not in a
 * card:
 *
 *  - the top row is either the RhemaPod wordmark (sign in) or a round back button with an
 *    optional "Step 2 of 2" in the middle;
 *  - an optional badge or eyebrow, then a Fraunces heading and a short line under it;
 *  - the screen's own content;
 *  - `footer` is pinned to the foot of the screen: the main button and the switch line
 *    ("New here? Create an account"). It scrolls with the rest when the keyboard is up.
 */
export function AuthScreen({
  eyebrow,
  badge,
  heading,
  headingVariant = 'display.hero',
  subhead,
  subheadVariant = 'ui.bodyLarge',
  centerHeader = false,
  onBack,
  backLabel = 'Back',
  stepLabel,
  art,
  children,
  footer,
}: {
  /** Small uppercase line over the heading ("One more step"). */
  eyebrow?: string;
  /** A pill over the heading instead of an eyebrow ("Free, always"). */
  badge?: string;
  heading: string;
  headingVariant?: AppTextVariant;
  subhead?: React.ReactNode;
  subheadVariant?: AppTextVariant;
  /** Centres the header block (the "Check your email" state). */
  centerHeader?: boolean;
  /** Shows a round back button in place of the wordmark. */
  onBack?: () => void;
  backLabel?: string;
  /** Shown in the middle of the top row beside the back button. */
  stepLabel?: string;
  /** An illustration above the header (the "Check your email" state). */
  art?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const styles = useStyles();
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const wordmark =
    scheme === 'light'
      ? require('../../../assets/brand/wordmark-on-light.png')
      : require('../../../assets/brand/wordmark-on-dark.png');

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top, spacing.lg) + spacing.md, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {onBack ? (
          <View style={styles.topRow}>
            <CircleButton icon="chevron-back" accessibilityLabel={backLabel} onPress={onBack} />
            {stepLabel ? (
              <AppText variant="ui.badge" tone="tertiary">
                {stepLabel}
              </AppText>
            ) : null}
            <View style={styles.topSpacer} />
          </View>
        ) : (
          <Image source={wordmark} style={styles.wordmark} resizeMode="contain" accessibilityLabel="RhemaPod" />
        )}

        {art ? <View style={styles.art}>{art}</View> : null}

        <View style={[styles.header, centerHeader && styles.headerCentered]}>
          {badge ? (
            <View style={styles.badge}>
              <AppText variant="ui.badge" style={styles.badgeText}>
                {badge.toUpperCase()}
              </AppText>
            </View>
          ) : null}
          {eyebrow ? (
            <AppText variant="ui.badge" tone="tertiary" style={styles.eyebrow}>
              {eyebrow.toUpperCase()}
            </AppText>
          ) : null}
          <AppText
            variant={headingVariant}
            tone="primary"
            accessibilityRole="header"
            style={centerHeader ? styles.textCentered : null}
          >
            {heading}
          </AppText>
          {subhead ? (
            <AppText variant={subheadVariant} tone="secondary" style={centerHeader ? styles.textCentered : null}>
              {subhead}
            </AppText>
          ) : null}
        </View>

        {children ? <View style={styles.body}>{children}</View> : null}

        <View style={styles.grow} />

        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = createThemedStyles((colors) => ({
  flex: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg + 4,
    gap: spacing.xl,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topSpacer: {
    width: 44,
  },
  wordmark: {
    width: 150,
    height: 27,
  },
  art: {
    alignItems: 'center',
    paddingTop: spacing.md,
  },
  header: {
    gap: spacing.sm + 2,
    paddingTop: spacing.md,
  },
  headerCentered: {
    alignItems: 'center',
  },
  textCentered: {
    textAlign: 'center',
  },
  badge: {
    alignSelf: 'flex-start',
    height: 24,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: colors.iris.soft,
  },
  badgeText: {
    color: colors.iris.ink,
    letterSpacing: 0.6,
  },
  eyebrow: {
    letterSpacing: 1.5,
  },
  body: {
    gap: spacing.xl,
  },
  grow: {
    flexGrow: 1,
  },
  footer: {
    gap: spacing.lg,
    alignItems: 'stretch',
  },
}));
