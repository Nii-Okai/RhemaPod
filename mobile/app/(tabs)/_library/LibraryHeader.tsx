import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, PlatformIcon } from '../../../components';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';

export interface LibraryHeaderProps {
  searchActive: boolean;
  onToggleSearch: () => void;
  onCreatePlaylist: () => void;
}

/** "Library" title + search and new-playlist icons at the top right
 * (Isaac's ask, session 2026-10-10). The search icon toggles an inline
 * search field (`library.tsx`'s own `searchActive` state) that filters
 * whatever's currently visible — playlists by name, downloads by title —
 * client-side; there's no server-side "search my library" endpoint to call,
 * and none is needed since both lists are already loaded in full. */
export function LibraryHeader({ searchActive, onToggleSearch, onCreatePlaylist }: LibraryHeaderProps) {
  return (
    <View style={styles.row}>
      <AppText variant="display.section">Library</AppText>
      <View style={styles.actions}>
        <Pressable
          onPress={onToggleSearch}
          accessibilityRole="button"
          accessibilityLabel={searchActive ? 'Close search' : 'Search your library'}
          hitSlop={spacing.sm}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <PlatformIcon name={searchActive ? 'close' : 'search'} size={22} color={colors.text.primary} />
        </Pressable>
        <Pressable
          onPress={onCreatePlaylist}
          accessibilityRole="button"
          accessibilityLabel="New playlist"
          hitSlop={spacing.sm}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <PlatformIcon name="add" size={24} color={colors.text.primary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  pressed: {
    opacity: 0.7,
  },
});
