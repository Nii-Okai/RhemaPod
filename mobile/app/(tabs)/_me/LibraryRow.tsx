import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '../../../components';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';

export interface LibraryRowProps {
  label: string;
  onPress: () => void;
}

/**
 * A single navigating row (design spec 1n's Library section, P8: "the Library section
 * becomes two plain rows that navigate to the lists" — no counts). Also reused for the
 * Announcements row (P2: "'Me' gets an Announcements row") — same shape, different
 * destination, not a distinct component.
 */
export function LibraryRow({ label, onPress }: LibraryRowProps) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.row}>
      <AppText variant="ui.bodyLarge">{label}</AppText>
      <View style={styles.chevron}>
        <Ionicons name="chevron-forward" size={18} color={colors.text.tertiary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  chevron: {
    marginLeft: spacing.sm,
  },
});
