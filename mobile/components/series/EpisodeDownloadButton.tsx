import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { IconButton } from '../IconButton';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useDownloads } from '../../lib/downloads/useDownloads';

export interface EpisodeDownloadButtonProps {
  episodeId: string;
  episodeTitle: string;
}

/**
 * Compact, icon-only download control at the far end of an `EpisodeRow` (Isaac's ask,
 * session 2026-09-30: "a download button at the far end of every item"). Same
 * `useDownloads()` state machine series detail's own `DownloadPillButton` already uses
 * (queued/downloading/ready/failed) — a third skin on identical logic, not a third
 * download pipeline. Sits outside `EpisodeRow`'s own navigating `Pressable` (a sibling,
 * not a nested touch target) so tapping Download never also opens the episode.
 */
export function EpisodeDownloadButton({ episodeId, episodeTitle }: EpisodeDownloadButtonProps) {
  const downloads = useDownloads();
  const record = downloads.find(episodeId);

  if (!record) {
    return (
      <IconButton
        icon="download-outline"
        accessibilityLabel={`Download ${episodeTitle}`}
        onPress={() => {
          void downloads.download(episodeId, episodeTitle);
        }}
      />
    );
  }

  if (record.state === 'queued' || record.state === 'downloading') {
    return (
      <View accessibilityRole="progressbar" accessibilityLabel={`Downloading ${episodeTitle}`} style={{ padding: spacing.sm }}>
        <ActivityIndicator size="small" color={colors.text.tertiary} />
      </View>
    );
  }

  if (record.state === 'ready') {
    return (
      <IconButton
        icon="checkmark-circle"
        accessibilityLabel={`Delete downloaded ${episodeTitle}`}
        onPress={() => {
          void downloads.remove(episodeId);
        }}
      />
    );
  }

  return (
    <IconButton
      icon="refresh"
      accessibilityLabel={`Retry download of ${episodeTitle}`}
      onPress={() => {
        void downloads.retry(episodeId);
      }}
    />
  );
}
