import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';

export interface BrowseSearchEntryProps {
  onPress: () => void;
}

/**
 * Browse's search entry point (Isaac's ask, session 2026-10-02 — Prime Video reference
 * screenshots: a white pill search field at the top of the tab, same on every platform).
 * The dedicated Search tab is gone; Browse is now the only way in, on iOS and Android
 * alike — this used to render Android-only (`AndroidSearchEntry`), with iOS reaching
 * Search purely via its own tab bar item. Still just an entry point, not an inline search
 * box — tapping it pushes `/search` (a top-level stack route, not a tab), which owns the
 * actual query/suggest/results flow.
 *
 * `colors.primaryButton` (white pill bg + dark text, "the only filled non-gold primary
 * action") is reused here rather than a new token — same reasoning: a light pill reads as
 * a distinct, obviously-tappable control against this app's otherwise all-dark surfaces,
 * same as the reference.
 */
export function BrowseSearchEntry({ onPress }: BrowseSearchEntryProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="search"
      accessibilityLabel="Search sermons, series, speakers"
      style={({ pressed }) => [styles.bar, pressed && styles.barPressed]}
    >
      <Ionicons name="search" size={18} color={colors.primaryButton.text} style={styles.icon} />
      <AppText variant="ui.body" tone="inverse" style={styles.placeholder}>
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
    backgroundColor: colors.primaryButton.bg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  barPressed: {
    opacity: 0.7,
  },
  icon: {
    opacity: 0.6,
  },
  placeholder: {
    flex: 1,
    opacity: 0.6,
  },
});
