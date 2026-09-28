import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Card, IconButton, LinkButton, ProgressBar } from '../../../components';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import type { DownloadRecord } from '../../../lib/downloads/types';

export interface DownloadRowProps {
  download: DownloadRecord;
  onPlay: (sermonId: string) => void;
  onRetry: (sermonId: string) => void;
  onDelete: (sermonId: string) => void;
  isPlaying: boolean;
}

function formatBytes(bytes: number | null): string | null {
  if (bytes === null) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** One row per sermon in the Downloads list (design spec §1l, plan W4.5) — every state the download lifecycle can be in gets its own explicit, real-reason UI, never a generic spinner-or-error fallback. */
export function DownloadRow({ download, onPlay, onRetry, onDelete, isPlaying }: DownloadRowProps) {
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={styles.titleBlock}>
          <AppText variant="ui.bodyLarge" numberOfLines={2}>
            {download.title}
          </AppText>
          {download.state === 'queued' ? (
            <AppText variant="ui.label" tone="tertiary">
              Queued
            </AppText>
          ) : null}
          {download.state === 'downloading' ? (
            <AppText variant="ui.label" tone="tertiary">
              Downloading… {Math.round(download.progress * 100)}%
            </AppText>
          ) : null}
          {download.state === 'ready' ? (
            <AppText variant="ui.label" tone="tertiary">
              Downloaded{formatBytes(download.bytesTotal) ? ` · ${formatBytes(download.bytesTotal)}` : ''}
            </AppText>
          ) : null}
          {download.state === 'failed' ? (
            <AppText variant="ui.label" style={styles.failureText}>
              {download.failureMessage ?? 'Download failed.'}
            </AppText>
          ) : null}
        </View>

        {download.state === 'ready' ? (
          <View style={styles.actions}>
            <IconButton
              icon={isPlaying ? 'pause-circle' : 'play-circle'}
              size={32}
              accessibilityLabel={isPlaying ? `Pause ${download.title}` : `Play ${download.title} offline`}
              onPress={() => onPlay(download.sermonId)}
            />
            <IconButton
              icon="trash-outline"
              accessibilityLabel={`Delete downloaded ${download.title}`}
              onPress={() => onDelete(download.sermonId)}
            />
          </View>
        ) : null}

        {download.state === 'failed' ? (
          <View style={styles.actions}>
            <LinkButton label="Retry" onPress={() => onRetry(download.sermonId)} />
            <IconButton
              icon="trash-outline"
              accessibilityLabel={`Remove failed download ${download.title}`}
              onPress={() => onDelete(download.sermonId)}
            />
          </View>
        ) : null}
      </View>

      {download.state === 'downloading' ? (
        <ProgressBar
          progress={download.progress}
          accessibilityLabel={`Downloading ${download.title}, ${Math.round(download.progress * 100)} percent`}
          height={4}
          animated
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  titleBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  failureText: {
    color: colors.status.rose.text,
  },
});
