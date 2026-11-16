import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, PlatformIcon, PrimaryButton, Toggle } from '../../components';
import {
  PLAYLIST_COVER_COLORS,
  PlaylistCover,
  type PlaylistCoverColor,
} from '../(tabs)/_library/signature/PlaylistCover';
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
  // New playlists start private, as the server already defaults them (canvas E3).
  const [isPrivate, setIsPrivate] = useState(true);
  const [coverColor, setCoverColor] = useState<PlaylistCoverColor>('navy');

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
      { name: trimmed, isPublic: !isPrivate, coverColor },
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

      {/* Scrolls when the keyboard is up on a shorter phone. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.center}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* A preview of the cover the new playlist starts with (canvas E3). */}
        <View style={styles.coverShadow}>
          <PlaylistCover
            name={name.trim() || suggested}
            coverUrl={null}
            color={coverColor}
            size={COVER}
            shape={COVER_SHAPE}
          />
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
        <View style={styles.colorBlock}>
          <AppText variant="ui.badge" tone="tertiary" style={styles.prompt}>
            COVER COLOUR
          </AppText>
          <View style={styles.swatches} accessibilityRole="radiogroup">
            {PLAYLIST_COVER_COLORS.map((option) => {
              const on = option === coverColor;
              return (
                <Pressable
                  key={option}
                  onPress={() => setCoverColor(option)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${option} cover`}
                  hitSlop={4}
                  style={[styles.swatchRing, on && styles.swatchRingOn]}
                >
                  <View style={[styles.swatch, { backgroundColor: colors.playlistCover[option].bg }]} />
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={styles.privacyRow}>
          <PlatformIcon name="lock-closed-outline" size={20} color={colors.text.secondary} />
          <View style={styles.privacyText}>
            <AppText variant="ui.bodyBold">Private</AppText>
            <AppText variant="ui.badge" tone="tertiary">
              {isPrivate ? 'Only you can see it until you share' : 'Anyone with the link can see it'}
            </AppText>
          </View>
          <Toggle value={isPrivate} onValueChange={setIsPrivate} accessibilityLabel="Private" />
        </View>
      </ScrollView>

      <PrimaryButton label="Create" onPress={create} loading={createPlaylist.isPending} fullWidth />
    </View>
  );
}

const COVER = 168;
const COVER_SHAPE = { borderRadius: 32, overflow: 'hidden' as const };

const useStyles = createThemedStyles((colors) => ({
  colorBlock: {
    alignSelf: 'stretch',
    gap: spacing.sm + 2,
  },
  swatches: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // A ring in the page colour then one in ink marks the chosen swatch.
  swatchRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchRingOn: {
    borderColor: colors.text.primary,
  },
  swatch: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  privacyRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    borderRadius: 18,
    backgroundColor: colors.surface.sunken,
  },
  privacyText: {
    flex: 1,
    gap: 2,
  },
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
  scroll: {
    flex: 1,
  },
  center: {
    flexGrow: 1,
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
