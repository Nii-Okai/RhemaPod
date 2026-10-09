import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { AppText, Avatar, LinkButton, Sheet } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { useUpdateAvatar } from '../../../lib/query/hooks/useProfile';

export interface ProfileAvatarPickerProps {
  name: string;
  seed: string;
  avatarUrl: string | null;
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
 * Tap the Me page's own hero avatar to change it (Isaac's ask, session 2026-10-09:
 * "Allow to update profile picture") — an edit badge overlay signals it's interactive,
 * tapping opens a small `Sheet` offering Camera vs. Photo Library rather than
 * `expo-image-picker`'s own `launchCameraAsync`/`launchImageLibraryAsync` picked
 * blind, since a profile picture is about as likely to come from either source. Picking
 * an image hands its local URI straight to `useUpdateAvatar` (ticket → direct-to-storage
 * PUT → confirm); this component only owns the picker UI, not the upload mechanics.
 */
export function ProfileAvatarPicker({ name, seed, avatarUrl, size = 88 }: ProfileAvatarPickerProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateAvatar = useUpdateAvatar();

  const upload = (asset: ImagePicker.ImagePickerAsset) => {
    setError(null);
    const extension = guessExtension(asset.uri);
    updateAvatar.mutate(
      {
        uri: asset.uri,
        contentType: asset.mimeType ?? contentTypeFor(extension),
        filename: asset.fileName ?? `avatar.${extension}`,
      },
      {
        onError: () => setError("Couldn't update your photo. Try again."),
      },
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
        accessibilityLabel="Change profile picture"
        style={styles.wrap}
      >
        <Avatar name={name} seed={seed} size={size} imageUri={avatarUrl} />
        <View style={[styles.editBadge, { right: 0, bottom: 0 }]}>
          {updateAvatar.isPending ? (
            <ActivityIndicator size="small" color={colors.text.primary} />
          ) : (
            <Ionicons name="camera" size={14} color={colors.text.primary} />
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
          Profile picture
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          onPress={() => void pickFrom('camera')}
          style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
        >
          <Ionicons name="camera-outline" size={20} color={colors.text.primary} />
          <AppText variant="ui.bodyLarge">Take photo</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose from library"
          onPress={() => void pickFrom('library')}
          style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
        >
          <Ionicons name="images-outline" size={20} color={colors.text.primary} />
          <AppText variant="ui.bodyLarge">Choose from library</AppText>
        </Pressable>
        <View style={styles.cancel}>
          <LinkButton label="Cancel" onPress={() => setSheetOpen(false)} />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'flex-start',
  },
  editBadge: {
    position: 'absolute',
    width: 26,
    height: 26,
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
});
