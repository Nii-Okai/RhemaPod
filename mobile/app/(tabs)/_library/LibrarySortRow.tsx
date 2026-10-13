import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, PlatformIcon } from '../../../components';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { SORT_MODE_LABEL, type LibrarySortMode } from './librarySort';

export type LibraryLayout = 'list' | 'grid';

export interface LibrarySortRowProps {
  sortMode: LibrarySortMode;
  onSortPress: () => void;
  layout: LibraryLayout;
  onToggleLayout: () => void;
}

/** Sort control (left) + list/grid toggle (right) — Isaac's screenshots.
 * The toggle icon shows the layout a tap would switch *to* (a grid icon
 * while in list mode, a list icon while in grid mode), matching the
 * reference exactly. Tertiary tone throughout (text, icons) — a secondary
 * utility row sitting under the bolder filter pills, not a heading; the
 * reference's own "Recents" row reads as muted gray, not bright white. */
export function LibrarySortRow({ sortMode, onSortPress, layout, onToggleLayout }: LibrarySortRowProps) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onSortPress}
        accessibilityRole="button"
        accessibilityLabel={`Sort by ${SORT_MODE_LABEL[sortMode]}`}
        style={({ pressed }) => [styles.sortButton, pressed && styles.pressed]}
      >
        <PlatformIcon name="swap-vertical" size={15} color={colors.text.tertiary} />
        <AppText variant="ui.label" tone="tertiary">
          {SORT_MODE_LABEL[sortMode]}
        </AppText>
      </Pressable>
      <Pressable
        onPress={onToggleLayout}
        accessibilityRole="button"
        accessibilityLabel={layout === 'list' ? 'Switch to grid view' : 'Switch to list view'}
        hitSlop={spacing.sm}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <PlatformIcon name={layout === 'list' ? 'grid-outline' : 'list'} size={19} color={colors.text.tertiary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pressed: {
    opacity: 0.7,
  },
});
