import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { createThemedStyles } from '../theme/ThemeContext';
import { radius } from '../theme/radius';

export interface ProgressBarProps {
  /** 0–1. Values outside that range are clamped. */
  progress: number;
  /** e.g. "42% downloaded" or "12:04 of 42:18" — required, this is a non-text control. */
  accessibilityLabel: string;
  height?: number;
  /**
   * Design spec §1.4's motion baseline: the download-progress row is "the one place motion
   * actually communicates something" and should animate its fill over ~200–300ms ease-out
   * on each update, while the player's timing-critical scrub bar stays instant ("no easing
   * flourish"). Defaults to `false` (instant, the scrub-bar/buffering behaviour) — callers
   * rendering an actual download-progress row must opt in explicitly.
   */
  animated?: boolean;
}

const ANIMATION_DURATION_MS = 250;

/**
 * Track + gold fill (spec §4) — one component for both the player scrub bar and download
 * progress rows, confirmed by the spec as the same visual pattern in both places.
 */
export function ProgressBar({ progress, accessibilityLabel, height = 4, animated = false }: ProgressBarProps) {
  const styles = useStyles();
  const clamped = Math.min(1, Math.max(0, progress));
  const widthPercent = useRef(new Animated.Value(clamped * 100)).current;
  // Skip animating the very first render — there's nothing to ease from yet, and a
  // same-value animation on mount is both visually pointless and (in tests) a stray timer
  // left running past the render that scheduled it.
  const hasMounted = useRef(false);

  useEffect(() => {
    if (animated && hasMounted.current) {
      Animated.timing(widthPercent, {
        toValue: clamped * 100,
        duration: ANIMATION_DURATION_MS,
        useNativeDriver: false, // width isn't a native-driver-supported property
      }).start();
    } else {
      widthPercent.setValue(clamped * 100);
    }
    hasMounted.current = true;
    // `widthPercent`/`hasMounted` are stable refs for this instance's lifetime — not
    // reactive inputs.
  }, [clamped, animated]);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[styles.track, { height }]}
    >
      <Animated.View
        style={[styles.fill, { width: widthPercent.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }), height }]}
      />
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
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
}));
