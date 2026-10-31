import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';
import { AppText, ConfirmDialog, PlatformIcon, PrimaryButton, Sheet } from '../../../components';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { fontFamily } from '../../../theme/typography';
import { ApiError, userMessageFor } from '../../../lib/api/errors';
import { useDeletePlaylist, useUpdatePlaylist, type PlaylistDetail } from '../../../lib/query/hooks/usePlaylists';
import { useMakePlaylistPublic } from './useMakePlaylistPublic';

export interface PlaylistDetailsSheetProps {
  visible: boolean;
  onClose: () => void;
  playlist: PlaylistDetail;
  /** Fired after the playlist is actually deleted — the caller navigates away. */
  onDeleted: () => void;
}

const NAME_MAX = 100;
const DESCRIPTION_MAX = 300;

/**
 * "Name & details" (Isaac's screenshots: rename, description, Make private/
 * public, Delete playlist, all in one sheet) — the playlist-domain sibling of
 * `ProfileDetailsSheet`. Saves on close rather than per-keystroke: the name/
 * description fields are local state until "Save", `is_public` toggles
 * immediately since it's a single tap with no text to debounce.
 */
export function PlaylistDetailsSheet({ visible, onClose, playlist, onDeleted }: PlaylistDetailsSheetProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = useUpdatePlaylist(playlist.id);
  const remove = useDeletePlaylist();
  const makePublic = useMakePlaylistPublic(playlist.id);

  useEffect(() => {
    if (visible) {
      setName(playlist.name);
      setDescription(playlist.description ?? '');
      setError(null);
    }
  }, [visible, playlist.name, playlist.description]);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give your playlist a name.');
      return;
    }
    setError(null);
    update.mutate(
      { name: trimmed, description },
      {
        onSuccess: onClose,
        onError: (e) => setError(e instanceof ApiError && e.status === 422 ? userMessageFor(e) : "Couldn't save. Try again."),
      },
    );
  };

  // Public -> private needs no prompt; private -> public goes through the same confirmation
  // as Share (the toggle just updates, it doesn't open the share sheet).
  const togglePrivacy = () => {
    setError(null);
    if (playlist.is_public) {
      update.mutate(
        { isPublic: false },
        {
          onError: (e) =>
            setError(
              e instanceof ApiError && e.status === 422 ? userMessageFor(e) : "Couldn't make this playlist private. Try again.",
            ),
        },
      );
      return;
    }
    makePublic.confirmAndMakePublic({ onFailure: setError });
  };
  const privacyBusy = update.isPending || makePublic.busy || (!playlist.is_public && !makePublic.ready);

  const confirmDelete = () => {
    setConfirmingDelete(false);
    remove.mutate(playlist.id, { onSuccess: onDeleted });
  };

  return (
    <>
      <Sheet visible={visible} onClose={onClose}>
        <AppText variant="ui.label" tone="tertiary" accessibilityRole="header" style={styles.heading}>
          Name & details
        </AppText>
        <TextInput
          value={name}
          onChangeText={setName}
          maxLength={NAME_MAX}
          placeholder="Playlist name"
          placeholderTextColor={colors.text.tertiary}
          style={styles.nameInput}
          accessibilityLabel="Playlist name"
        />
        <TextInput
          value={description}
          onChangeText={setDescription}
          maxLength={DESCRIPTION_MAX}
          placeholder="Add description"
          placeholderTextColor={colors.text.tertiary}
          multiline
          style={styles.descriptionInput}
          accessibilityLabel="Playlist description"
        />
        {error ? (
          <AppText variant="ui.badge" style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </AppText>
        ) : null}

        <PrimaryButton label="Save" onPress={save} loading={update.isPending} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playlist.is_public ? 'Make private' : 'Make public'}
          onPress={togglePrivacy}
          disabled={privacyBusy}
          accessibilityState={{ disabled: privacyBusy }}
          style={({ pressed }) => [styles.row, (pressed || privacyBusy) && styles.rowPressed]}
        >
          <PlatformIcon
            name={playlist.is_public ? 'lock-closed-outline' : 'globe-outline'}
            size={20}
            color={colors.text.primary}
          />
          <AppText variant="ui.bodyLarge">{playlist.is_public ? 'Make private' : 'Make public'}</AppText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete playlist"
          onPress={() => setConfirmingDelete(true)}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <PlatformIcon name="trash-outline" size={20} color={colors.status.rose.text} />
          <AppText variant="ui.bodyLarge" style={styles.deleteText}>
            Delete playlist
          </AppText>
        </Pressable>
      </Sheet>

      <ConfirmDialog
        visible={confirmingDelete}
        title="Delete this playlist?"
        body={`"${playlist.name}" and its ${playlist.item_count === 1 ? '1 item' : `${playlist.item_count} items`} will be removed. This can't be undone.`}
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}

const useStyles = createThemedStyles((colors) => ({
  heading: {
    textTransform: 'uppercase',
  },
  nameInput: {
    fontFamily: fontFamily.uiBold,
    fontSize: 17,
    color: colors.text.primary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.card,
    paddingVertical: spacing.sm,
  },
  descriptionInput: {
    fontFamily: fontFamily.ui,
    fontSize: 15,
    color: colors.text.primary,
    minHeight: 60,
    textAlignVertical: 'top',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.card,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  error: {
    color: colors.status.rose.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  rowPressed: {
    opacity: 0.7,
  },
  deleteText: {
    color: colors.status.rose.text,
  },
}));
