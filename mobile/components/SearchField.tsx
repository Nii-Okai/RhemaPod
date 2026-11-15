import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { PlatformIcon } from './PlatformIcon';
import { createThemedStyles, useTheme } from '../theme/ThemeContext';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';
import { fontFamily } from '../theme/typography';

export interface SearchFieldProps
  extends Omit<TextInputProps, 'style' | 'value' | 'onChangeText' | 'placeholderTextColor' | 'selectionColor'> {
  value: string;
  onChangeText: (next: string) => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}

/** Height every search field in the app shares: the 44pt touch target, nothing taller. */
export const SEARCH_FIELD_HEIGHT = 44;

/**
 * The one search field the app draws (Search, Discover, Your library), so the three no
 * longer each look a little different (Nii, 2026-11-15: "tidy up the search bar, looks
 * out of place"). Shaped like the system search fields in Apple Music and Podcasts: a
 * 44pt rounded rectangle on the raised card colour with a hairline edge, a quiet
 * tertiary glass and placeholder, body text in the app's UI face, and a clear button
 * once there is something to clear. Focus only tints the edge.
 */
export function SearchField({ value, onChangeText, accessibilityLabel, style, onFocus, onBlur, ...rest }: SearchFieldProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.field, focused && styles.fieldFocused, style]}>
      <PlatformIcon name="search" size={18} color={colors.text.tertiary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        placeholderTextColor={colors.text.tertiary}
        selectionColor={colors.iris.fill}
        style={styles.input}
        accessibilityLabel={accessibilityLabel}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        {...rest}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={spacing.sm}
        >
          <PlatformIcon name="close-circle" size={18} color={colors.text.tertiary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: SEARCH_FIELD_HEIGHT,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.card,
    backgroundColor: colors.surface.raised,
  },
  fieldFocused: {
    borderColor: colors.iris.fill,
  },
  input: {
    flex: 1,
    alignSelf: 'stretch',
    padding: 0,
    fontFamily: fontFamily.ui,
    fontSize: 16,
    color: colors.text.primary,
  },
}));
