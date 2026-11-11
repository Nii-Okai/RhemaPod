import React, { useState } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { AppText, IconButton, PlatformIcon, type AppIconName } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';

export interface FieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  /** Leading glyph inside the input (Signature: mail for email, lock for passwords). */
  icon?: AppIconName;
  /** Sits at the right end of the label row ("Forgot?" beside Password, canvas A3). */
  labelAccessory?: React.ReactNode;
}

/**
 * Label + input + inline error, the one composition every auth screen needs
 * (sign-in, register, forgot-password, reset-password). Screen-specific per Card's own
 * scoping note ("domain/screen-specific compositions belong to the screens
 * that need them, not `components/`") — mirrors the admin portal's
 * `Field` (`admin_portal/app/(public)/_components/field.tsx`): label turns
 * rose on error, rose border, 12px rose message below.
 *
 * Daybreak redesign (canvas A3/A4): a 54pt white input with a 16pt corner, an optional
 * leading icon, and a blue border while focused (rose still wins when there's an error).
 *
 * `secureTextEntry` fields (Isaac's ask, session 2026-10-15: "add feature to
 * allow viewing password") get a show/hide eye toggle for free — the field
 * manages its own reveal state internally, so every password field in the
 * app gets this without each screen wiring it separately. A field that isn't
 * `secureTextEntry` renders exactly as before, no toggle, no layout change.
 */
export const Field = React.forwardRef<TextInput, FieldProps>(function Field(
  { label, error, icon, labelAccessory, style, secureTextEntry, onFocus, onBlur, ...rest },
  ref,
) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);
  const isPasswordField = Boolean(secureTextEntry);

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <AppText variant="ui.label" tone="primary" style={error ? styles.errorLabel : undefined}>
          {label}
        </AppText>
        {labelAccessory}
      </View>
      <View style={styles.inputRow}>
        {icon ? (
          <View style={styles.leading} pointerEvents="none">
            <PlatformIcon name={icon} size={18} color={focused ? colors.iris.fill : colors.text.tertiary} />
          </View>
        ) : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.text.tertiary}
          selectionColor={colors.iris.fill}
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  container: {
    gap: spacing.sm - 2,
  },
  inputRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  input: {
    borderRadius: 16,
    minHeight: 54,
    borderWidth: 1.5,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.raised,
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
    borderColor: colors.iris.fill,
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
