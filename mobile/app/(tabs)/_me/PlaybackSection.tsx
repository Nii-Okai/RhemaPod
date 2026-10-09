import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Toggle } from '../../../components';
import { colors } from '../../../theme/colors';
import { spacing } from '../../../theme/spacing';

export interface PlaybackSectionProps {
  autoplayNextInSeries: boolean;
  onChangeAutoplay: (enabled: boolean) => void;
  disabled?: boolean;
  /** Set by the caller when the last autoplay change failed to persist — the toggle has already reverted, this is just the user-visible reason why. */
  error?: string | null;
}

/**
 * Profile & Settings' playback section (design spec 1n) — autoplay-next-in-series.
 * Deliberately excludes the source's notify-on-publish toggle (plan L5: push is cut
 * entirely, and "a dead toggle is worse than no toggle"). The default-speed picker that
 * used to live here is gone too (Isaac's ask, session 2026-10-09) — the Player screen's
 * own in-session speed control (`cyclePlaybackSpeed.ts`) already covers it, and
 * `usePlaybackPreferences`'s `defaultSpeed`/`setDefaultSpeed` stay fully intact
 * underneath (the Player still reads `defaultSpeed` as a session's starting rate); this
 * only removes the redundant second place to change it.
 */
export function PlaybackSection({ autoplayNextInSeries, onChangeAutoplay, disabled = false, error = null }: PlaybackSectionProps) {
  return (
    <View style={styles.section}>
      <AppText variant="ui.label" tone="tertiary" style={styles.heading}>
        Playback
      </AppText>

      <View style={styles.toggleRow}>
        <AppText variant="ui.bodyLarge">Autoplay next in series</AppText>
        <Toggle
          value={autoplayNextInSeries}
          onValueChange={onChangeAutoplay}
          disabled={disabled}
          accessibilityLabel="Autoplay next in series"
        />
      </View>

      {error ? (
        <AppText variant="ui.badge" style={styles.errorText}>
          {error}
        </AppText>
      ) : null}
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
  errorText: {
    color: colors.status.rose.text,
  },
});
