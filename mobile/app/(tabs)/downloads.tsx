import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../../components';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useDownloads } from '../../lib/downloads/useDownloads';
import { DownloadRow } from './_downloads/DownloadRow';

/**
 * Downloads (design spec §1l, plan W4.5) — offline audio and video downloads (video added
 * session 2026-10-08): queue/progress, retry with a real failure reason, delete. Starting
 * a download itself happens from sermon-detail's or series-detail's `DownloadPillButton`,
 * or an episode row's own `EpisodeDownloadButton` — this screen only manages what's
 * already queued/downloaded, per the spec's own separation of "start" and "manage".
 *
 * Play navigates into the real Player screen (session 2026-10-08 — this list's own
 * standalone mini-player, audio-only and a dead end for a video download, is retired) —
 * that screen prefers the local file for a `ready` download over streaming, for both
 * media types, so there is exactly one playback surface for a downloaded sermon.
 *
 * Redesigned session 2026-10-09 (Isaac's asks): top padding starts at `insets.top`, below
 * the notch/Dynamic Island, rather than a fixed value that happened to clear it on some
 * devices and not others; the empty state centers in the remaining screen height instead
 * of sitting near the top; each row (`DownloadRow`) carries a real thumbnail with its
 * state's action overlaid on it, replacing the old title+"Downloaded"+right-icon layout.
 * The Wi-Fi-only toggle — this screen's one setting — briefly had its own dedicated
 * settings page (gear icon + empty-state link), since retired in favor of folding it into
 * Profile & Settings' own `DownloadsSection` (`me.tsx`) instead of a second settings
 * surface — this screen is purely the download list again, no header action of its own.
 */
export default function DownloadsScreen() {
  const downloads = useDownloads();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const isEmpty = !downloads.isLoading && downloads.downloads.length === 0;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, spacing.lg) }]}>
        <AppText variant="display.section" style={styles.heading}>
          Downloads
        </AppText>

        {downloads.isLoading ? (
          <View style={styles.centered} accessibilityRole="progressbar" accessibilityLabel="Loading downloads">
            <ActivityIndicator color={colors.accent.gold} />
          </View>
        ) : isEmpty ? (
          <View style={styles.centered}>
            <AppText variant="ui.bodyLarge" style={styles.emptyText}>
              No downloads yet
            </AppText>
            <AppText variant="ui.body" tone="secondary" style={styles.emptyText}>
              Download a sermon from its detail page to watch or listen offline.
            </AppText>
          </View>
        ) : (
          <View style={styles.list}>
            {downloads.downloads.map((download) => (
              <DownloadRow
                key={download.sermonId}
                download={download}
                onPlay={(sermonId) => {
                  router.push({ pathname: '/player/[id]', params: { id: sermonId } });
                }}
                onRetry={(sermonId) => {
                  void downloads.retry(sermonId);
                }}
                onDelete={(sermonId) => {
                  void downloads.remove(sermonId);
                }}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  content: {
    flexGrow: 1,
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
  },
  heading: {
    marginBottom: spacing.sm,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xl,
  },
  emptyText: {
    textAlign: 'center',
  },
  list: {
    gap: spacing.lg,
  },
});
