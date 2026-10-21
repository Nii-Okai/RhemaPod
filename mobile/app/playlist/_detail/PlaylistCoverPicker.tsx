import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { AppText, LinkButton, PlatformIcon, Sheet } from '../../../components';
import { darkColors as onArt } from '../../../theme/colors';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { useUpdatePlaylistCover } from '../../../lib/query/hooks/usePlaylists';

export interface PlaylistCoverPickerProps {
  playlistId: string;
  coverUrl: string | null;
  size?: number;
}

function guessExtension(uri: string): string {
  const match = /\.([a-zA-Z0-9]+)(?:\?.*)?$/.exec(uri);
  return match ? match[1]!.toLowerCase() : 'jpg';
}

function contentTypeFor(extension: string): string {
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return 'image/jpeg';
}

/**
 * Playlist detail's cover art — tapping it opens a Camera/Photo Library sheet,
 * same shape `ProfileAvatarPicker` uses for the profile picture (session
 * 2026-10-09), square here instead of circular since a playlist cover is a
 * square tile everywhere it's shown (the Library tab's own `PlaylistCard`,
 * this header). No "Create cover art" collage generator (Isaac's call,
 * session 2026-10-10) — plain upload only, the same direct-to-storage
 * ticket -> PUT -> confirm pipeline every other image in this app uses.
 */
export function PlaylistCoverPicker({ playlistId, coverUrl, size = 160 }: PlaylistCoverPickerProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateCover = useUpdatePlaylistCover(playlistId);

  const upload = (asset: ImagePicker.ImagePickerAsset) => {
    setError(null);
    const extension = guessExtension(asset.uri);
    updateCover.mutate(
      {
        uri: asset.uri,
        contentType: asset.mimeType ?? contentTypeFor(extension),
        filename: asset.fileName ?? `cover.${extension}`,
      },
      { onError: () => setError("Couldn't update the cover. Try again.") },
    );
  };

  const pickFrom = async (source: 'camera' | 'library') => {
    setSheetOpen(false);
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(
        source === 'camera'
          ? 'Camera access is off. Enable it in Settings to take a photo.'
          : 'Photo access is off. Enable it in Settings to choose a photo.',
      );
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
          });
    if (result.canceled || result.assets.length === 0) return;
    upload(result.assets[0]!);
  };

  return (
    <>
      <Pressable
        onPress={() => setSheetOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Change playlist cover"
        style={[styles.wrap, { width: size, height: size }]}
      >
        {coverUrl ? (
          <Image source={{ uri: coverUrl }} style={[styles.cover, { width: size, height: size }]} />
        ) : (
          <View style={[styles.coverFallback, { width: size, height: size }]}>
            <PlatformIcon name="musical-note" size={size * 0.3} color={colors.text.tertiary} />
          </View>
        )}
        <View style={styles.editBadge}>
          {updateCover.isPending ? (
            <ActivityIndicator size="small" color={onArt.text.primary} />
          ) : (
            <PlatformIcon name="camera" size={14} color={onArt.text.primary} />
          )}
        </View>
      </Pressable>
      {error ? (
        <AppText variant="ui.badge" style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)}>
        <AppText variant="ui.label" tone="tertiary" accessibilityRole="header" style={styles.heading}>
          Playlist cover
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          onPress={() => void pickFrom('camera')}
          style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
        >
          <PlatformIcon name="camera-outline" size={20} color={colors.text.primary} />
          <AppText variant="ui.bodyLarge">Take photo</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose from library"
          onPress={() => void pickFrom('library')}
          style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
        >
          <PlatformIcon name="images-outline" size={20} color={colors.text.primary} />
          <AppText variant="ui.bodyLarge">Choose from library</AppText>
        </Pressable>
        <View style={styles.cancel}>
          <LinkButton label="Cancel" onPress={() => setSheetOpen(false)} />
        </View>
      </Sheet>
    </>
  );
}

const useStyles = createThemedStyles((colors) => ({
  wrap: {
    alignSelf: 'flex-start',
  },
  cover: {
    borderRadius: radius.md,
  },
  coverFallback: {
    borderRadius: radius.md,
    backgroundColor: colors.surface.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBadge: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay.chipFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.overlay.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: colors.status.rose.text,
    marginTop: spacing.xs,
  },
  heading: {
    textTransform: 'uppercase',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  optionPressed: {
    opacity: 0.7,
  },
  cancel: {
    alignItems: 'center',
  },
}));
