import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';
import { radius } from '../theme/radius';

export interface ToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  /** Required — same rule `IconButton` enforces (design spec §8.7): no icon/control-only element ships without an accessible name. */
  accessibilityLabel: string;
}

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 26;
const THUMB_SIZE = 20;
const THUMB_INSET = 3;

/**
 * Gold-on/track-off switch primitive (design spec §1.1: gold is the only interactive
 * accent). First consumer is the Profile & Settings autoplay-next-in-series toggle
 * (W4.6); the Downloads screen's Wi-Fi-only toggle (design spec 1l, W4.5) is the
 * confirmed second consumer, which is what clears this primitive's promotion bar (the
 * same bar `IconButton`'s own docstring applies).
 *
 * A custom `Pressable`, not RN's built-in `Switch`, so both platforms render the exact
 * same navy+gold token pairing rather than each OS's default switch chrome — consistent
 * with this app's "same content model, platform chrome only differs at the nav/tab-bar
 * layer" posture (design spec §3's closing note on 2a/2b/2d).
 */
export function Toggle({ value, onValueChange, disabled = false, accessibilityLabel }: ToggleProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={[styles.track, value ? styles.trackOn : styles.trackOff, disabled && styles.disabled]}
      hitSlop={8}
    >
      <View style={[styles.thumb, value ? styles.thumbOn : styles.thumbOff]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: radius.pill,
    justifyContent: 'center',
    padding: THUMB_INSET,
  },
  trackOn: {
    backgroundColor: colors.accent.gold,
  },
  trackOff: {
    backgroundColor: colors.track.default,
  },
  disabled: {
    opacity: 0.5,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.text.primary,
  },
  thumbOn: {
    alignSelf: 'flex-end',
  },
  thumbOff: {
    alignSelf: 'flex-start',
  },
});
