import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Toggle } from '../../../components';
import { colors } from '../../../theme/colors';
import { radius } from '../../../theme/radius';
import { spacing } from '../../../theme/spacing';
import { PLAYBACK_SPEEDS, type PlaybackSpeed } from '../../../lib/settings/playbackPreferences';

export interface PlaybackSectionProps {
  defaultSpeed: PlaybackSpeed;
  autoplayNextInSeries: boolean;
  onChangeSpeed: (speed: PlaybackSpeed) => void;
  onChangeAutoplay: (enabled: boolean) => void;
  disabled?: boolean;
  /** Set by the caller when the last speed/autoplay change failed to persist — the toggle has already reverted, this is just the user-visible reason why. */
  error?: string | null;
}

function speedLabel(speed: PlaybackSpeed): string {
  return `${speed}×`;
}

/**
 * Profile & Settings' playback section (design spec 1n) — default speed and
 * autoplay-next-in-series. Deliberately excludes the source's notify-on-publish toggle
 * (plan L5: push is cut entirely, and "a dead toggle is worse than no toggle").
 */
export function PlaybackSection({
  defaultSpeed,
  autoplayNextInSeries,
  onChangeSpeed,
  onChangeAutoplay,
  disabled = false,
  error = null,
}: PlaybackSectionProps) {
  return (
    <View style={styles.section}>
      <AppText variant="ui.label" tone="tertiary" style={styles.heading}>
        Playback
      </AppText>

      <AppText variant="ui.body" tone="secondary" style={styles.fieldLabel}>
        Default speed
      </AppText>
      <View style={styles.speedRow}>
        {PLAYBACK_SPEEDS.map((speed) => {
          const active = speed === defaultSpeed;
          return (
            <Pressable
              key={speed}
              accessibilityRole="button"
              accessibilityLabel={`Default speed ${speedLabel(speed)}`}
              accessibilityState={{ selected: active, disabled }}
              disabled={disabled}
              onPress={() => onChangeSpeed(speed)}
              style={({ pressed }) => [
                styles.speedChip,
                active && styles.speedChipActive,
                pressed && styles.speedChipPressed,
                disabled && styles.speedChipDisabled,
              ]}
            >
              <AppText variant="ui.badge" tone={active ? 'gold' : 'secondary'}>
                {speedLabel(speed)}
              </AppText>
            </Pressable>
          );
        })}
      </View>

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
  fieldLabel: {
    marginTop: spacing.xs,
  },
  speedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  speedChip: {
    backgroundColor: colors.track.default,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  speedChipActive: {
    backgroundColor: colors.chip.square,
  },
  speedChipPressed: {
    opacity: 0.7,
  },
  speedChipDisabled: {
    opacity: 0.4,
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
