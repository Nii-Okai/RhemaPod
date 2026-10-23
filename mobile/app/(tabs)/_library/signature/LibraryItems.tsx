import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, CircularProgress, ConfirmDialog, FittedArt, PlatformIcon, PressableScale } from '../../../../components';
import { darkColors as onArt } from '../../../../theme/colors';
import { createThemedStyles, useTheme } from '../../../../theme/ThemeContext';
import { radius } from '../../../../theme/radius';
import { spacing } from '../../../../theme/spacing';
import { fontFamily } from '../../../../theme/typography';
import { formatPlaylistMinutes } from '../../../../lib/format/playlistDuration';
import type { DownloadRecord } from '../../../../lib/downloads/types';
import type { PlaylistPublic } from '../../../../lib/query/hooks/usePlaylists';
import { metaLineFor as downloadMetaLine } from '../../_downloads/DownloadRow';
import { LEAF_SM, leaf } from '../../_home/signature/leaf';
import { PlaylistCover } from './PlaylistCover';

export const ROW_ART_SIZE = 64;
const ROW_LEAF = leaf(12, 3);

/** Long-press (or the screen reader's Delete action) opens a confirm; same contract as the classic rows. */
function useDeleteConfirm() {
  const [open, setOpen] = useState(false);
  return {
    open,
    ask: () => setOpen(true),
    close: () => setOpen(false),
    a11y: (onDelete: () => void) => ({
      accessibilityActions: [{ name: 'delete', label: 'Delete' }],
      onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => {
        if (event.nativeEvent.actionName === 'delete') onDelete();
      },
    }),
  };
}

function playlistMeta(playlist: PlaylistPublic): { items: string; full: string } {
  const items = playlist.item_count === 1 ? '1 item' : `${playlist.item_count} items`;
  return { items, full: `${items} · ${formatPlaylistMinutes(playlist.total_duration_seconds)}` };
}

function downloadState(download: DownloadRecord) {
  const isReady = download.state === 'ready';
  const isFailed = download.state === 'failed';
  const isActive = download.state === 'queued' || download.state === 'downloading';
  const label = isReady ? `Play ${download.title} offline` : isFailed ? `Retry download of ${download.title}` : download.title;
  return { isReady, isFailed, isActive, label };
}

function DownloadArt({ download, style }: { download: DownloadRecord; style: object }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const uri = download.thumbnailPath ?? download.thumbnailUrl;
  return (
    <View style={[styles.art, style]}>
      {uri ? (
        <FittedArt uri={uri} />
      ) : (
        <PlatformIcon
          name={download.mediaType === 'video' ? 'videocam-outline' : 'musical-notes-outline'}
          size={22}
          color={colors.text.tertiary}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------- list rows

interface RowShellProps {
  art: React.ReactNode;
  title: string;
  meta: React.ReactNode;
  trailing: React.ReactNode;
  onPress: () => void;
  onLongPress: () => void;
  accessibilityLabel: string;
  a11yActions: object;
  testID?: string;
}

function RowShell({ art, title, meta, trailing, onPress, onLongPress, accessibilityLabel, a11yActions, testID }: RowShellProps) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      {...a11yActions}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {art}
      <View style={styles.rowText}>
        <AppText variant="ui.bodyLarge" numberOfLines={1} style={styles.rowTitle}>
          {title}
        </AppText>
        <View style={styles.metaRow}>{meta}</View>
      </View>
      <View style={styles.trailing}>{trailing}</View>
    </Pressable>
  );
}

export function PlaylistListRow({ playlist, onPress, onDelete }: { playlist: PlaylistPublic; onPress: () => void; onDelete: () => void }) {
  const { colors } = useTheme();
  const confirm = useDeleteConfirm();
  const meta = playlistMeta(playlist);
  return (
    <>
      <RowShell
        art={<PlaylistCover name={playlist.name} coverUrl={playlist.cover_url} size={ROW_ART_SIZE} shape={ROW_LEAF} />}
        title={playlist.name}
        meta={
          <AppText variant="mono.meta" tone="tertiary" numberOfLines={1}>
            {`PLAYLIST · ${meta.full.toUpperCase()}`}
          </AppText>
        }
        trailing={<PlatformIcon name="chevron-forward" size={18} color={colors.text.tertiary} />}
        onPress={onPress}
        onLongPress={confirm.ask}
        accessibilityLabel={`${playlist.name}, playlist, ${meta.full}`}
        a11yActions={confirm.a11y(onDelete)}
      />
      <ConfirmDialog
        visible={confirm.open}
        title="Delete this playlist?"
        body={`"${playlist.name}" and its ${meta.items} will be removed. This can't be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          confirm.close();
          onDelete();
        }}
        onCancel={confirm.close}
      />
    </>
  );
}

export interface DownloadItemProps {
  download: DownloadRecord;
  onPlay: (sermonId: string) => void;
  onRetry: (sermonId: string) => void;
  onDelete: (sermonId: string) => void;
}

export function DownloadListRow({ download, onPlay, onRetry, onDelete }: DownloadItemProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const confirm = useDeleteConfirm();
  const { isReady, isFailed, isActive, label } = downloadState(download);
  const meta = downloadMetaLine(download);

  const press = () => {
    if (isReady) onPlay(download.sermonId);
    else if (isFailed) onRetry(download.sermonId);
  };

  return (
    <>
      <RowShell
        art={<DownloadArt download={download} style={[ROW_LEAF, { width: ROW_ART_SIZE, height: ROW_ART_SIZE }]} />}
        title={download.title}
        meta={
          <>
            {isReady ? (
              <PlatformIcon name="checkmark-circle" size={12} color={colors.status.sage.text} testID="download-ready-checkmark" />
            ) : null}
            <AppText
              variant="mono.meta"
              tone="tertiary"
              numberOfLines={1}
              style={isFailed ? styles.failure : undefined}
            >
              {isFailed ? meta : meta.toUpperCase()}
            </AppText>
          </>
        }
        trailing={
          isActive ? (
            <CircularProgress
              progress={download.state === 'downloading' ? download.progress : 0}
              size={28}
              strokeWidth={2.5}
              trackColor={colors.track.default}
              fillColor={colors.accent.gold}
              spinning
            >
              <PlatformIcon name="arrow-down" size={12} color={colors.text.secondary} />
            </CircularProgress>
          ) : isFailed ? (
            <View style={[styles.circle, styles.circleRose]}>
              <PlatformIcon name="refresh" size={16} color={colors.status.rose.text} />
            </View>
          ) : (
            <View style={styles.circle}>
              <PlatformIcon name="play" size={14} color={colors.text.primary} />
            </View>
          )
        }
        onPress={press}
        onLongPress={confirm.ask}
        accessibilityLabel={label}
        a11yActions={confirm.a11y(() => onDelete(download.sermonId))}
        testID={`download-row-${download.sermonId}`}
      />
      <ConfirmDialog
        visible={confirm.open}
        title="Delete this download?"
        body={`"${download.title}" will be removed from this device.`}
        confirmLabel="Delete"
        onConfirm={() => {
          confirm.close();
          onDelete(download.sermonId);
        }}
        onCancel={confirm.close}
      />
    </>
  );
}

// ---------------------------------------------------------------- grid tiles

export function PlaylistGridTile({
  playlist,
  width,
  onPress,
  onDelete,
}: {
  playlist: PlaylistPublic;
  width: number;
  onPress: () => void;
  onDelete: () => void;
}) {
  const styles = useStyles();
  const confirm = useDeleteConfirm();
  const meta = playlistMeta(playlist);
  return (
    <>
      <PressableScale
        onPress={onPress}
        onLongPress={confirm.ask}
        accessibilityRole="button"
        accessibilityLabel={`${playlist.name}, playlist, ${meta.full}`}
        {...confirm.a11y(onDelete)}
        style={[styles.tile, { width }]}
      >
        <PlaylistCover name={playlist.name} coverUrl={playlist.cover_url} size={width} shape={LEAF_SM} />
        <View style={styles.caption}>
          <AppText variant="ui.label" numberOfLines={2}>
            {playlist.name}
          </AppText>
          <AppText variant="mono.meta" tone="tertiary" numberOfLines={1}>
            {meta.items.toUpperCase()}
          </AppText>
        </View>
      </PressableScale>
      <ConfirmDialog
        visible={confirm.open}
        title="Delete this playlist?"
        body={`"${playlist.name}" will be removed. This can't be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          confirm.close();
          onDelete();
        }}
        onCancel={confirm.close}
      />
    </>
  );
}

export function DownloadGridTile({ download, width, onPlay, onRetry, onDelete }: DownloadItemProps & { width: number }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const confirm = useDeleteConfirm();
  const { isReady, isFailed, isActive, label } = downloadState(download);
  const meta = downloadMetaLine(download);

  const press = () => {
    if (isReady) onPlay(download.sermonId);
    else if (isFailed) onRetry(download.sermonId);
  };

  return (
    <>
      <PressableScale
        onPress={press}
        onLongPress={confirm.ask}
        accessibilityRole="button"
        accessibilityLabel={label}
        {...confirm.a11y(() => onDelete(download.sermonId))}
        style={[styles.tile, { width }]}
      >
        <View>
          <DownloadArt download={download} style={[LEAF_SM, { width, height: width }]} />
          {/* Drawn on the art, so pinned to the dark palette like the other on-art chips. */}
          <View style={styles.badgeAnchor} pointerEvents="none">
            {isActive ? (
              <CircularProgress
                progress={download.state === 'downloading' ? download.progress : 0}
                size={26}
                strokeWidth={2}
                trackColor={onArt.track.default}
                fillColor={onArt.accent.gold}
                spinning
              >
                <PlatformIcon name="arrow-down" size={10} color={onArt.text.secondary} />
              </CircularProgress>
            ) : (
              <View style={styles.badge}>
                <PlatformIcon
                  name={isFailed ? 'refresh' : 'checkmark-circle'}
                  size={14}
                  color={isFailed ? onArt.status.rose.text : onArt.status.sage.text}
                />
              </View>
            )}
          </View>
        </View>
        <View style={styles.caption}>
          <AppText variant="ui.label" numberOfLines={2}>
            {download.title}
          </AppText>
          <View style={styles.metaRow}>
            {isReady ? <PlatformIcon name="checkmark-circle" size={11} color={colors.status.sage.text} /> : null}
            <AppText variant="mono.meta" tone="tertiary" numberOfLines={1} style={isFailed ? styles.failure : undefined}>
              {isFailed ? 'Tap to retry' : meta.toUpperCase()}
            </AppText>
          </View>
        </View>
      </PressableScale>
      <ConfirmDialog
        visible={confirm.open}
        title="Delete this download?"
        body={`"${download.title}" will be removed from this device.`}
        confirmLabel="Delete"
        onConfirm={() => {
          confirm.close();
          onDelete(download.sermonId);
        }}
        onCancel={confirm.close}
      />
    </>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 80,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  pressed: {
    opacity: 0.7,
  },
  art: {
    overflow: 'hidden',
    backgroundColor: colors.surface.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  rowTitle: {
    fontFamily: fontFamily.uiSemiBold,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  failure: {
    color: colors.status.rose.text,
  },
  trailing: {
    minWidth: 36,
    alignItems: 'flex-end',
  },
  circle: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleRose: {
    borderColor: colors.status.rose.border,
    backgroundColor: colors.status.rose.bg,
  },
  tile: {
    gap: spacing.sm,
  },
  caption: {
    gap: 2,
  },
  badgeAnchor: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
  },
  badge: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: onArt.overlay.chipFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: onArt.overlay.chipBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
