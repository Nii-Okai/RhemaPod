import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../theme/colors';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const SPIN_DURATION_MS = 1400;

export interface CircularProgressProps {
  /** 0–1. */
  progress: number;
  size?: number;
  strokeWidth?: number;
  trackColor?: string;
  fillColor?: string;
  /** Continuous rotation layered on top of the fill (Isaac's ask, session 2026-10-09 — the
   * static fill "works but looks too standard"): the ring both fills AND spins while this
   * is true, closer to the Netflix reference he pointed at, rather than sitting still as
   * the stroke advances. Off by default — a caller with no active transfer to show has no
   * reason for a spinning ring. */
  spinning?: boolean;
  children?: React.ReactNode;
}

/**
 * A YouTube-style circular progress ring (Isaac's ask, session 2026-10-08: download
 * buttons want real per-item progress feedback, not a generic spinner) — a static track
 * circle plus a fill circle whose `strokeDashoffset` is driven by `progress`, rotated -90°
 * so it starts at 12 o'clock and fills clockwise. `children` renders centered inside the
 * ring (an icon, typically) via absolute positioning over the SVG, not as part of it — SVG
 * children don't participate in RN's own layout system, so a plain overlay `View` is the
 * simpler way to center arbitrary RN content inside a fixed-size circle.
 *
 * Two polish passes added session 2026-10-09: the fill tweens toward each new `progress`
 * value (`Animated.timing`, ~650ms) instead of snapping — the caller polls on an interval,
 * so without this the ring visibly steps rather than flows; and the whole ring (both
 * circles — the track is rotationally symmetric, so rotating it along for the ride is
 * free) can continuously rotate via `spinning`, layered on top of the same -90° start
 * offset rather than replacing it.
 */
export function CircularProgress({
  progress,
  size = 24,
  strokeWidth = 2.5,
  trackColor = colors.track.default,
  fillColor = colors.accent.gold,
  spinning = false,
  children,
}: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, progress));
  const center = size / 2;

  const animatedProgress = useRef(new Animated.Value(clamped)).current;
  useEffect(() => {
    Animated.timing(animatedProgress, {
      toValue: clamped,
      duration: 650,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false, // strokeDashoffset isn't a native-driver-supported property
    }).start();
  }, [clamped, animatedProgress]);

  const strokeDashoffset = animatedProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spinning) {
      spin.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: SPIN_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spinning, spin]);

  // -90deg is the fill's own fixed starting offset (12 o'clock instead of 3 o'clock); the
  // spin loop, when running, adds a further full rotation on top of it.
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['-90deg', '270deg'] });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', transform: [{ rotate }] }}>
        <Svg width={size} height={size}>
          <Circle cx={center} cy={center} r={radius} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
          <AnimatedCircle
            cx={center}
            cy={center}
            r={radius}
            stroke={fillColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
          />
        </Svg>
      </Animated.View>
      {children}
    </View>
  );
}
