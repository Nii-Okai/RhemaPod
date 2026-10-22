import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText, CircularProgress, ConfirmDialog, PlatformIcon } from '../../../components';
import { darkColors as onArt } from '../../../theme/colors';
import { createThemedStyles, useTheme } from '../../../theme/ThemeContext';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import type { DownloadRecord } from '../../../lib/downloads/types';
import { LIST_THUMBNAIL_SIZE } from '../_library/libraryLayout';

export interface DownloadRowProps {
  download: DownloadRecord;
  onPlay: (sermonId: string) => void;
  onRetry: (sermonId: string) => void;
  onDelete: (sermonId: string) => void;
}

// A square thumbnail at `LIST_THUMBNAIL_SIZE`, matching `PlaylistCard` (Isaac's ask,
// session 2026-10-10: "Playlist and download list items should match size") — was a
// wider 16:9 rectangle before. Overlay chip/icon/ring sized down to fit the smaller
// square rather than scaled by a literal ratio, which would've made them too small to
// read or tap comfortably.
const OVERLAY_CHIP_SIZE = 28;
const OVERLAY_ICON_SIZE = 14;
const PROGRESS_RING_SIZE = 26;

function formatBytes(bytes: number | null): string | null {
  if (bytes === null) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function metaLineFor(download: DownloadRecord): string {
  if (download.state === 'failed') return download.failureMessage ?? 'Download failed.';
  if (download.state === 'downloading') return `Downloading… ${Math.round(download.progress * 100)}%`;
  if (download.state === 'queued') return 'Queued';
  // ready — category replaces the old generic "Downloaded" label (Isaac's ask, session
  // 2026-10-09), size stays alongside it; a sermon with no category on file just shows
  // the size alone rather than a fabricated one.
  const size = formatBytes(download.bytesTotal);
  const parts = [download.category, size].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : 'Downloaded';
}

/** One row per sermon in the Downloads list (redesigned, Isaac's ask, session 2026-10-09:
 * a real thumbnail with the state's action overlaid on it — play when ready, retry when
 * failed, the same `CircularProgress` ring every other download control in the app uses
 * while active — in place of the old generic title+"Downloaded"+right-side icon layout.
 * The thumbnail *is* the tap target for that state's primary action.
 *
 * A small gold checkmark precedes the category text once the download is `ready` (Isaac's
 * ask, session 2026-10-10: "add a downloaded checked icon before category ... to show the
 * difference") — now that playlist and download rows are visually unified in one list with
 * no section header, this is the one thing that marks a row as a download rather than a
 * playlist. It's gated on `isReady` specifically, not just "is a download": a downloading/
 * queued/failed row's meta line is a status message, not a category, so a checkmark there
 * would read as "this finished" when it hasn't.
 *
 * Long-press anywhere on the row opens a delete confirm (same session — replaces
 * `SwipeToDelete`, which doesn't fit this screen's now-interleaved list/grid as cleanly as
 * one consistent long-press gesture across every row and grid tile does). The whole row is
 * one `Pressable` rather than a separate thumbnail-Pressable-inside-a-row (the swipe
 * wrapper's old shape) specifically so long-press and short-press share one hit target.
 * `onLongPress` fires regardless of download state — an in-progress download can still be
 * deleted (cancelled) this way, so only the *short*-press play/retry action is gated on
 * `isActive`, inside the handler itself rather than via the `Pressable`'s own `disabled`
 * (which would have silently blocked `onLongPress` too). VoiceOver/TalkBack reach delete
 * without the gesture at all, via the same `accessibilityActions` entry `SwipeToDelete`
 * used to expose — parity, not a downgrade, for screen-reader users.
 */
export function DownloadRow({ download, onPlay, onRetry, onDelete }: DownloadRowProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isReady = download.state === 'ready';
  const isFailed = download.state === 'failed';
  const isActive = download.state === 'queued' || download.state === 'downloading';
  const metaLine = metaLineFor(download);

  const handlePress = () => {
    if (isActive) return;
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
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityActions={[{ name: 'delete', label: 'Delete' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'delete') onDelete(download.sermonId);
        }}
        testID={`download-row-${download.sermonId}`}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.artWrap}>
          {download.thumbnailPath ?? download.thumbnailUrl ? (
            <Image source={{ uri: download.thumbnailPath ?? download.thumbnailUrl ?? undefined }} style={styles.thumbnail} resizeMode="cover" />
          ) : (
            <View style={styles.thumbnailFallback}>
              <PlatformIcon
                name={download.mediaType === 'video' ? 'videocam-outline' : 'musical-notes-outline'}
                size={22}
                color={colors.text.tertiary}
              />
            </View>
          )}
          <View style={styles.overlayWrap} pointerEvents="none">
            {isReady ? (
              <View style={styles.overlayChip}>
                <PlatformIcon name="play" size={OVERLAY_ICON_SIZE} color={onArt.text.primary} />
              </View>
            ) : null}
            {isFailed ? (
              <View style={styles.overlayChip}>
                <PlatformIcon name="refresh" size={OVERLAY_ICON_SIZE} color={onArt.status.rose.text} />
              </View>
            ) : null}
            {isActive ? (
              <CircularProgress
                progress={download.state === 'downloading' ? download.progress : 0}
                size={PROGRESS_RING_SIZE}
                strokeWidth={2.5}
                trackColor={onArt.track.default}
                fillColor={onArt.accent.gold}
                spinning
              >
                <PlatformIcon name="arrow-down" size={12} color={onArt.text.secondary} />
              </CircularProgress>
            ) : null}
          </View>
        </View>

        <View style={styles.textBlock}>
          <AppText variant="ui.bodyLarge" numberOfLines={1}>
            {download.title}
          </AppText>
          <View style={styles.metaRow}>
            {isReady ? (
              <PlatformIcon
                name="checkmark-circle"
                size={12}
                color={colors.status.sage.text}
                testID="download-ready-checkmark"
              />
            ) : null}
            <AppText variant="mono.tight" tone="tertiary" style={isFailed ? styles.failureText : undefined}>
              {metaLine}
            </AppText>
          </View>
        </View>
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

const useStyles = createThemedStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  artWrap: {
    width: LIST_THUMBNAIL_SIZE,
  },
  thumbnail: {
    width: LIST_THUMBNAIL_SIZE,
    height: LIST_THUMBNAIL_SIZE,
    borderRadius: radius.md,
  },
  thumbnailFallback: {
    width: LIST_THUMBNAIL_SIZE,
    height: LIST_THUMBNAIL_SIZE,
    borderRadius: radius.md,
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  failureText: {
    color: colors.status.rose.text,
  },
}));
