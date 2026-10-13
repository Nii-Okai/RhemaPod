import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText, ConfirmDialog, PlatformIcon } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import type { PlaylistPublic } from '../../../lib/query/hooks/usePlaylists';

export interface PlaylistGridTileProps {
  playlist: PlaylistPublic;
  width: number;
  onPress: () => void;
  onDelete: () => void;
}

/** Grid-mode variant of `PlaylistCard` (Isaac's screenshots) — a square
 * cover with the name below it, no subtitle (the grid is deliberately
 * denser than the list; item count/duration is one tap away on the
 * playlist's own detail screen). `width` is computed by the caller
 * (`library.tsx`) from the current window width and `GRID_COLUMNS`, same
 * pattern `browse.tsx`'s own category grid uses.
 *
 * Long-press opens a delete confirm, same as `PlaylistCard`'s own list-mode
 * long-press and `DownloadGridTile`'s grid-mode one (Isaac's ask, session
 * 2026-10-10). */
export function PlaylistGridTile({ playlist, width, onPress, onDelete }: PlaylistGridTileProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <>
      <Pressable
        onPress={onPress}
        onLongPress={() => setConfirmingDelete(true)}
        accessibilityRole="button"
        accessibilityLabel={playlist.name}
        accessibilityActions={[{ name: 'delete', label: 'Delete' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'delete') onDelete();
        }}
        style={({ pressed }) => [{ width }, pressed && styles.pressed]}
      >
        {playlist.cover_url ? (
          <Image source={{ uri: playlist.cover_url }} style={[styles.cover, { width, height: width }]} />
        ) : (
          <View style={[styles.coverFallback, { width, height: width }]}>
            <PlatformIcon name="musical-note" size={width * 0.3} color={colors.text.tertiary} />
          </View>
        )}
        <AppText variant="ui.body" numberOfLines={2} style={styles.title}>
          {playlist.name}
        </AppText>
      </Pressable>

      <ConfirmDialog
        visible={confirmingDelete}
        title="Delete this playlist?"
        body={`"${playlist.name}" will be removed. This can't be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmingDelete(false);
          onDelete();
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  cover: {
    borderRadius: radius.md,
  },
  coverFallback: {
    borderRadius: radius.md,
    backgroundColor: colors.surface.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: spacing.sm,
  },
});
