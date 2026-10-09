import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText, CircularProgress, SwipeToDelete } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { scaledLineHeight } from '../../../theme/typography';
import type { DownloadRecord } from '../../../lib/downloads/types';

export interface DownloadRowProps {
  download: DownloadRecord;
  onPlay: (sermonId: string) => void;
  onRetry: (sermonId: string) => void;
  onDelete: (sermonId: string) => void;
}

// Isaac's ask, session 2026-10-09: "make each download item a little bigger" — scaled up
// from the original 96/28/14 trio (thumbnail/overlay chip/overlay icon), proportionally.
const THUMBNAIL_WIDTH = 128;
const OVERLAY_CHIP_SIZE = 36;
const OVERLAY_ICON_SIZE = 18;
const PROGRESS_RING_SIZE = 34;
const TITLE_FONT_SIZE = 17;

function formatBytes(bytes: number | null): string | null {
  if (bytes === null) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function metaLineFor(download: DownloadRecord): string {
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
 * The thumbnail *is* the tap target for that state's primary action; there's no longer a
 * separate play button on the row's right edge. Swipe left to delete (`SwipeToDelete`)
 * replaces the old persistent trash `IconButton` — see that component's own doc comment
 * for why, including the VoiceOver/TalkBack fallback it carries so this isn't swipe-only.
 */
export function DownloadRow({ download, onPlay, onRetry, onDelete }: DownloadRowProps) {
  const isReady = download.state === 'ready';
  const isFailed = download.state === 'failed';
  const isActive = download.state === 'queued' || download.state === 'downloading';
  const metaLine = metaLineFor(download);

  const handleThumbnailPress = () => {
    if (isReady) onPlay(download.sermonId);
    else if (isFailed) onRetry(download.sermonId);
  };

  const thumbnailAccessibilityLabel = isReady
    ? `Play ${download.title} offline`
    : isFailed
      ? `Retry download of ${download.title}`
      : download.title;

  return (
    <SwipeToDelete
      onDelete={() => onDelete(download.sermonId)}
      deleteAccessibilityLabel={`Delete downloaded ${download.title}`}
      testID={`download-row-${download.sermonId}`}
    >
      <View style={styles.row}>
        <Pressable
          onPress={handleThumbnailPress}
          disabled={isActive}
          accessibilityRole="button"
          accessibilityLabel={thumbnailAccessibilityLabel}
          style={styles.artWrap}
        >
          {download.thumbnailUrl ? (
            <Image source={{ uri: download.thumbnailUrl }} style={styles.thumbnail} resizeMode="cover" />
          ) : (
            <View style={styles.thumbnailFallback}>
              <Ionicons
                name={download.mediaType === 'video' ? 'videocam-outline' : 'musical-notes-outline'}
                size={26}
                color={colors.text.tertiary}
              />
            </View>
          )}
          <View style={styles.overlayWrap} pointerEvents="none">
            {isReady ? (
              <View style={styles.overlayChip}>
                <Ionicons name="play" size={OVERLAY_ICON_SIZE} color={colors.text.primary} />
              </View>
            ) : null}
            {isFailed ? (
              <View style={styles.overlayChip}>
                <Ionicons name="refresh" size={OVERLAY_ICON_SIZE} color={colors.status.rose.text} />
              </View>
            ) : null}
            {isActive ? (
              <CircularProgress
                progress={download.state === 'downloading' ? download.progress : 0}
                size={PROGRESS_RING_SIZE}
                strokeWidth={3}
                spinning
              >
                <Ionicons name="arrow-down" size={15} color={colors.text.secondary} />
              </CircularProgress>
            ) : null}
          </View>
        </Pressable>

        <View style={styles.textBlock}>
          <AppText variant="ui.bodyLarge" numberOfLines={2} style={styles.title}>
            {download.title}
          </AppText>
          <AppText variant="mono.tight" tone="tertiary" style={isFailed ? styles.failureText : undefined}>
            {metaLine}
          </AppText>
        </View>
      </View>
    </SwipeToDelete>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  artWrap: {
    width: THUMBNAIL_WIDTH,
  },
  thumbnail: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.sm,
  },
  thumbnailFallback: {
    width: '100%',
    aspectRatio: 16 / 9,
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
    gap: spacing.xs,
  },
  title: {
    fontSize: TITLE_FONT_SIZE,
    lineHeight: scaledLineHeight(TITLE_FONT_SIZE, 1.4),
  },
  failureText: {
    color: colors.status.rose.text,
  },
});
