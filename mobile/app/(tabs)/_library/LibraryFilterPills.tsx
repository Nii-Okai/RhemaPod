import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';

export type LibraryFilter = 'playlists' | 'downloaded' | null;

export interface LibraryFilterPillsProps {
  value: LibraryFilter;
  onChange: (value: LibraryFilter) => void;
}

/** "Playlists" / "Downloaded" filter pills (Isaac's screenshots — the
 * reference also shows "Artists", left out since this app has no artist-
 * library concept). Exclusive: selecting a pill filters the list to just
 * that section; tapping the already-selected pill again clears the filter
 * back to showing both sections, same as Spotify's own behavior. */
export function LibraryFilterPills({ value, onChange }: LibraryFilterPillsProps) {
  const toggle = (pill: 'playlists' | 'downloaded') => onChange(value === pill ? null : pill);

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => toggle('playlists')}
        accessibilityRole="button"
        accessibilityState={{ selected: value === 'playlists' }}
        style={[styles.pill, value === 'playlists' && styles.pillSelected]}
      >
        <AppText variant="ui.button" tone={value === 'playlists' ? 'inverse' : 'primary'}>
          Playlists
        </AppText>
      </Pressable>
      <Pressable
        onPress={() => toggle('downloaded')}
        accessibilityRole="button"
        accessibilityState={{ selected: value === 'downloaded' }}
        style={[styles.pill, value === 'downloaded' && styles.pillSelected]}
      >
        <AppText variant="ui.button" tone={value === 'downloaded' ? 'inverse' : 'primary'}>
          Downloaded
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.chip.square,
  },
  pillSelected: {
    backgroundColor: colors.text.primary,
  },
});
