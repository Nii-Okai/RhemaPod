import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { AppText } from '../../components';
import { createThemedStyles } from '../../theme/ThemeContext';
import { spacing } from '../../theme/spacing';

export interface SearchRowProps {
  label: string;
  /** Falls back to `label` — pass this when the visible text alone loses real
      information a richer row would show (a sermon's duration/speaker, a series'
      episode count, a speaker's bio), same convention this whole slice uses elsewhere
      for a dropped-but-still-announced detail. */
  accessibilityLabel?: string;
  onPress: () => void;
}

/**
 * One plain text row with a hairline divider: a flat list of titles, no
 * thumbnails/avatars/icons. Search uses it for live suggestions.
 */
export function SearchRow({ label, accessibilityLabel, onPress }: SearchRowProps) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <AppText variant="ui.bodyLarge" numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  rowPressed: {
    opacity: 0.7,
  },
}));
