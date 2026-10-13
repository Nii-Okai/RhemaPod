import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText, PlatformIcon, SwipeToDelete } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import type { PlaylistItemPublic } from '../../../lib/query/hooks/usePlaylists';
import { metaLineFor } from './sermonMeta';

export interface PlaylistItemRowProps {
  item: PlaylistItemPublic;
  onPress: () => void;
  onRemove: () => void;
  /** This item is the one currently previewing inline (`usePlaylistPreview`,
   * Isaac's ask, session 2026-10-10: play/pause without fully opening the
   * player). Only one row across the whole list is ever `true` at once. */
  isPreviewPlaying: boolean;
  isPreviewLoading: boolean;
  onTogglePreview: () => void;
}

const OVERLAY_CHIP_SIZE = 28;
const OVERLAY_ICON_SIZE = 14;

/** One sermon/episode row in a playlist's item list — thumbnail, title,
 * category-or-episode meta line (Isaac's ask, session 2026-10-10: drop
 * speaker name + duration, show category/episode instead, the same
 * `metaLineFor` `SermonAddRow` already computes). Tapping the row opens
 * that one sermon in the real Player screen (there is no playlist-queue/
 * autoplay-next feature here — see `[id].tsx`'s own doc comment for why
 * that's a deliberate cut, not an oversight). Swipe left to remove, same
 * `SwipeToDelete` chrome and VoiceOver/TalkBack `delete` accessibility
 * action `DownloadRow` already uses.
 *
 * The thumbnail carries its own play/pause overlay now (Isaac's ask, same
 * session — "remove play icon from playlist item and put on thumbnail,"
 * sound-only preview, not the full player), same chip-over-artwork chrome
 * `DownloadRow` already established; tapping it is a separate hit target
 * from the row's own `onPress`, so previewing never navigates away.
 */
export function PlaylistItemRow({
  item,
  onPress,
  onRemove,
  isPreviewPlaying,
  isPreviewLoading,
  onTogglePreview,
}: PlaylistItemRowProps) {
  const sermon = item.sermon;
  const metaLine = metaLineFor(sermon);

  return (
    <SwipeToDelete
      onDelete={onRemove}
      deleteAccessibilityLabel={`Remove ${sermon.title} from this playlist`}
      testID={`playlist-item-row-${item.id}`}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Play ${sermon.title}`}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.artWrap}>
          {sermon.thumbnail_url ? (
            <Image source={{ uri: sermon.thumbnail_url }} style={styles.thumbnail} resizeMode="cover" />
          ) : (
            <View style={styles.thumbnailFallback}>
              <PlatformIcon name="musical-notes-outline" size={20} color={colors.text.tertiary} />
            </View>
          )}
          <Pressable
            onPress={onTogglePreview}
            accessibilityRole="button"
            accessibilityLabel={isPreviewPlaying ? `Pause preview of ${sermon.title}` : `Preview ${sermon.title}`}
            style={styles.overlayWrap}
          >
            {isPreviewLoading ? (
              <View style={styles.overlayChip}>
                <ActivityIndicator size="small" color={colors.text.primary} />
              </View>
            ) : (
              <View style={styles.overlayChip}>
                <PlatformIcon name={isPreviewPlaying ? 'pause' : 'play'} size={OVERLAY_ICON_SIZE} color={colors.text.primary} />
              </View>
            )}
          </Pressable>
        </View>
        <View style={styles.textBlock}>
          <AppText variant="ui.bodyLarge" numberOfLines={1}>
            {sermon.title}
          </AppText>
          {metaLine ? (
            <AppText variant="mono.tight" tone="tertiary" numberOfLines={1}>
              {metaLine}
            </AppText>
          ) : null}
        </View>
      </Pressable>
    </SwipeToDelete>
  );
}

const THUMBNAIL_SIZE = 48;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  pressed: {
    opacity: 0.7,
  },
  artWrap: {
    width: THUMBNAIL_SIZE,
  },
  thumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    borderRadius: radius.sm,
  },
  thumbnailFallback: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    borderRadius: radius.sm,
    backgroundColor: colors.surface.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayChip: {
    width: OVERLAY_CHIP_SIZE,
    height: OVERLAY_CHIP_SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay.chipFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.overlay.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBlock: {
    flex: 1,
    gap: 2,
  },
});
