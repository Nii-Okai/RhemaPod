import React, { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { AppText, IconButton } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';

export interface FieldProps extends TextInputProps {
  label: string;
  error?: string | null;
}

/**
 * Label + input + inline error, the one composition every auth screen needs
 * (sign-in, register, forgot-password). Screen-specific per Card's own
 * scoping note ("domain/screen-specific compositions belong to the screens
 * that need them, not `components/`") — mirrors the admin portal's
 * `Field` (`admin_portal/app/(public)/_components/field.tsx`): label turns
 * rose on error, rose border, 12px rose message below.
 *
 * `secureTextEntry` fields (Isaac's ask, session 2026-10-15: "add feature to
 * allow viewing password") get a show/hide eye toggle for free — the field
 * manages its own reveal state internally, so every password field in the
 * app gets this without each screen wiring it separately. A field that isn't
 * `secureTextEntry` renders exactly as before, no toggle, no layout change.
 */
export const Field = React.forwardRef<TextInput, FieldProps>(function Field(
  { label, error, style, secureTextEntry, ...rest },
  ref,
) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [revealed, setRevealed] = useState(false);
  const isPasswordField = Boolean(secureTextEntry);

  return (
    <View style={styles.container}>
      <AppText variant="ui.label" tone="secondary" style={error ? styles.errorLabel : undefined}>
        {label}
      </AppText>
      <View style={styles.inputRow}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.text.tertiary}
          secureTextEntry={isPasswordField && !revealed}
          style={[
            styles.input,
            isPasswordField ? styles.inputWithToggle : null,
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
    gap: spacing.xs,
  },
  inputRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.sunken,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text.primary,
    fontSize: 15,
  },
  inputWithToggle: {
    // Clears the toggle's full touch target (20px icon + spacing.sm padding on
    // each side = 36px), not just the glyph itself, so long input text never
    // visually runs under the button.
    paddingRight: 44,
  },
  toggle: {
    position: 'absolute',
    right: spacing.xs,
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
