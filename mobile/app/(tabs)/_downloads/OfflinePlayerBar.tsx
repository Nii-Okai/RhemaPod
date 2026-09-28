import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { AppText, IconButton, ProgressBar } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';

export interface OfflinePlayerBarProps {
  title: string;
  /** `file://` path to the decrypted plaintext temp file (path A) — never the encrypted download itself. */
  localUri: string;
  onClose: () => void;
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Minimal, foreground-only offline playback bar (plan W4.5's own "offline playback"
 * deliverable) — proves the decrypt-to-temp-file pipeline actually plays audio in
 * airplane mode. Deliberately not the full W4.2 player: no lock-screen/Control-Center
 * transport controls, no speed/sleep-timer, no background-audio session configuration.
 * `expo-audio` (SDK-52-bundled, first-party) is scoped to this bar only; W4.2 makes its
 * own player-library call for the full streaming experience independently.
 */
export function OfflinePlayerBar({ title, localUri, onClose }: OfflinePlayerBarProps) {
  const player = useAudioPlayer(localUri);
  const status = useAudioPlayerStatus(player);

  const togglePlayback = () => {
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  };

  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;

  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <IconButton
          icon={status.playing ? 'pause' : 'play'}
          accessibilityLabel={status.playing ? `Pause ${title}` : `Play ${title}`}
          onPress={togglePlayback}
          disabled={!status.isLoaded}
        />
        <View style={styles.info}>
          <AppText variant="ui.label" numberOfLines={1}>
            {title}
          </AppText>
          <ProgressBar
            progress={progress}
            accessibilityLabel={`Playback position ${formatSeconds(status.currentTime)} of ${formatSeconds(status.duration)}`}
          />
        </View>
        <AppText variant="mono.meta" tone="tertiary">
          {formatSeconds(status.currentTime)} / {formatSeconds(status.duration)}
        </AppText>
        <IconButton icon="close" accessibilityLabel="Stop offline playback" onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface.raised,
    borderColor: colors.border.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  info: {
    flex: 1,
    gap: spacing.xs,
  },
});
