import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Toggle } from '../../../components';
import { spacing } from '../../../theme/spacing';

export interface DownloadsSectionProps {
  wifiOnly: boolean;
  onChangeWifiOnly: (enabled: boolean) => void;
  disabled?: boolean;
}

/**
 * Profile & Settings' Downloads section (Isaac's ask, session 2026-10-09: the dedicated
 * `downloads-settings.tsx` page, reached from the Downloads tab's own header, is retired
 * in favor of folding its one setting in here instead — same consolidation Playback's own
 * section already represents). Same `section`/`toggleRow` shape as `PlaybackSection`,
 * which is where that pattern comes from, not invented fresh here.
 */
export function DownloadsSection({ wifiOnly, onChangeWifiOnly, disabled = false }: DownloadsSectionProps) {
  return (
    <View style={styles.section}>
      <AppText variant="ui.label" tone="tertiary" style={styles.heading}>
        Downloads
      </AppText>
      <View style={styles.toggleRow}>
        <AppText variant="ui.bodyLarge">Download on Wi-Fi only</AppText>
        <Toggle
          value={wifiOnly}
          onValueChange={onChangeWifiOnly}
          disabled={disabled}
          accessibilityLabel="Wi-Fi only downloads"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
  },
  heading: {
    textTransform: 'uppercase',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
});
