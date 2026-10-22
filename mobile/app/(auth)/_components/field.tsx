import React, { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { AppText, IconButton, PlatformIcon, type AppIconName } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import { LEAF_SM } from '../../(tabs)/_home/signature/leaf';

export interface FieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  /** Leading glyph inside the input (Signature: mail for email, lock for passwords). */
  icon?: AppIconName;
}

/**
 * Label + input + inline error, the one composition every auth screen needs
 * (sign-in, register, forgot-password, reset-password). Screen-specific per Card's own
 * scoping note ("domain/screen-specific compositions belong to the screens
 * that need them, not `components/`") — mirrors the admin portal's
 * `Field` (`admin_portal/app/(public)/_components/field.tsx`): label turns
 * rose on error, rose border, 12px rose message below.
 *
 * Signature redesign: the input takes the small leaf corner, an optional leading icon,
 * and a gold border while focused (rose still wins when there's an error).
 *
 * `secureTextEntry` fields (Isaac's ask, session 2026-10-15: "add feature to
 * allow viewing password") get a show/hide eye toggle for free — the field
 * manages its own reveal state internally, so every password field in the
 * app gets this without each screen wiring it separately. A field that isn't
 * `secureTextEntry` renders exactly as before, no toggle, no layout change.
 */
export const Field = React.forwardRef<TextInput, FieldProps>(function Field(
  { label, error, icon, style, secureTextEntry, onFocus, onBlur, ...rest },
  ref,
) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);
  const isPasswordField = Boolean(secureTextEntry);

  return (
    <View style={styles.container}>
      <AppText variant="ui.label" tone="secondary" style={error ? styles.errorLabel : undefined}>
        {label}
      </AppText>
      <View style={styles.inputRow}>
        {icon ? (
          <View style={styles.leading} pointerEvents="none">
            <PlatformIcon name={icon} size={18} color={focused ? colors.accent.goldText : colors.text.tertiary} />
          </View>
        ) : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.text.tertiary}
          selectionColor={colors.accent.gold}
          secureTextEntry={isPasswordField && !revealed}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            styles.input,
            icon ? styles.inputWithIcon : null,
            isPasswordField ? styles.inputWithToggle : null,
            focused ? styles.inputFocused : null,
            error ? styles.inputError : null,
            style,
          ]}
          {...rest}
        />
        {isPasswordField ? (
          <View style={styles.toggle}>
            <IconButton
              icon={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.text.secondary}
              accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
              onPress={() => setRevealed((v) => !v)}
            />
          </View>
        ) : null}
      </View>
      {error ? (
        <AppText variant="ui.badge" style={styles.errorText}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
});

const useStyles = createThemedStyles((colors) => ({
  container: {
    gap: spacing.sm - 2,
  },
  inputRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  input: {
    ...LEAF_SM,
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.sunken,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.text.primary,
    fontSize: 16,
  },
  inputWithIcon: {
    paddingLeft: spacing.lg + 18 + spacing.md,
  },
  inputWithToggle: {
    // Clears the toggle's full touch target (20px icon + spacing.sm padding on
    // each side = 36px), not just the glyph itself, so long input text never
    // visually runs under the button.
    paddingRight: 48,
  },
  inputFocused: {
    borderColor: colors.accent.gold,
  },
  leading: {
    position: 'absolute',
    left: spacing.lg,
    zIndex: 1,
  },
  toggle: {
    position: 'absolute',
    right: spacing.sm,
  },
  inputError: {
    borderColor: colors.status.rose.border,
  },
  errorLabel: {
    color: colors.status.rose.text,
  },
  errorText: {
    color: colors.status.rose.text,
  },
}));
