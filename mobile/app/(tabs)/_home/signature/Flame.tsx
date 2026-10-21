import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export interface FlameProps {
  /** Rendered width; height keeps the mark's 3:4 proportions. */
  width: number;
  fill: string;
  /** Outline colour. Omitted, the flame is a solid shape. */
  stroke?: string;
}

// The flame from the RhemaPod mark, on a 12×16 box. The outlined variant is inset by
// half a unit so its stroke isn't clipped at the box edge.
const SOLID_PATH = 'M6 0C6 0 12 6 12 10a6 6 0 0 1-12 0C0 6 6 0 6 0z';
const OUTLINE_PATH = 'M6 1C6 1 11 6.5 11 10a5 5 0 0 1-10 0C1 6.5 6 1 6 1z';

/**
 * Signature's marker: small gold flames stand in for bullets, dots and underlines, and a
 * row of them tracks progress through a series ("your walk").
 */
export function Flame({ width, fill, stroke }: FlameProps) {
  return (
    <Svg width={width} height={(width * 4) / 3} viewBox="0 0 12 16" accessible={false}>
      <Path
        d={stroke ? OUTLINE_PATH : SOLID_PATH}
        fill={fill}
        stroke={stroke}
        strokeWidth={stroke ? 1 : 0}
      />
    </Svg>
  );
}

const GLOW_MS = 1200;

/** A flame that slowly breathes — marks the episode the viewer is partway through. */
export function GlowingFlame(props: FlameProps) {
  const opacity = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: GLOW_MS, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.55, duration: GLOW_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View style={{ opacity }}>
      <Flame {...props} />
    </Animated.View>
  );
}
