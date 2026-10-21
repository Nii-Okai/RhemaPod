import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, PlatformIcon, PrimaryButton } from '../../components';
import { createThemedStyles, useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/spacing';
import { fontFamily } from '../../theme/typography';
import { useCreatePlaylist, usePlaylists } from '../../lib/query/hooks/usePlaylists';

const NAME_MAX = 100;

/**
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
    <View style={[styles.screen, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Close"
        hitSlop={spacing.sm}
        style={styles.close}
      >
        <PlatformIcon name="close" size={26} color={colors.text.primary} />
      </Pressable>

      <View style={styles.center}>
        <AppText variant="ui.bodyLarge" tone="secondary" style={styles.prompt}>
          Give your playlist a name
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

        <View style={styles.createButton}>
          <PrimaryButton label="Create" onPress={create} loading={createPlaylist.isPending} />
        </View>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
    paddingHorizontal: spacing.lg,
  },
  close: {
    alignSelf: 'flex-end',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  prompt: {
    textAlign: 'center',
  },
  input: {
    fontFamily: fontFamily.uiBold,
    fontSize: 28,
    color: colors.text.primary,
    textAlign: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.card,
    paddingVertical: spacing.sm,
    minWidth: 200,
  },
  error: {
    color: colors.status.rose.text,
  },
  createButton: {
    marginTop: spacing.lg,
  },
}));
