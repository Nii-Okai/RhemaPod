import React, { useEffect, useRef } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';
import { useReduceMotion } from '../lib/hooks/useReduceMotion';

export interface PopInProps {
  children: React.ReactNode;
  /** Layout for the animated wrapper, e.g. `flexShrink` when it sits in a row. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Completion payoff (Isaac's ask, session 2026-10-09 — the download ring-to-checkmark
 * swap "works but looks too standard"): a small overshoot scale-and-fade-in, so the
 * checkmark arrives with a bit of life instead of just appearing. Runs once on mount —
 * callers rely on React unmounting the previous state's element (a different component
 * type at the same JSX position, e.g. the ring `Pressable` vs this `IconButton`) to
 * remount this on every fresh transition into the ready state, not on manual key changes.
 *
 * With Reduce Motion on, the overshoot is skipped and the child shows at full size.
 */
export function PopIn({ children, style }: PopInProps) {
  const scale = useRef(new Animated.Value(0.5)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (reduceMotion) {
      scale.stopAnimation();
      opacity.stopAnimation();
      scale.setValue(1);
      opacity.setValue(1);
    }
  }, [reduceMotion, scale, opacity]);

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        speed: 20,
        bounciness: 10,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
  }, [scale, opacity]);

  return <Animated.View style={[style, { transform: [{ scale }], opacity }]}>{children}</Animated.View>;
}
