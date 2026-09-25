import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';

export interface AndroidSearchEntryProps {
  onPress: () => void;
}

/**
 * Design spec 2d: the M3 search bar drawn at the top of Browse on Android
 * only (iOS reaches Search purely via the tab bar, spec §1.2's text-only
 * chrome). This is an entry point, not an inline search box — tapping it
 * navigates to the Search tab, which owns the actual query/suggest/results
 * flow; nothing here talks to `/search` directly.
 */
export function AndroidSearchEntry({ onPress }: AndroidSearchEntryProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="search"
      accessibilityLabel="Search sermons, series, speakers"
      style={styles.bar}
    >
      <Ionicons name="search" size={18} color={colors.text.tertiary} />
      <AppText variant="ui.body" tone="tertiary" style={styles.placeholder}>
        Search sermons, series, speakers
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface.raised,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  placeholder: {
    flex: 1,
  },
});
