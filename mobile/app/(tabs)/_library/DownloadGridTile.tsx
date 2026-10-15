import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText, CircularProgress, ConfirmDialog, PlatformIcon } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import type { DownloadRecord } from '../../../lib/downloads/types';

export interface DownloadGridTileProps {
  download: DownloadRecord;
  width: number;
  onPlay: (sermonId: string) => void;
  onRetry: (sermonId: string) => void;
  onDelete: (sermonId: string) => void;
}

const BADGE_SIZE = 24;
const BADGE_ICON_SIZE = 12;
const PROGRESS_RING_SIZE = 22;

/** Grid-mode variant of `DownloadRow` (Isaac's ask, session 2026-10-10) —
 * same square-cover-plus-title shape as `PlaylistGridTile`, with the
 * download's state (ready/failed/active) as a small corner badge instead of
 * the list row's full-size centered overlay — there's no room in a dense
 * grid tile for that without crowding out the cover art itself.
 *
 * A horizontal swipe gesture doesn't read as "delete" in a grid (it'd fight
 * the grid's own scroll and look like a drag), so this swaps `SwipeToDelete`
 * for a long-press -> confirm, same `ConfirmDialog` Delete/Block already
 * uses elsewhere. VoiceOver/TalkBack still reach it without the gesture at
 * all, via the same `accessibilityActions` "Delete" entry `SwipeToDelete`
 * exposes — parity, not a downgrade, for screen-reader users. */
export function DownloadGridTile({ download, width, onPlay, onRetry, onDelete }: DownloadGridTileProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isReady = download.state === 'ready';
  const isFailed = download.state === 'failed';
  const isActive = download.state === 'queued' || download.state === 'downloading';

  const handlePress = () => {
    if (isReady) onPlay(download.sermonId);
    else if (isFailed) onRetry(download.sermonId);
  };

  const accessibilityLabel = isReady
    ? `Play ${download.title} offline`
    : isFailed
      ? `Retry download of ${download.title}`
      : download.title;

  return (
    <>
      <Pressable
        onPress={handlePress}
        onLongPress={() => setConfirmingDelete(true)}
        disabled={isActive}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityActions={[{ name: 'delete', label: 'Delete' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'delete') onDelete(download.sermonId);
        }}
        style={({ pressed }) => [{ width }, pressed && styles.pressed]}
      >
        <View style={{ width, height: width }}>
          {download.thumbnailPath ?? download.thumbnailUrl ? (
            <Image source={{ uri: download.thumbnailPath ?? download.thumbnailUrl ?? undefined }} style={[styles.cover, { width, height: width }]} />
          ) : (
            <View style={[styles.coverFallback, { width, height: width }]}>
              <PlatformIcon
                name={download.mediaType === 'video' ? 'videocam-outline' : 'musical-notes-outline'}
                size={width * 0.3}
                color={colors.text.tertiary}
              />
            </View>
          )}
          <View style={styles.badgeAnchor}>
            {isReady ? (
              // Sage checkmark, not the list row's own trailing icon — this grid tile
              // had a "play" icon here before (Isaac's ask, session 2026-10-10: show the
              // same "downloaded" cue grid-side that `DownloadRow`'s list view already
              // has), but tapping the tile already plays it regardless of this badge, so
              // "downloaded" is the more useful thing to communicate at a glance than
              // "tappable" (every tile already is).
              <View style={styles.badge}>
                <PlatformIcon name="checkmark-circle" size={BADGE_ICON_SIZE} color={colors.status.sage.text} />
              </View>
            ) : isFailed ? (
              <View style={styles.badge}>
                <PlatformIcon name="refresh" size={BADGE_ICON_SIZE} color={colors.status.rose.text} />
              </View>
            ) : isActive ? (
              <CircularProgress
                progress={download.state === 'downloading' ? download.progress : 0}
                size={PROGRESS_RING_SIZE}
                strokeWidth={2}
                spinning
              >
                <PlatformIcon name="arrow-down" size={10} color={colors.text.secondary} />
              </CircularProgress>
            ) : null}
          </View>
        </View>
        <AppText variant="ui.body" numberOfLines={2} style={styles.title}>
          {download.title}
        </AppText>
      </Pressable>

      <ConfirmDialog
        visible={confirmingDelete}
        title="Delete this download?"
        body={`"${download.title}" will be removed from this device.`}
        confirmLabel="Delete"
        onConfirm={() => {
          setConfirmingDelete(false);
          onDelete(download.sermonId);
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  cover: {
    borderRadius: radius.md,
  },
  coverFallback: {
    borderRadius: radius.md,
    backgroundColor: colors.surface.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeAnchor: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
  },
  badge: {
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.overlay.chipFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.overlay.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: spacing.sm,
  },
});
