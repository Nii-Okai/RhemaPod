import React from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, type AppTextVariant } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import { Flame } from '../../(tabs)/_home/signature/Flame';
import { LEAF } from '../../(tabs)/_home/signature/leaf';

/**
 * The shared shell for sign-in / register / forgot-password / reset-password /
 * check-email, Signature redesign (Nii's ask, 2026-10-22: "feel free to redesign
 * signin/signup, password reset screens"). Same vocabulary as the rest of Signature:
 *
 *  - the brand mark wears a gold ring (the You tab's avatar treatment) beside the
 *    "RhemaPod" wordmark, left-aligned like every other Signature screen's header;
 *  - a mono uppercase eyebrow over a Newsreader `display.hero` heading;
 *  - the form sits on a leaf-cornered raised card, with the oversized faint flame in
 *    its corner that the You tab's profile card already carries;
 *  - `footer` renders below the card on the bare screen background (the "New here? /
 *    Already have an account?" switch line), so the card holds only the task at hand.
 *
 * Anchored near the top rather than vertically centred (Isaac's ask, 2026-10-16: the
 * short forgot-password form read as floating low when centred).
 */
export function AuthScreen({
  eyebrow,
  heading,
  headingVariant = 'display.hero',
  subhead,
  subheadVariant = 'ui.bodyLarge',
  centerHeader = false,
  centerBrand = false,
  children,
  footer,
}: {
  eyebrow?: string;
  heading: string;
  /** Smaller headings (e.g. `display.title`) for screens with more content to fit above the fold. */
  headingVariant?: AppTextVariant;
  subhead?: React.ReactNode;
  subheadVariant?: AppTextVariant;
  /** Centers the eyebrow/heading/subhead instead of the usual left alignment — sign-in's ask. */
  centerHeader?: boolean;
  /** Centers the brand mark + wordmark instead of the usual left alignment — sign-in's ask. */
  centerBrand?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'height' : undefined}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: Math.max(insets.top, spacing.lg) + spacing.xs, paddingBottom: insets.bottom + spacing.xxl * 2 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.brandRow, centerBrand ? styles.brandRowCentered : null]}>
          <View style={styles.brandMark}>
            <Image
              source={require('../../../assets/icon-mark.png')}
              style={styles.brandIcon}
              resizeMode="contain"
              accessible={false}
            />
          </View>
          <AppText variant="display.compact" tone="primary">
            RhemaPod
          </AppText>
        </View>

        <View style={[styles.header, centerHeader ? styles.headerCentered : null]}>
          {eyebrow ? (
            <View style={styles.eyebrowRow}>
              <Flame width={9} fill={colors.accent.gold} />
              <AppText variant="mono.meta" tone="gold">
                {eyebrow.toUpperCase()}
              </AppText>
            </View>
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

        <View style={styles.card}>
          <View style={styles.cardFlame} pointerEvents="none">
            <Flame width={120} fill={colors.accent.gold} />
          </View>
          {children}
        </View>

        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const BRAND_SIZE = 40;

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
    gap: spacing.md,
  },
  brandRowCentered: {
    justifyContent: 'center',
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
  header: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  headerCentered: {
    alignItems: 'center',
  },
  textCentered: {
    textAlign: 'center',
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm - 2,
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
