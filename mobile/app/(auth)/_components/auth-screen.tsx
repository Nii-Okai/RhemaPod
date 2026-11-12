import React from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, CircleButton, type AppTextVariant } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import { Flame } from '../../(tabs)/_home/signature/Flame';
import { LEAF } from '../../(tabs)/_home/signature/leaf';

/**
 * The shared shell for sign in, create account, forgot password and verify email.
 *
 * Laid out and ordered as before the Daybreak redesign (Nii, 2026-11-12: "maintain the
 * layout and ordering from the previous design"), in Daybreak's colours and type:
 *
 *  - the brand row on top: the mark in a gold ring beside the RhemaPod wordmark, centred.
 *    Screens you can leave put a round back button on the left of that row;
 *  - an optional badge or eyebrow, then the heading and a short line under it;
 *  - the form, main button included, on a leaf-cornered raised card with a faint flame
 *    in its corner;
 *  - `footer` below the card on the bare page (the "New here? / Already have an
 *    account?" switch line), so the card holds only the task at hand.
 *
 * Anchored near the top rather than vertically centred (Isaac, 2026-10-16: a short form
 * read as floating low when centred).
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
  /** Centres the header block (sign in, create account, the "Check your email" state). */
  centerHeader?: boolean;
  /** Shows a round back button on the left of the brand row. */
  onBack?: () => void;
  backLabel?: string;
  /** "Step 2 of 2": shown over the heading when there is no eyebrow. */
  stepLabel?: string;
  /** An illustration above the header (the "Check your email" state). */
  art?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const styles = useStyles();
  const { scheme, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const wordmark =
    scheme === 'light'
      ? require('../../../assets/brand/wordmark-on-light.png')
      : require('../../../assets/brand/wordmark-on-dark.png');
  const kicker = eyebrow ?? stepLabel;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, spacing.lg) + spacing.sm,
            paddingBottom: insets.bottom + spacing.xxl,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandRow}>
          <View style={styles.brandSide}>
            {onBack ? <CircleButton icon="chevron-back" accessibilityLabel={backLabel} onPress={onBack} /> : null}
          </View>
          <View style={styles.brand} accessible accessibilityLabel="RhemaPod">
            <View style={styles.brandMark}>
              <Image
                source={require('../../../assets/icon-mark.png')}
                style={styles.brandIcon}
                resizeMode="contain"
                accessible={false}
              />
            </View>
            <Image source={wordmark} style={styles.wordmark} resizeMode="contain" accessible={false} />
          </View>
          <View style={styles.brandSide} />
        </View>

        {art ? <View style={styles.art}>{art}</View> : null}

        <View style={[styles.header, centerHeader && styles.headerCentered]}>
          {badge ? (
            <View style={[styles.badge, !centerHeader && styles.badgeLeft]}>
              <AppText variant="ui.badge" style={styles.badgeText}>
                {badge.toUpperCase()}
              </AppText>
            </View>
          ) : null}
          {kicker ? (
            <AppText variant="ui.badge" tone="tertiary" style={styles.eyebrow}>
              {kicker.toUpperCase()}
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

        {children ? (
          <View style={styles.card}>
            <View style={styles.cardFlame} pointerEvents="none">
              <Flame width={120} fill={colors.accent.gold} />
            </View>
            {children}
          </View>
        ) : null}

        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const BRAND_SIZE = 40;
const SIDE = 44;

const useStyles = createThemedStyles((colors) => ({
  flex: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    gap: spacing.xl,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandSide: {
    width: SIDE,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  brandMark: {
    width: BRAND_SIZE,
    height: BRAND_SIZE,
    borderRadius: BRAND_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chip.circle,
    borderWidth: 1.5,
    borderColor: colors.accent.gold,
  },
  brandIcon: {
    width: 22,
    height: 22,
  },
  wordmark: {
    width: 128,
    height: 23,
  },
  art: {
    alignItems: 'center',
  },
  header: {
    gap: spacing.sm,
  },
  headerCentered: {
    alignItems: 'center',
  },
  textCentered: {
    textAlign: 'center',
  },
  badge: {
    height: 24,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: 12,
    justifyContent: 'center',
    backgroundColor: colors.iris.soft,
  },
  badgeLeft: {
    alignSelf: 'flex-start',
  },
  badgeText: {
    color: colors.iris.ink,
    letterSpacing: 0.6,
  },
  eyebrow: {
    letterSpacing: 1.5,
  },
  card: {
    ...LEAF,
    overflow: 'hidden',
    padding: spacing.xl,
    gap: spacing.xl,
    backgroundColor: colors.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
  },
  cardFlame: {
    position: 'absolute',
    right: -22,
    top: -28,
    opacity: 0.08,
  },
  footer: {
    alignItems: 'center',
    gap: spacing.md,
  },
}));
