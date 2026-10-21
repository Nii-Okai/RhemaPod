import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, type PressableProps } from 'react-native';
import { AppText } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';

export interface SocialSignInButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  provider: 'google' | 'apple';
  label: string;
  loading?: boolean;
}

/**
 * "Continue with Google/Apple" — the bordered-surface look (Isaac's ask, session
 * 2026-10-15), not a filled gold pill (reserved for the primary "Sign in" action, see
 * `Button.tsx`'s own doc comment) and not the bare gold text link (`LinkButton`).
 * Mirrors the admin portal's `secondary` button variant's intent (bordered, surface
 * background, ink text — `admin_portal/components/ui/button.tsx`) since `LinkButton`'s
 * own comment says any future outline-style need should follow that existing
 * convention rather than inventing one fresh, not a literal shared component (RN/web
 * can't share one anyway).
 *
 * Renders `Ionicons` directly rather than going through `PlatformIcon` — Google's and
 * Apple's brand marks have no Material Icons equivalent at all (Material Icons is
 * Google's own generic icon set, not a library of other brands' logos), so there is no
 * second platform glyph to pick between. A brand mark should look identical on iOS and
 * Android anyway, unlike this app's generic UI icons, so using the one Ionicons glyph
 * on both platforms is the correct choice here, not a gap in `PlatformIcon`'s coverage.
 */
export function SocialSignInButton({ provider, label, loading = false, disabled, ...rest }: SocialSignInButtonProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const isDisabled = Boolean(disabled) || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={({ pressed }) => [styles.base, pressed && !isDisabled && styles.pressed, isDisabled && styles.disabled]}
      {...rest}
    >
      <Ionicons name={provider === 'google' ? 'logo-google' : 'logo-apple'} size={18} color={colors.text.primary} />
      <AppText variant="ui.button" tone="primary">
        {label}
      </AppText>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.sunken,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
  },
  pressed: {
    backgroundColor: colors.surface.raised,
  },
  disabled: {
    opacity: 0.4,
  },
}));
