import React, { useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { AppText } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { spacing } from '../../../theme/spacing';
import { LEAF_SM } from '../../(tabs)/_home/signature/leaf';

export const CODE_LENGTH = 6;

/**
 * Six-digit email-confirmation code entry, Signature style: leaf-cornered boxes with the
 * digits in IBM Plex Mono (numeric data, per typography.ts), the active box ringed gold.
 *
 * One real (visually hidden) TextInput sits under the boxes rather than six inputs, so
 * paste, iOS's "From Mail" one-time-code suggestion and Android autofill all fill the
 * whole code in one go, and backspace just works. Tapping the boxes focuses it.
 */
export function CodeInput({
  value,
  onChangeText,
  error,
  onComplete,
  autoFocus = true,
}: {
  value: string;
  onChangeText: (next: string) => void;
  error?: string | null;
  /** Fires once the sixth digit is entered — screens submit from here. */
  onComplete?: (code: string) => void;
  autoFocus?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  function handleChange(raw: string) {
    const next = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
    onChangeText(next);
    if (next.length === CODE_LENGTH && next !== value) onComplete?.(next);
  }

  const activeIndex = Math.min(value.length, CODE_LENGTH - 1);

  return (
    <View style={styles.container}>
      <Pressable
        onPress={() => inputRef.current?.focus()}
        accessible={false}
        style={styles.boxes}
      >
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const digit = value[i] ?? '';
          const isActive = focused && i === activeIndex;
          return (
            <View
              key={i}
              style={[
                styles.box,
                digit ? styles.boxFilled : null,
                isActive ? styles.boxActive : null,
                error ? styles.boxError : null,
              ]}
            >
              <AppText variant="mono.counter" tone="primary">
                {digit}
              </AppText>
            </View>
          );
        })}
      </Pressable>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={CODE_LENGTH}
        accessibilityLabel="Verification code"
        caretHidden
        selectionColor={colors.accent.gold}
        style={styles.hiddenInput}
      />
      {error ? (
        <AppText variant="ui.badge" style={styles.errorText}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  container: {
    gap: spacing.sm,
  },
  boxes: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  box: {
    ...LEAF_SM,
    flex: 1,
    aspectRatio: 0.82,
    maxHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.surface.sunken,
  },
  boxFilled: {
    borderColor: colors.border.card,
  },
  boxActive: {
    borderColor: colors.accent.gold,
  },
  boxError: {
    borderColor: colors.status.rose.border,
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  errorText: {
    color: colors.status.rose.text,
  },
}));
