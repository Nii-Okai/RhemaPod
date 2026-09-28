import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AppText, QueryState, Toggle } from '../../components';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useDownloads } from '../../lib/downloads/useDownloads';
import { useOfflinePlayback } from '../../lib/downloads/useOfflinePlayback';
import { DownloadRow } from './_downloads/DownloadRow';
import { OfflinePlayerBar } from './_downloads/OfflinePlayerBar';

/**
 * Downloads (design spec §1l, plan W4.5) — offline audio downloads: queue/progress,
 * Wi-Fi-only toggle, offline playback (path A decrypt-to-temp, foreground-only — the
 * full W4.2 player is a separate build), retry with a real failure reason, delete.
 * Starting a download itself happens from sermon-detail's Download control
 * (`app/sermon/_detail/DownloadButton.tsx`) — this screen only manages what's already
 * queued/downloaded, per the spec's own separation of "start" and "manage".
 */
export default function DownloadsScreen() {
  const downloads = useDownloads();
  const playback = useOfflinePlayback();

  const playingDownload = playback.playingSermonId ? downloads.find(playback.playingSermonId) : undefined;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <AppText variant="display.section" style={styles.heading}>
          Downloads
        </AppText>

        <View style={styles.wifiRow}>
          <View style={styles.wifiLabel}>
            <AppText variant="ui.body">Wi-Fi only</AppText>
            <AppText variant="ui.label" tone="tertiary">
              Downloads wait for Wi-Fi when this is on.
            </AppText>
          </View>
          <Toggle
            value={downloads.wifiOnly}
            onValueChange={(next) => {
              void downloads.setWifiOnly(next);
            }}
            disabled={downloads.isSavingWifiOnly}
            accessibilityLabel="Wi-Fi only downloads"
          />
        </View>

        {playback.error ? (
          <View style={styles.errorBanner}>
            <AppText variant="ui.label" style={styles.errorText}>
              {playback.error}
            </AppText>
          </View>
        ) : null}

        <QueryState
          isLoading={downloads.isLoading}
          isError={false}
          isEmpty={!downloads.isLoading && downloads.downloads.length === 0}
          emptyTitle="No downloads yet"
          emptyDescription="Download a sermon's audio from its detail page to listen offline."
          loadingLabel="Loading downloads"
        >
          <View style={styles.list}>
            {downloads.downloads.map((download) => (
              <DownloadRow
                key={download.sermonId}
                download={download}
                isPlaying={playback.playingSermonId === download.sermonId}
                onPlay={(sermonId) => {
                  if (playback.playingSermonId === sermonId) {
                    void playback.stop();
                  } else {
                    void playback.play(sermonId);
                  }
                }}
                onRetry={(sermonId) => {
                  void downloads.retry(sermonId);
                }}
                onDelete={(sermonId) => {
                  if (playback.playingSermonId === sermonId) {
                    void playback.stop();
                  }
                  void downloads.remove(sermonId);
                }}
              />
            ))}
          </View>
        </QueryState>
      </ScrollView>

      {playback.localUri && playingDownload ? (
        <View style={styles.playerDock}>
          <OfflinePlayerBar
            title={playingDownload.title}
            localUri={playback.localUri}
            onClose={() => {
              void playback.stop();
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl * 2,
    gap: spacing.lg,
  },
  heading: {
    marginBottom: spacing.xs,
  },
  wifiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  wifiLabel: {
    flex: 1,
    gap: spacing.xs,
  },
  list: {
    gap: spacing.md,
  },
  errorBanner: {
    backgroundColor: colors.status.rose.bg,
    borderColor: colors.status.rose.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: spacing.md,
  },
  errorText: {
    color: colors.status.rose.text,
  },
  playerDock: {
    padding: spacing.md,
  },
});
