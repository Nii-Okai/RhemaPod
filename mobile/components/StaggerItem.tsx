import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

export interface StaggerItemProps {
  /** Position within its shelf — drives the entrance delay. */
  index: number;
  children: React.ReactNode;
}

const STEP_MS = 40;
const MAX_DELAY_MS = 320;
const DURATION_MS = 220;

/**
 * Per-card fade + rise-in for Home's shelves (Isaac's ask, session 2026-09-30: "make it
 * more alive"). Runs once per mount, not per re-render — a shelf's cards key off
 * `item.id`, which stays stable across an ordinary refetch of the same data, so React
 * never remounts (and never re-plays this animation for) a card that was already on
 * screen. Only a shelf whose item *set* actually changed (the daily shuffle landing on a
 * new day, a genuinely new sermon) replays it, which is exactly the "alive," not
 * "jittery," distinction `_daily_shuffle` was built around on the backend.
 *
 * `useNativeDriver: true` keeps this off the JS thread — safe to apply to every card in
 * every shelf without scroll-performance risk.
 */
export function StaggerItem({ index, children }: StaggerItemProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: DURATION_MS,
      delay: Math.min(index * STEP_MS, MAX_DELAY_MS),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
    // Intentionally mount-only (empty deps); see the doc comment above.
  }, []);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}
