import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText, EqualizerBars, FittedArt, IconButton, PlatformIcon, Sheet } from '../../../components';
import { darkColors as onArt } from '../../../theme/colors';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { metaLineFor } from '../../playlist/_detail/sermonMeta';
import type { PlaylistItemPublic } from '../../../lib/query/hooks/usePlaylists';

export interface QueueListProps {
  playlistName: string;
  ownerName: string | null;
  isPublic: boolean;
  /** Already in queue order (the order `[id].tsx`'s Play/Shuffle queued, not necessarily
   * this playlist's own saved item order — see `PlayerScreen`'s own doc comment). */
  items: PlaylistItemPublic[];
  currentIndex: number;
  repeatEnabled: boolean;
  onToggleRepeat: () => void;
  onShuffleRemaining: () => void;
  onSelectItem: (sermonId: string, index: number) => void;
  onRemove: (itemId: string) => void;
  onDownload: (item: PlaylistItemPublic) => void;
  onShare: (item: PlaylistItemPublic) => void;
  /** Whether the current item is actually playing — its visualiser moves only then. */
  isPlaying?: boolean;
}

const THUMBNAIL_SIZE = 44;

/**
 * Replaces the comments panel when the Player was opened from a playlist's own Play/
 * Shuffle button (Isaac's ask, session 2026-10-11: "Do not open player page with
 * comments, rather open another page with all playlist items"). Sits in the exact spot
 * `CommentsPanel` otherwise fills, below the video/transport controls, which are
 * unchanged — this only swaps what's underneath them.
 *
 * Repeat (loop back to item 1 once the queue's own last item ends) and Shuffle
 * (re-shuffle whatever hasn't played yet, in place, leaving already-played items alone)
 * are real, wired into `PlayerScreen`'s own `queue`/`queueIndex`/`repeat` route params —
 * not the reference screenshot's static icon row. Tapping a row jumps playback to it
 * directly (`router.replace`, same mechanism auto-advance already uses — a different
 * sermon needs a fresh player instance, not just new props on the existing one).
 *
 * The per-row "..." menu is trimmed to what this app can actually back (Isaac's call
 * when asked): Download and Share (both existing actions elsewhere in the app) and
 * Remove from playlist (the same action the playlist page's own swipe-to-delete
 * already does). The reference's "Play next in queue" (no queue-priority-vs-playlist-
 * order concept exists) and "Save video to playlist" (these items are already in this
 * exact playlist) are left out — a menu row that does nothing is worse than one that
 * isn't there (`ActionButton`'s own Set Reminders/Rate precedent, invoked repeatedly
 * this session).
 */
export function QueueList({
  playlistName,
  ownerName,
  isPublic,
  items,
  currentIndex,
  isPlaying = false,
  repeatEnabled,
  onToggleRepeat,
  onShuffleRemaining,
  onSelectItem,
  onRemove,
  onDownload,
  onShare,
}: QueueListProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [actionsFor, setActionsFor] = useState<PlaylistItemPublic | null>(null);

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <AppText variant="ui.bodyLarge" numberOfLines={1}>
              {playlistName}
            </AppText>
            <AppText variant="ui.body" tone="tertiary">
              {`${Math.min(currentIndex + 1, items.length)}/${items.length}`}
            </AppText>
          </View>
          {ownerName ? (
            <View style={styles.ownerRow}>
              <AppText variant="ui.body" tone="secondary">
                {ownerName}
              </AppText>
              {!isPublic ? <PlatformIcon name="lock-closed-outline" size={12} color={colors.text.tertiary} /> : null}
            </View>
          ) : null}
        </View>
        <View style={styles.headerIcons}>
          {/* Plain `Pressable`, not `IconButton` — repeat needs a visually distinct "on"
              state (gold, matching this app's other active-state accent), and
              `IconButton` hardcodes its own icon color with no override. */}
          <Pressable
            onPress={onToggleRepeat}
            accessibilityRole="button"
            accessibilityLabel={repeatEnabled ? 'Turn off repeat' : 'Repeat this queue'}
            hitSlop={spacing.sm}
            style={styles.headerIconButton}
          >
            <PlatformIcon name="repeat" size={20} color={repeatEnabled ? colors.accent.gold : colors.text.primary} />
          </Pressable>
          <IconButton icon="shuffle" accessibilityLabel="Shuffle the rest of this queue" onPress={onShuffleRemaining} size={20} />
        </View>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {items.map((item, index) => {
          const isCurrent = index === currentIndex;
          const metaLine = metaLineFor(item.sermon);
          return (
            <Pressable
              key={item.id}
              onPress={() => onSelectItem(item.sermon.id, index)}
              accessibilityRole="button"
              accessibilityLabel={isCurrent ? `${item.sermon.title}, now playing` : `Play ${item.sermon.title}`}
              style={({ pressed }) => [styles.row, isCurrent && styles.rowCurrent, pressed && styles.rowPressed]}
            >
              <View style={styles.thumbnail}>
                {item.sermon.thumbnail_url ? (
                  <FittedArt uri={item.sermon.thumbnail_url} />
                ) : isCurrent ? null : (
                  <PlatformIcon name="musical-notes-outline" size={18} color={colors.text.tertiary} />
                )}
                {isCurrent ? (
                  <View style={styles.nowPlaying} testID="queue-now-playing">
                    <EqualizerBars active={isPlaying} color={onArt.accent.goldText} size={16} />
                  </View>
                ) : null}
              </View>
              <View style={styles.rowText}>
                <AppText variant="ui.bodyLarge" numberOfLines={1} tone={isCurrent ? 'gold' : 'primary'}>
                  {item.sermon.title}
                </AppText>
                {metaLine ? (
                  <AppText variant="ui.body" tone="secondary" numberOfLines={1}>
                    {metaLine}
                  </AppText>
                ) : null}
              </View>
              <IconButton icon="ellipsis-horizontal" accessibilityLabel={`More options for ${item.sermon.title}`} onPress={() => setActionsFor(item)} />
            </Pressable>
          );
        })}
      </ScrollView>

      <Sheet visible={actionsFor !== null} onClose={() => setActionsFor(null)}>
        {actionsFor ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Download"
              onPress={() => {
                onDownload(actionsFor);
                setActionsFor(null);
              }}
              style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed]}
            >
              <PlatformIcon name="download-outline" size={20} color={colors.text.primary} />
              <AppText variant="ui.bodyLarge">Download</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove from playlist"
              onPress={() => {
                onRemove(actionsFor.id);
                setActionsFor(null);
              }}
              style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed]}
            >
              <PlatformIcon name="remove-circle-outline" size={20} color={colors.text.primary} />
              <AppText variant="ui.bodyLarge">Remove from playlist</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share"
              onPress={() => {
                onShare(actionsFor);
                setActionsFor(null);
              }}
              style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed]}
            >
              <PlatformIcon name="share-outline" size={20} color={colors.text.primary} />
              <AppText variant="ui.bodyLarge">Share</AppText>
            </Pressable>
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  panel: {
    flex: 1,
    backgroundColor: colors.surface.raised,
    borderColor: colors.border.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerIconButton: {
    padding: spacing.sm,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  rowCurrent: {
    backgroundColor: colors.surface.sunken,
    paddingHorizontal: spacing.sm,
  },
  rowPressed: {
    opacity: 0.7,
  },
  thumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The art dims behind the bars so they read on any cover; dark in both themes.
  nowPlaying: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: onArt.overlay.chipFill,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
}));
