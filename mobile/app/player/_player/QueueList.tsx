import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText, EqualizerBars, FittedArt, IconButton, PlatformIcon, Sheet, type AppIconName } from '../../../components';
import { darkColors as onArt } from '../../../theme/colors';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import type { QueueItem } from '../../../lib/playback/queue';

export interface QueueListProps {
  /** The playlist's or series' name, or "Up next". */
  title: string;
  /** A playlist's owner, with a lock when it's private. */
  ownerName?: string | null;
  isPublic?: boolean;
  /** The whole queue, played items included, in play order. */
  items: QueueItem[];
  currentIndex: number;
  repeatEnabled: boolean;
  onToggleRepeat: () => void;
  onShuffleRemaining: () => void;
  onClearUpcoming: () => void;
  onSelectItem: (index: number) => void;
  /** Moves a queued item to play straight after the current one. */
  onPlayNext: (key: string) => void;
  onRemoveFromQueue: (key: string) => void;
  /** Only while a playlist is playing, for its own rows. */
  onRemoveFromPlaylist?: (item: QueueItem) => void;
  onDownload: (item: QueueItem) => void;
  onShare: (item: QueueItem) => void;
  /** The episode autoplay will play once the queue runs out, when it's on. */
  autoplayNextTitle?: string | null;
  /** Whether the current item is actually playing — its visualiser moves only then. */
  isPlaying?: boolean;
}

const THUMBNAIL_SIZE = 44;

/**
 * The queue panel, under the player's title block (Queue / Comments switch). It lists the
 * whole queue in play order with the current item marked; tapping a row plays it. It was
 * first built for playlists only (Isaac's ask, session 2026-10-11) and since Nii's review
 * (2026-11-14) shows the app-wide queue, wherever playback started.
 *
 * Header: Repeat (loop back to the first item once the last one ends), Shuffle (the items
 * not played yet, in place) and Clear (everything after the current item). Each row's "..."
 * menu offers Play next and Remove from queue, plus Remove from playlist for a playing
 * playlist's own rows, Download and Share. When nothing is left and autoplay is on, the
 * foot of the list names the episode that comes next in the series.
 */
export function QueueList({
  title,
  ownerName,
  isPublic = true,
  items,
  currentIndex,
  isPlaying = false,
  repeatEnabled,
  onToggleRepeat,
  onShuffleRemaining,
  onClearUpcoming,
  onSelectItem,
  onPlayNext,
  onRemoveFromQueue,
  onRemoveFromPlaylist,
  onDownload,
  onShare,
  autoplayNextTitle,
}: QueueListProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [actionsFor, setActionsFor] = useState<{ item: QueueItem; index: number } | null>(null);
  const upcomingCount = Math.max(0, items.length - currentIndex - 1);

  const act = (run: () => void) => () => {
    run();
    setActionsFor(null);
  };

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <AppText variant="ui.bodyLarge" numberOfLines={1} style={styles.titleText}>
              {title}
            </AppText>
            {items.length > 1 ? (
              <AppText variant="ui.body" tone="tertiary">
                {`${Math.min(currentIndex + 1, items.length)}/${items.length}`}
              </AppText>
            ) : null}
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
            accessibilityState={{ selected: repeatEnabled }}
            hitSlop={spacing.sm}
            style={styles.headerIconButton}
          >
            <PlatformIcon name="repeat" size={20} color={repeatEnabled ? colors.accent.gold : colors.text.primary} />
          </Pressable>
          <IconButton icon="shuffle" accessibilityLabel="Shuffle the rest of this queue" onPress={onShuffleRemaining} size={20} />
          {upcomingCount > 0 ? (
            <IconButton icon="trash-outline" accessibilityLabel="Clear up next" onPress={onClearUpcoming} size={20} />
          ) : null}
        </View>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {items.map((item, index) => {
          const isCurrent = index === currentIndex;
          const metaLine = item.origin === 'user' ? ['Queued', item.meta].filter(Boolean).join(' · ') : item.origin === 'autoplay' ? ['Autoplay', item.meta].filter(Boolean).join(' · ') : item.meta;
          return (
            <Pressable
              key={item.key}
              onPress={() => onSelectItem(index)}
              accessibilityRole="button"
              accessibilityLabel={isCurrent ? `${item.title}, now playing` : `Play ${item.title}`}
              style={({ pressed }) => [styles.row, isCurrent && styles.rowCurrent, pressed && styles.rowPressed]}
            >
              <View style={styles.thumbnail}>
                {item.artworkUrl ? (
                  <FittedArt uri={item.artworkUrl} />
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
                  {item.title}
                </AppText>
                {metaLine ? (
                  <AppText variant="ui.body" tone="secondary" numberOfLines={1}>
                    {metaLine}
                  </AppText>
                ) : null}
              </View>
              <IconButton icon="ellipsis-horizontal" accessibilityLabel={`More options for ${item.title}`} onPress={() => setActionsFor({ item, index })} />
            </Pressable>
          );
        })}
        {upcomingCount === 0 ? (
          <View style={styles.footer} testID="queue-footer">
            <AppText variant="ui.body" tone="tertiary">
              {repeatEnabled && items.length > 1
                ? 'Repeat is on: the queue starts again from the top.'
                : autoplayNextTitle
                  ? `Autoplay is on. Next in the series: ${autoplayNextTitle}`
                  : 'Nothing else queued. Long-press any sermon to play it next or add it to the queue.'}
            </AppText>
          </View>
        ) : null}
      </ScrollView>

      <Sheet visible={actionsFor !== null} onClose={() => setActionsFor(null)}>
        {actionsFor ? (
          <>
            {actionsFor.index !== currentIndex ? (
              <>
                {actionsFor.index !== currentIndex + 1 ? (
                  <ActionRow icon="play-skip-forward-outline" label="Play next" onPress={act(() => onPlayNext(actionsFor.item.key))} />
                ) : null}
                <ActionRow icon="remove-circle-outline" label="Remove from queue" onPress={act(() => onRemoveFromQueue(actionsFor.item.key))} />
              </>
            ) : null}
            {onRemoveFromPlaylist && actionsFor.item.playlistItemId ? (
              <ActionRow icon="trash-outline" label="Remove from playlist" onPress={act(() => onRemoveFromPlaylist(actionsFor.item))} />
            ) : null}
            {actionsFor.item.mediaType ? (
              <ActionRow icon="download-outline" label="Download" onPress={act(() => onDownload(actionsFor.item))} />
            ) : null}
            <ActionRow icon="share-outline" label="Share" onPress={act(() => onShare(actionsFor.item))} />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

function ActionRow({ icon, label, onPress }: { icon: AppIconName; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed]}
    >
      <PlatformIcon name={icon} size={20} color={colors.text.primary} />
      <AppText variant="ui.bodyLarge">{label}</AppText>
    </Pressable>
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
  titleText: {
    flexShrink: 1,
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
  footer: {
    paddingVertical: spacing.md,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
}));
