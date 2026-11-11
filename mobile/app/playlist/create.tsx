import React, { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, PrimaryButton } from '../../components';
import { PlaylistCover } from '../(tabs)/_library/signature/PlaylistCover';
import { createThemedStyles, useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/spacing';
import { fontFamily } from '../../theme/typography';
import { useCreatePlaylist, usePlaylists } from '../../lib/query/hooks/usePlaylists';

const NAME_MAX = 100;

/**
 * Daybreak redesign (canvas E3): Cancel and "New playlist" across the top, a large
 * preview of the cover the playlist starts with, the name in Fraunces over a blue
 * underline, and a full-width Create at the foot.
 *
 * "Give your playlist a name" -> Create (Isaac's screenshots), a full-screen
 * modal registered with `presentation: 'modal'` in `_layout.tsx` — the
 * reference's own dark full-bleed takeover, not a bottom sheet. The
 * suggested default name counts the caller's existing playlists, same
 * "My Playlist #N" convention Spotify's own screenshot shows. On success,
 * replaces this modal route with the new playlist's detail screen (`router.
 * replace`, not `push`) so backing out of the detail screen returns to
 * Library, not to this now-pointless create screen.
 */
export default function CreatePlaylistScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const existing = usePlaylists();
  const createPlaylist = useCreatePlaylist();
  const suggested = `My Playlist #${(existing.data?.length ?? 0) + 1}`;
  const [name, setName] = useState(suggested);
  // `usePlaylists()` resolves after this component's first render — `name`'s own
  // `useState(suggested)` initializer only runs once, so without this it would stay
  // pinned at the pre-load guess ("#1") even once the real count comes in. Only
  // re-syncs while the field is still untouched, so a user who's already started
  // typing never gets overwritten by a suggestion arriving late.
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!touched) setName(suggested);
  }, [suggested, touched]);

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give your playlist a name.');
      return;
    }
    setError(null);
    createPlaylist.mutate(
      { name: trimmed },
      {
        onSuccess: (playlist) => {
          router.replace({ pathname: '/playlist/[id]', params: { id: playlist.id } });
        },
        onError: () => setError("Couldn't create your playlist. Try again."),
      },
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={spacing.sm}
          style={styles.cancel}
        >
          <AppText variant="ui.bodyBold">Cancel</AppText>
        </Pressable>
        <AppText variant="ui.bodyBold" accessibilityRole="header">
          New playlist
        </AppText>
        <View style={styles.cancelSpacer} />
      </View>

      <View style={styles.center}>
        {/* A preview of the cover the new playlist starts with (canvas E3). */}
        <View style={styles.coverShadow}>
          <PlaylistCover name={name.trim() || suggested} coverUrl={null} size={COVER} shape={COVER_SHAPE} />
        </View>
        <View style={styles.nameBlock}>
          <AppText variant="ui.badge" tone="tertiary" style={styles.prompt}>
            GIVE YOUR PLAYLIST A NAME
          </AppText>
          <TextInput
            value={name}
            onChangeText={(text) => {
              setTouched(true);
              setName(text);
            }}
            maxLength={NAME_MAX}
            autoFocus
            selectTextOnFocus
            placeholder={suggested}
            placeholderTextColor={colors.text.tertiary}
            selectionColor={colors.iris.fill}
            style={styles.input}
            accessibilityLabel="Playlist name"
            returnKeyType="done"
            onSubmitEditing={create}
          />
          {error ? (
            <AppText variant="ui.badge" style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </AppText>
          ) : null}
        </View>
      </View>

      <PrimaryButton label="Create" onPress={create} loading={createPlaylist.isPending} fullWidth />
    </View>
  );
}

const COVER = 200;
const COVER_SHAPE = { borderRadius: 32, overflow: 'hidden' as const };

const useStyles = createThemedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
    paddingHorizontal: spacing.lg + 4,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cancel: {
    minWidth: 60,
    paddingVertical: spacing.md,
  },
  cancelSpacer: {
    width: 60,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl + 2,
  },
  coverShadow: {
    borderRadius: 32,
    backgroundColor: colors.surface.sunken,
    shadowColor: colors.shadow.card,
    shadowOpacity: 1,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 20 },
    elevation: 10,
  },
  nameBlock: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  prompt: {
    textAlign: 'center',
    letterSpacing: 1.5,
  },
  input: {
    alignSelf: 'stretch',
    fontFamily: fontFamily.display,
    fontSize: 32,
    color: colors.text.primary,
    textAlign: 'center',
    borderBottomWidth: 2,
    borderBottomColor: colors.iris.fill,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm + 2,
  },
  error: {
    color: colors.status.rose.text,
  },
}));
