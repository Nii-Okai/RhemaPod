import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText, Card } from '../../../components';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';

export interface AnnouncementsEntryProps {
  onPress: () => void;
}

/**
 * Home's Announcements entry point (planner resolution P2: "Home gets an announcements
 * card/row" — no 6th tab, since the phone tab bar is locked at 5, L4). The Announcements
 * screen itself (`app/(tabs)/announcements.tsx`) is W4.4's content to build; this is only
 * the navigation affordance into it, identical on both platforms (no chrome-specific
 * treatment is called for anywhere in the spec for this row).
 */
export function AnnouncementsEntry({ onPress }: AnnouncementsEntryProps) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Announcements">
      <Card style={styles.row}>
        <View style={styles.textBlock}>
          <AppText variant="ui.bodyLarge">Announcements</AppText>
          <AppText variant="ui.body" tone="secondary">
            What's happening at the church
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.text.tertiary} />
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  textBlock: {
    flex: 1,
    gap: spacing.xs,
  },
});
