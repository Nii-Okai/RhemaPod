import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, IconButton, LinkButton, ProgressBar } from '../../../components';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';
import { useDownloads } from '../../../lib/downloads/useDownloads';

export interface DownloadButtonProps {
  sermonId: string;
  title: string;
  /** From `detail.media_refs.some(ref => ref.type === 'audio')` — the same audio-only gate the backend's `download/audio` endpoint enforces (409 with no rendition). No affordance renders at all when this is false, rather than a Download button that always 409s. */
  hasAudio: boolean;
}

/**
 * Sermon-detail's entry point into the offline-download queue (plan W4.5 — "queue" has
 * to start somewhere; the Downloads tab itself only manages what's already queued). Kept
 * deliberately separate from `resolveCta`/`cta.ts` (W4.1's own Play/Resume logic, locked)
 * — this is an additive control, not a replacement for or a fork of that CTA.
 */
export function DownloadButton({ sermonId, title, hasAudio }: DownloadButtonProps) {
  const downloads = useDownloads();

  if (!hasAudio) return null;

  const record = downloads.find(sermonId);

  if (!record) {
    return (
      <View style={styles.row}>
        <LinkButton
          label="Download for offline"
          onPress={() => {
            void downloads.download(sermonId, title);
          }}
        />
      </View>
    );
  }

  if (record.state === 'queued') {
    return (
      <AppText variant="ui.label" tone="tertiary">
        Queued for download
      </AppText>
    );
  }

  if (record.state === 'downloading') {
    return (
      <View style={styles.progressRow}>
        <AppText variant="ui.label" tone="tertiary">
          Downloading… {Math.round(record.progress * 100)}%
        </AppText>
        <ProgressBar
          progress={record.progress}
          accessibilityLabel={`Downloading ${title}, ${Math.round(record.progress * 100)} percent`}
          animated
        />
      </View>
    );
  }

  if (record.state === 'ready') {
    return (
      <View style={styles.row}>
        <AppText variant="ui.label" tone="tertiary">
          Downloaded for offline
        </AppText>
        <IconButton
          icon="trash-outline"
          accessibilityLabel={`Delete downloaded ${title}`}
          onPress={() => {
            void downloads.remove(sermonId);
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <AppText variant="ui.label" style={styles.failureText}>
        {record.failureMessage ?? 'Download failed.'}
      </AppText>
      <LinkButton
        label="Retry"
        onPress={() => {
          void downloads.retry(sermonId);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  progressRow: {
    gap: spacing.xs,
  },
  failureText: {
    color: colors.status.rose.text,
  },
});
