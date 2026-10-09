import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from './Text';
import { CircularProgress } from './CircularProgress';
import { PopIn } from './PopIn';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';
import { useDownloads } from '../lib/downloads/useDownloads';
import type { DownloadMediaType, DownloadRecord } from '../lib/downloads/types';

export interface DownloadPillItem {
  sermonId: string;
  title: string;
  mediaType: DownloadMediaType;
  thumbnailUrl?: string | null;
  category?: string | null;
}

export interface DownloadPillButtonProps {
  /** One item (sermon detail: the sermon itself) or several (series detail: every
   * episode — Isaac's ask, session 2026-10-08: the series page's pill downloads the
   * whole series, not just one episode). Items with no rendition yet are the caller's
   * job to filter out before passing them in — this component has no opinion on
   * "nothing to download", it just renders nothing for an empty list. */
  items: DownloadPillItem[];
  /** Idle-state label — "Download" (sermon detail) vs "Download all episodes" (series
   * detail). Defaults to "Download" for a single item. */
  label?: string;
}

type AggregateStatus =
  | { kind: 'idle' }
  | { kind: 'queued' }
  | { kind: 'active'; doneCount: number; total: number; progress: number }
  | { kind: 'ready' }
  | { kind: 'failed'; message: string };

/** Folds every item's own `DownloadRecord` (or absence of one) into one status for the
 * pill to render — a single item is just the degenerate one-item case of the same fold,
 * not a separate code path. */
function aggregate(items: DownloadPillItem[], records: (DownloadRecord | undefined)[]): AggregateStatus {
  if (records.every((r) => !r)) return { kind: 'idle' };
  if (records.every((r) => r?.state === 'ready')) return { kind: 'ready' };

  const anyDownloading = records.some((r) => r?.state === 'downloading');
  const anyQueued = records.some((r) => r?.state === 'queued');
  if (anyQueued && !anyDownloading) return { kind: 'queued' };
  if (anyDownloading || anyQueued) {
    const total = items.length;
    const doneCount = records.filter((r) => r?.state === 'ready').length;
    // Each item contributes 0–1 toward the aggregate: 1 for ready, its own fractional
    // `progress` while downloading, 0 for queued/not-yet-started/failed — the same
    // "whole number of items done, plus however far the rest have gotten" an average of
    // per-item fractions already gives, without a separate special case for "in between".
    const progress =
      records.reduce((sum, r) => sum + (r?.state === 'ready' ? 1 : r?.state === 'downloading' ? r.progress : 0), 0) /
      total;
    return { kind: 'active', doneCount, total, progress };
  }

  const failed = records.find((r) => r?.state === 'failed');
  if (failed) return { kind: 'failed', message: failed.failureMessage ?? 'Download failed.' };

  // Mixed idle/ready with nothing active or failed (e.g. a series where some episodes
  // were downloaded previously and others never started) — render as idle so the label
  // stays an inviting "Download" rather than a misleading "Downloaded" for a partial set.
  return { kind: 'idle' };
}

/**
 * Full-width, dark-pill Download control (Isaac's ask, session 2026-09-30 — Netflix's
 * own title-page pair: a white Play pill directly above a gray Download pill, both the
 * same width). Promoted here, session 2026-10-01, once sermon detail adopted the same
 * pill skin in place of its own original `LinkButton`-based affordance — same
 * `useDownloads()` state machine underneath every mode, just one skin.
 *
 * Generalized to a list of items (Isaac's ask, session 2026-10-08): sermon detail passes
 * one, series detail passes every episode — see `aggregate` above for how N items fold
 * into one pill's worth of state. A caller still owns its own gating (no rendition yet,
 * not playable, etc.) by passing an empty `items` array; this component renders nothing
 * for that case rather than guessing at a reason.
 *
 * Active state renders the same Netflix-style `CircularProgress` fill ring
 * `EpisodeDownloadButton` uses (Isaac's ask, session 2026-10-09 — a linear bar read as
 * too passive; the ring is the one piece of real-time feedback a user watches fill up to
 * the completed checkmark), not a separate progress affordance of its own.
 */
export function DownloadPillButton({ items, label = 'Download' }: DownloadPillButtonProps) {
  const downloads = useDownloads();
  if (items.length === 0) return null;

  const records = items.map((item) => downloads.find(item.sermonId));
  const status = aggregate(items, records);

  if (status.kind === 'queued') {
    return (
      <View style={[styles.pillShell, styles.pillRow]}>
        <ActivityIndicator size="small" color={colors.text.primary} />
        <AppText variant="ui.button" tone="primary">
          Queued…
        </AppText>
      </View>
    );
  }

  const startAll = () => {
    for (const item of items) {
      void downloads.download(item.sermonId, item.title, item.mediaType, item.thumbnailUrl, item.category);
    }
  };

  const retryFailed = () => {
    for (let i = 0; i < items.length; i++) {
      const record = records[i];
      if (!record) {
        void downloads.download(items[i].sermonId, items[i].title, items[i].mediaType, items[i].thumbnailUrl, items[i].category);
      } else if (record.state === 'failed') void downloads.retry(items[i].sermonId);
    }
  };

  const removeAll = () => {
    for (const item of items) void downloads.remove(item.sermonId);
  };

  if (status.kind === 'active') {
    const percent = Math.round(status.progress * 100);
    const progressLabel =
      status.total > 1 ? `Downloading ${status.doneCount} of ${status.total}… ${percent}%` : `Downloading… ${percent}%`;
    return (
      <View
        style={[styles.pillShell, styles.pillRow]}
        accessibilityRole="progressbar"
        accessibilityLabel={progressLabel}
      >
        <CircularProgress progress={status.progress} size={20} strokeWidth={2.5} spinning>
          <Ionicons name="arrow-down" size={10} color={colors.text.primary} />
        </CircularProgress>
        <AppText variant="ui.button" tone="primary">
          {progressLabel}
        </AppText>
      </View>
    );
  }

  if (status.kind === 'ready') {
    return (
      <PopIn>
        <Pressable
          onPress={removeAll}
          accessibilityRole="button"
          accessibilityLabel={items.length > 1 ? 'Delete downloaded episodes' : `Delete downloaded ${items[0].title}`}
          style={({ pressed }) => [styles.pillShell, styles.pillRow, pressed && styles.pressed]}
        >
          <Ionicons name="checkmark-circle" size={18} color={colors.accent.gold} />
          <AppText variant="ui.button" tone="gold">
            Downloaded
          </AppText>
        </Pressable>
      </PopIn>
    );
  }

  if (status.kind === 'failed') {
    return (
      <Pressable
        onPress={retryFailed}
        accessibilityRole="button"
        accessibilityLabel="Retry download"
        style={({ pressed }) => [styles.pillShell, styles.pillRow, pressed && styles.pressed]}
      >
        <Ionicons name="refresh" size={18} color={colors.status.rose.text} />
        <AppText variant="ui.button" style={styles.failureText}>
          {status.message}
        </AppText>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={startAll}
      accessibilityRole="button"
      accessibilityLabel={items.length > 1 ? label : `Download ${items[0].title}`}
      style={({ pressed }) => [styles.pillShell, styles.pillRow, pressed && styles.pressed]}
    >
      <Ionicons name="download-outline" size={18} color={colors.text.primary} />
      <AppText variant="ui.button" tone="primary">
        {label}
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
  pressed: {
    opacity: 0.85,
  },
  failureText: {
    color: colors.status.rose.text,
  },
});
