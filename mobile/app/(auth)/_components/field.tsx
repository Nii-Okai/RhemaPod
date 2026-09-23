import React from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { AppText } from '../../../components';
import { colors } from '../../../theme/colors';
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
 */
export const Field = React.forwardRef<TextInput, FieldProps>(function Field(
  { label, error, style, ...rest },
  ref,
) {
  return (
    <View style={styles.container}>
      <AppText variant="ui.label" tone="secondary" style={error ? styles.errorLabel : undefined}>
        {label}
      </AppText>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.text.tertiary}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...rest}
      />
      {error ? (
        <AppText variant="ui.badge" style={styles.errorText}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
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
  inputError: {
    borderColor: colors.status.rose.border,
  },
  errorLabel: {
    color: colors.status.rose.text,
  },
  errorText: {
    color: colors.status.rose.text,
  },
});
