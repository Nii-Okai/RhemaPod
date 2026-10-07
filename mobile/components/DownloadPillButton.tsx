import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from './Text';
import { ProgressBar } from './ProgressBar';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';
import { useDownloads } from '../lib/downloads/useDownloads';

export interface DownloadPillButtonProps {
  /** Series detail: the episode the Play/Resume CTA above this button targets — there's
      no single "download the series" concept (downloads are per-sermon), so this pill
      downloads whichever episode Play/Resume would currently play, keeping the two
      buttons in sync. Sermon detail: the sermon itself. */
  sermonId: string;
  title: string;
}

/**
 * Full-width, dark-pill Download control (Isaac's ask, session 2026-09-30 — Netflix's
 * own title-page pair: a white Play pill directly above a gray Download pill, both the
 * same width). Promoted here, session 2026-10-01, once sermon detail adopted the same
 * pill skin in place of its own original `LinkButton`-based affordance — same
 * `useDownloads()` state machine underneath both (queued/downloading/ready/failed), just
 * one skin now instead of two.
 *
 * Unlike series detail's own gating (it never checks for an audio rendition first — that
 * data, `media_refs`, isn't on the episode-list endpoint that screen already has),
 * sermon detail gates this pill on `hasAudio` itself at the call site, same as its
 * original affordance did — this component has no opinion either way; a caller that
 * never renders it when there's no audio rendition gets that behavior for free.
 */
export function DownloadPillButton({ sermonId, title }: DownloadPillButtonProps) {
  const downloads = useDownloads();
  const record = downloads.find(sermonId);

  if (!record) {
    return (
      <Pressable
        onPress={() => {
          void downloads.download(sermonId, title);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Download ${title}`}
        style={({ pressed }) => [styles.pillShell, styles.pillRow, pressed && styles.pressed]}
      >
        <Ionicons name="download-outline" size={18} color={colors.text.primary} />
        <AppText variant="ui.button" tone="primary">
          Download
        </AppText>
      </Pressable>
    );
  }

  if (record.state === 'queued') {
    return (
      <View style={[styles.pillShell, styles.pillRow]}>
        <ActivityIndicator size="small" color={colors.text.primary} />
        <AppText variant="ui.button" tone="primary">
          Queued…
        </AppText>
      </View>
    );
  }

  if (record.state === 'downloading') {
    const percent = Math.round(record.progress * 100);
    return (
      <View style={[styles.pillShell, styles.downloadingShell]}>
        <AppText variant="ui.button" tone="primary">
          Downloading… {percent}%
        </AppText>
        <ProgressBar
          progress={record.progress}
          accessibilityLabel={`Downloading ${title}, ${percent} percent`}
          height={3}
          animated
        />
      </View>
    );
  }

  if (record.state === 'ready') {
    return (
      <Pressable
        onPress={() => {
          void downloads.remove(sermonId);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Delete downloaded ${title}`}
        style={({ pressed }) => [styles.pillShell, styles.pillRow, pressed && styles.pressed]}
      >
        <Ionicons name="checkmark-circle" size={18} color={colors.accent.gold} />
        <AppText variant="ui.button" tone="gold">
          Downloaded
        </AppText>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => {
        void downloads.retry(sermonId);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Retry download of ${title}`}
      style={({ pressed }) => [styles.pillShell, styles.pillRow, pressed && styles.pressed]}
    >
      <Ionicons name="refresh" size={18} color={colors.status.rose.text} />
      <AppText variant="ui.button" style={styles.failureText}>
        {record.failureMessage ?? 'Download failed — retry'}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pillShell: {
    width: '100%',
    backgroundColor: colors.track.default,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  downloadingShell: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  pressed: {
    opacity: 0.85,
  },
  failureText: {
    color: colors.status.rose.text,
  },
});
