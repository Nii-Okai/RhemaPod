import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { AppText } from '../../../components';
import { spacing } from '../../../theme/spacing';

export interface SuggestionRowProps {
  suggestion: string;
  onPress: () => void;
}

/** Design spec 1j: "↗ storm" — tapping fills the search box with the suggestion text. */
export function SuggestionRow({ suggestion, onPress }: SuggestionRowProps) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Search for "${suggestion}"`} style={styles.row}>
      <AppText variant="ui.body">{'↗'} {suggestion}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacing.sm,
  },
});
