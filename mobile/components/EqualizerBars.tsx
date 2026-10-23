import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';

// Each bar breathes on its own period and range so the group never moves in lockstep.
const BARS = [
  { min: 0.35, max: 1, duration: 420 },
  { min: 0.2, max: 0.85, duration: 560 },
  { min: 0.45, max: 1, duration: 360 },
  { min: 0.25, max: 0.75, duration: 500 },
] as const;
const RESTING = [0.55, 0.85, 0.4, 0.7];

export interface EqualizerBarsProps {
  /** Animates while true; holds still (a paused "now playing" mark) while false. */
  active: boolean;
  color: string;
  /** Overall height; bar width and gaps scale from it. */
  size?: number;
  testID?: string;
}

/**
 * The "now playing" audio-visualiser mark (Nii's ask, 2026-10-23: show it on the current
 * sermon while a playlist plays). Decorative bars, not a real spectrum — reading live
 * audio levels would need a native audio tap expo-video doesn't offer. Native-driver
 * `scaleY` from the bottom edge, so it costs nothing on the JS thread; still under
 * Reduce Motion.
 */
export function EqualizerBars({ active, color, size = 16, testID }: EqualizerBarsProps) {
  const values = useRef(BARS.map((_, i) => new Animated.Value(RESTING[i]!))).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (alive) setReduceMotion(enabled);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!active || reduceMotion) {
      values.forEach((v, i) => v.setValue(RESTING[i]!));
      return undefined;
    }
    const loops = BARS.map((bar, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(values[i]!, { toValue: bar.max, duration: bar.duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(values[i]!, { toValue: bar.min, duration: bar.duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [active, reduceMotion, values]);

  const barWidth = Math.max(2, Math.round(size / 6));
  return (
    <View
      testID={testID}
      style={[styles.row, { height: size, gap: Math.max(1, Math.round(barWidth * 0.6)) }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {values.map((value, i) => (
        <Animated.View
          key={i}
          style={{
            width: barWidth,
            height: size,
            borderRadius: barWidth / 2,
            backgroundColor: color,
            transformOrigin: 'bottom',
            transform: [{ scaleY: value }],
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
});
