import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Artwork } from '../Artwork';
import { useTheme } from '../../theme/ThemeContext';
import {
  clearPlayerHero,
  landPlayerHero,
  usePlayerHero,
  type HeroFlight,
  type HeroRect,
} from '../../lib/playback/playerHero';

/** Long enough to read as the art travelling, about as long as the screen's own slide. */
export const FLIGHT_MS = 420;
/** The copy's fade once it has landed over the player's own art. */
const LAND_FADE_MS = 160;
// Quick off the mark, long gentle settle: the curve iOS uses for its own zooms.
const FLIGHT_EASING = Easing.bezier(0.2, 0.85, 0.25, 1);

/**
 * The transform that draws a box laid out at `to` exactly over `from`: transforms apply
 * around the box's centre, so the move is centre to centre and the scale is size to size.
 * Exported for tests.
 */
export function flightStart(from: HeroRect, to: HeroRect) {
  return {
    translateX: from.x + from.width / 2 - (to.x + to.width / 2),
    translateY: from.y + from.height / 2 - (to.y + to.height / 2),
    scaleX: from.width / to.width,
    scaleY: from.height / to.height,
  };
}

/**
 * The layer the artwork flies across on its way into the full player (`lib/playback/
 * playerHero.ts`). Mounted once in the root layout, above the navigation stack, so the
 * player screen's own slide doesn't carry the art with it. Draws nothing between flights
 * and never takes a touch.
 */
export function PlayerHeroOverlay() {
  const flight = usePlayerHero();
  const layer = useRef<View>(null);
  // The layer's own window position: the tapped art is measured in window coordinates.
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  return (
    <View
      ref={layer}
      collapsable={false}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={() => layer.current?.measureInWindow((x, y) => setOffset({ x: x || 0, y: y || 0 }))}
    >
      {flight ? <Flight key={flight.id} flight={flight} offset={offset} /> : null}
    </View>
  );
}

function Flight({ flight, offset }: { flight: HeroFlight; offset: { x: number; y: number } }) {
  const { colors } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  // Corner radius in the box's own (unscaled) units, so it reads right at every scale.
  // Layout props can't run on the native driver, hence a separate value on an inner view.
  const corner = useRef(new Animated.Value(0)).current;

  const from: HeroRect = { ...flight.from, x: flight.from.x - offset.x, y: flight.from.y - offset.y };
  const to = flight.to;
  const start = to ? flightStart(from, to) : null;

  useEffect(() => {
    if (flight.phase !== 'flying' || !start) return;
    corner.setValue(flight.fromRadius / start.scaleX);
    Animated.parallel([
      Animated.timing(progress, { toValue: 1, duration: FLIGHT_MS, easing: FLIGHT_EASING, useNativeDriver: true }),
      Animated.timing(corner, { toValue: flight.toRadius, duration: FLIGHT_MS, easing: FLIGHT_EASING, useNativeDriver: false }),
    ]).start(() => {
      landPlayerHero(flight.id);
      Animated.timing(opacity, { toValue: 0, duration: LAND_FADE_MS, useNativeDriver: true }).start(() =>
        clearPlayerHero(flight.id),
      );
    });
    // Runs once, when the target arrives; the values are this flight's own.
  }, [flight.phase === 'flying']);

  const frame = to ?? from;
  const transform = start
    ? [
        { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [start.translateX, 0] }) },
        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [start.translateY, 0] }) },
        { scaleX: progress.interpolate({ inputRange: [0, 1], outputRange: [start.scaleX, 1] }) },
        { scaleY: progress.interpolate({ inputRange: [0, 1], outputRange: [start.scaleY, 1] }) },
      ]
    : [];

  return (
    <Animated.View
      testID="player-hero"
      style={[
        styles.box,
        { shadowColor: colors.shadow.card },
        { left: frame.x, top: frame.y, width: frame.width, height: frame.height, opacity, transform },
      ]}
    >
      <Animated.View style={[styles.clip, { borderRadius: start ? corner : flight.fromRadius }]}>
        <Artwork uri={flight.uri} style={StyleSheet.absoluteFill} transition={0} accessible={false} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  clip: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
});
