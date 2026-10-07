import React, { useRef } from 'react';
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

const PRESSED_SCALE = 0.96;
const SPRING_CONFIG = { useNativeDriver: true, speed: 20, bounciness: 6 };

/**
 * Tactile press feedback for Home's shelf cards (Isaac's ask, session 2026-09-30: "make it
 * more alive") — a subtle spring scale-down on press instead of the flat `opacity: 0.7`
 * every card previously used. Scoped to compact shelf cards (`SeriesCard`,
 * `ContinueWatchingCard`, `SermonCard`, `ImageOnlyCard`) and `HeroCard`'s two CTA pills, not
 * `HeroCard`'s own full-bleed "tap anywhere" layer — scaling a whole hero down 4% on a
 * background tap reads as the page flexing, not a button responding, so that one keeps its
 * original opacity feedback.
 *
 * `useNativeDriver: true` runs the animation on the UI thread — no JS-thread jank risk from
 * animating a transform on every scroll frame's worth of cards.
 */
export function PressableScale({ style, children, onPressIn, onPressOut, ...pressableProps }: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      {...pressableProps}
      onPressIn={(e) => {
        Animated.spring(scale, { toValue: PRESSED_SCALE, ...SPRING_CONFIG }).start();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        Animated.spring(scale, { toValue: 1, ...SPRING_CONFIG }).start();
        onPressOut?.(e);
      }}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
