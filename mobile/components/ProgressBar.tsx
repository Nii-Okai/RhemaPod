import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';

export interface ProgressBarProps {
  /** 0–1. Values outside that range are clamped. */
  progress: number;
  /** e.g. "42% downloaded" or "12:04 of 42:18" — required, this is a non-text control. */
  accessibilityLabel: string;
  height?: number;
}

/**
 * Track + gold fill (spec §4) — one component for both the player scrub bar and download
 * progress rows, confirmed by the spec as the same visual pattern in both places.
 */
export function ProgressBar({ progress, accessibilityLabel, height = 4 }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[styles.track, { height }]}
    >
      <View style={[styles.fill, { width: `${clamped * 100}%`, height }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    backgroundColor: colors.track.default,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  fill: {
    backgroundColor: colors.accent.gold,
    borderRadius: radius.pill,
  },
});
