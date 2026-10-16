import React from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';

/**
 * The shared shell for sign-in / register / forgot-password (spec 1m,
 * mirroring the admin portal's `AuthLayout` two-part structure — heading +
 * subhead, then the form — minus the desktop-only brand aside, which has no
 * mobile-width equivalent in the spec).
 *
 * Design pass (Isaac's ask, session 2026-10-16: "reorganise the page in a way
 * that is user friendly and appealing"): a centered brand mark now sits above
 * the heading/subhead on every auth screen, giving the group an actual focal
 * point instead of a heading that just starts at the top of the scroll view.
 * The mark reuses `chip.circle` + `goldText` — the same circular-chip
 * convention `TabletRail`'s profile icon already established — rather than
 * inventing a new badge treatment for one screen. Heading/subhead are now
 * centered under it (previously left-aligned); the form content below stays
 * left-aligned, since that's how label/input pairs read.
 *
 * Anchored near the top (Isaac's ask, session 2026-10-16: "the forgot
 * password screen is centered down, move it up a bit") rather than true
 * vertical centering — `forgot-password.tsx`'s content (one field + button)
 * is much shorter than sign-in/register's, so centering it in the full
 * screen height left a lot of dead space below and made the form read as
 * floating low. A fixed top offset (safe-area-aware, same `insets.top`
 * pattern `HomeTopBar` already uses) reads consistently across all three
 * screens regardless of how much content each one has.
 */
export function AuthScreen({
  heading,
  subhead,
  children,
}: {
  heading: string;
  subhead: string;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'height' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, spacing.xxl) + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.brandMark}>
            <Image
              source={require('../../../assets/icon-mark.png')}
              style={styles.brandIcon}
              resizeMode="contain"
              accessible={false}
            />
          </View>
          <View style={styles.headerText}>
            <AppText variant="display.title" tone="primary" style={styles.centerText}>
              {heading}
            </AppText>
            <AppText variant="ui.bodyLarge" tone="secondary" style={styles.centerText}>
              {subhead}
            </AppText>
          </View>
        </View>
        <View style={styles.form}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  content: {
    flexGrow: 1,
    padding: spacing.xxl,
    gap: spacing.xxl,
  },
  header: {
    alignItems: 'center',
    gap: spacing.lg,
  },
  brandMark: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chip.circle,
  },
  brandIcon: {
    width: 36,
    height: 36,
  },
  headerText: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  centerText: {
    textAlign: 'center',
  },
  form: {
    gap: spacing.xl,
  },
});
