import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CircularProgress } from '../CircularProgress';
import { IconButton } from '../IconButton';
import { PopIn } from '../PopIn';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useDownloads } from '../../lib/downloads/useDownloads';
import type { DownloadMediaType } from '../../lib/downloads/types';

export interface EpisodeDownloadButtonProps {
  episodeId: string;
  episodeTitle: string;
  /** `null` when this episode has no rendition yet (nothing uploaded) — the caller
   * already has this from the episode list's own `media_type` field (see
   * `app/api/series.py`'s `list_episodes`), so there is no second request here to find
   * out. No affordance renders at all when null, matching the sermon-detail pill's own
   * "no rendition, no button" convention rather than one that always 409s. */
  mediaType: DownloadMediaType | null;
  thumbnailUrl?: string | null;
  category?: string | null;
}

/**
 * Compact, icon-only download control at the far end of an `EpisodeRow` (Isaac's ask,
 * session 2026-09-30: "a download button at the far end of every item"). Same
 * `useDownloads()` state machine series detail's own `DownloadPillButton` already uses
 * (queued/downloading/ready/failed) — a third skin on identical logic, not a third
 * download pipeline. Sits outside `EpisodeRow`'s own navigating `Pressable` (a sibling,
 * not a nested touch target) so tapping Download never also opens the episode.
 *
 * Downloading renders a real, YouTube-style circular progress ring (Isaac's ask, session
 * 2026-10-08 — "change the download button on the right to show a spinning animation with
 * progress and when done change the button to a completed status users will easily
 * identify"), not a generic indeterminate spinner: `CircularProgress` fills clockwise as
 * `record.progress` advances, so a series bulk-download (the pill above firing every
 * episode's own `download()` at once) visibly shows each row progressing independently.
 */
export function EpisodeDownloadButton({
  episodeId,
  episodeTitle,
  mediaType,
  thumbnailUrl = null,
  category = null,
}: EpisodeDownloadButtonProps) {
  const downloads = useDownloads();
  const record = downloads.find(episodeId);

  if (!mediaType) return null;

  if (!record) {
    return (
      <IconButton
        icon="download-outline"
        accessibilityLabel={`Download ${episodeTitle}`}
        onPress={() => {
          void downloads.download(episodeId, episodeTitle, mediaType, thumbnailUrl, category);
        }}
      />
    );
  }

  if (record.state === 'queued' || record.state === 'downloading') {
    const progress = record.state === 'downloading' ? record.progress : 0;
    return (
      <Pressable
        accessibilityRole="progressbar"
        accessibilityLabel={
          record.state === 'downloading'
            ? `Downloading ${episodeTitle}, ${Math.round(progress * 100)} percent`
            : `${episodeTitle} queued for download`
        }
        style={styles.ringWrap}
      >
        <CircularProgress progress={progress} size={24} strokeWidth={2.5} spinning>
          <Ionicons name="arrow-down" size={11} color={colors.text.secondary} />
        </CircularProgress>
      </Pressable>
    );
  }

  if (record.state === 'ready') {
    return (
      <PopIn>
        <IconButton
          icon="checkmark-circle"
          accessibilityLabel={`Delete downloaded ${episodeTitle}`}
          onPress={() => {
            void downloads.remove(episodeId);
          }}
        />
      </PopIn>
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

const styles = StyleSheet.create({
  ringWrap: {
    padding: spacing.sm,
  },
});
