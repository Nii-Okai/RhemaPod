import React, { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { AppText, ConfirmDialog, PlatformIcon } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { formatPlaylistMinutes } from '../../../lib/format/playlistDuration';
import type { PlaylistPublic } from '../../../lib/query/hooks/usePlaylists';
import { LIST_THUMBNAIL_SIZE } from './libraryLayout';

export interface PlaylistCardProps {
  playlist: PlaylistPublic;
  onPress: () => void;
  onDelete: () => void;
}

/** One row in the Library tab's combined list — cover thumbnail (or a
 * placeholder note-glyph tile when no cover has been set), name, and an item
 * count / duration subtitle. Mirrors `LibraryRow`'s plain-navigating-row shape
 * from Profile & Settings, with a real thumbnail in place of a bare chevron
 * row — this is a visual destination (a cover art grid, Spotify's own
 * reference), not a settings list.
 *
 * Long-press opens a delete confirm (Isaac's ask, session 2026-10-10), same
 * `ConfirmDialog` + long-press shape `DownloadRow` already uses — a playlist
 * no longer needs a trip into its own detail screen's "Name & details" sheet
 * just to delete it from the library list it's sitting in. */
export function PlaylistCard({ playlist, onPress, onDelete }: PlaylistCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const itemLabel = playlist.item_count === 1 ? '1 item' : `${playlist.item_count} items`;
  const subtitle = `${itemLabel} · ${formatPlaylistMinutes(playlist.total_duration_seconds)}`;

  return (
    <>
      <Pressable
        onPress={onPress}
        onLongPress={() => setConfirmingDelete(true)}
        accessibilityRole="button"
        accessibilityLabel={`${playlist.name}, ${subtitle}`}
        accessibilityActions={[{ name: 'delete', label: 'Delete' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'delete') onDelete();
        }}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {playlist.cover_url ? (
          <Image source={{ uri: playlist.cover_url }} style={styles.cover} />
        ) : (
          <View style={styles.coverFallback}>
            <PlatformIcon name="musical-note" size={22} color={colors.text.tertiary} />
          </View>
        )}
        <View style={styles.textBlock}>
          <AppText variant="ui.bodyLarge" numberOfLines={1}>
            {playlist.name}
          </AppText>
          <AppText variant="ui.body" tone="secondary" numberOfLines={1}>
            {subtitle}
          </AppText>
        </View>
      </Pressable>

      <ConfirmDialog
        visible={confirmingDelete}
        title="Delete this playlist?"
        body={`"${playlist.name}" and its ${itemLabel} will be removed. This can't be undone.`}
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

const COVER_SIZE = LIST_THUMBNAIL_SIZE;

const useStyles = createThemedStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  cover: {
    width: COVER_SIZE,
    height: COVER_SIZE,
    borderRadius: radius.md,
  },
  coverFallback: {
    width: COVER_SIZE,
    height: COVER_SIZE,
    borderRadius: radius.md,
    backgroundColor: colors.surface.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
}));
