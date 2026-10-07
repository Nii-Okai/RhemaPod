import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '../../../components';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';

export interface LibraryRowProps {
  label: string;
  onPress: () => void;
  /** A secondary line under the label (the current name, a contact address). */
  detail?: string;
  /** Overrides the default accessible name (the label, plus the detail when present). */
  accessibilityLabel?: string;
  /** Hides the trailing chevron for a row that doesn't navigate. */
  hideChevron?: boolean;
}

/**
 * A single navigating row (design spec 1n's Library section, P8: "the Library section
 * becomes two plain rows that navigate to the lists" — no counts). Also reused for the
 * Announcements row (P2: "'Me' gets an Announcements row") — same shape, different
 * destination, not a distinct component.
 */
export function LibraryRow({ label, onPress, detail, accessibilityLabel, hideChevron = false }: LibraryRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (detail ? `${label}, ${detail}` : label)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.text}>
        <AppText variant="ui.bodyLarge">{label}</AppText>
        {detail ? (
          <AppText variant="ui.body" tone="secondary">
            {detail}
          </AppText>
        ) : null}
      </View>
      {hideChevron ? null : (
        <View style={styles.chevron}>
          <Ionicons name="chevron-forward" size={18} color={colors.text.tertiary} />
        </View>
      )}
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
  rowPressed: {
    opacity: 0.7,
  },
  text: {
    flex: 1,
  },
  chevron: {
    marginLeft: spacing.sm,
  },
});
