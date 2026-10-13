import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText, PlatformIcon } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { metaLineFor } from './sermonMeta';

/** Only the fields this row actually reads — a real `SermonListItem` satisfies
 * this structurally, but so does a mapped `DownloadRecord` (`AddToPlaylistSheet`'s
 * own Downloaded tab, Isaac's ask, session 2026-10-10), without needing to fake
 * the rest of `SermonListItem`'s shape (speaker/tier/locked/...) for content
 * that was never fetched from the catalog in the first place. */
export interface AddableSermon {
  id: string;
  title: string;
  thumbnail_url: string | null;
  series_title?: string | null;
  episode_number?: number | null;
  category_name?: string | null;
}

export interface SermonAddRowProps {
  sermon: AddableSermon;
  /** Shows a checkmark instead of "+" once set. Omitted entirely by
   * `[id].tsx`'s own Recommended section instead (an already-added sermon
   * is filtered out of that list rather than shown with a checkmark), so
   * this defaults to `false`. */
  alreadyAdded?: boolean;
  /** This sermon is on-device (`AddToPlaylistSheet`'s Sermons/Episodes tabs,
   * Isaac's ask, session 2026-10-10) — a small sage checkmark next to the
   * meta line, the same cue `DownloadRow`/`DownloadGridTile` already use for
   * "downloaded," distinct from `alreadyAdded`'s trailing-circle "already in
   * this playlist" (a sermon can be both, neither, or just one). */
  isDownloaded?: boolean;
  isAdding?: boolean;
  onAdd: () => void;
  /** Tapping the checkmark when `alreadyAdded` removes the item instead of
   * being a dead end (Isaac's ask, session 2026-10-10: "users should be able
   * to click on the checked icon to uncheck/remove item"). Optional — the
   * Recommended section never renders a row in the `alreadyAdded` state in
   * the first place (filtered out once added), so it has nothing to pass. */
  onRemove?: () => void;
}

const THUMBNAIL_SIZE = 44;
const BUTTON_SIZE = 32;

/** One sermon row with a trailing add affordance — shared by `AddToPlaylistSheet`'s
 * search results and `[id].tsx`'s own "Recommended sermons" list (Isaac's ask, session
 * 2026-10-10), same row shape both places rather than two near-identical copies.
 *
 * The add button is a thin-outline circle (not filled) — a filled gold chip (the first
 * version of this row) read as "too fancy" (Isaac's follow-up, same session); the
 * already-added state fills in `colors.status.sage` instead, the same green `DownloadRow`
 * already uses for its own "ready" checkmark, not a new color invented for this one spot.
 *
 * No inline preview on this thumbnail — tried once (session 2026-10-10), reverted the
 * next session (Isaac's own call): preview is a playlist-item affordance
 * (`PlaylistItemRow`'s own thumbnail) only, not a discovery/search-row one.
 */
export function SermonAddRow({
  sermon,
  alreadyAdded = false,
  isDownloaded = false,
  isAdding = false,
  onAdd,
  onRemove,
}: SermonAddRowProps) {
  const metaLine = metaLineFor(sermon);

  return (
    <Pressable
      onPress={() => (alreadyAdded ? onRemove?.() : onAdd())}
      accessibilityRole="button"
      accessibilityLabel={alreadyAdded ? `Remove ${sermon.title} from this playlist` : `Add ${sermon.title}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {sermon.thumbnail_url ? (
        <Image source={{ uri: sermon.thumbnail_url }} style={styles.thumbnail} resizeMode="cover" />
      ) : (
        <View style={styles.thumbnailFallback}>
          <PlatformIcon name="musical-notes-outline" size={18} color={colors.text.tertiary} />
        </View>
      )}
      <View style={styles.rowText}>
        <AppText variant="ui.bodyLarge" numberOfLines={1}>
          {sermon.title}
        </AppText>
        {metaLine || isDownloaded ? (
          <View style={styles.metaRow}>
            {isDownloaded ? (
              <PlatformIcon name="checkmark-circle" size={12} color={colors.status.sage.text} />
            ) : null}
            {metaLine ? (
              <AppText variant="ui.body" tone="secondary" numberOfLines={1}>
                {metaLine}
              </AppText>
            ) : null}
          </View>
        ) : null}
      </View>
      {alreadyAdded ? (
        <View style={styles.actionCircleDone}>
          <PlatformIcon name="checkmark" size={16} color={colors.status.sage.text} />
        </View>
      ) : isAdding ? (
        <View style={styles.actionCircle}>
          <ActivityIndicator size="small" color={colors.text.primary} />
        </View>
      ) : (
        <View style={styles.actionCircle}>
          <PlatformIcon name="add" size={18} color={colors.text.primary} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowPressed: {
    opacity: 0.7,
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
    backgroundColor: colors.surface.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  actionCircle: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCircleDone: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.status.sage.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
