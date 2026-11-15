import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Animated, View, type StyleProp, type ViewStyle } from 'react-native';
import { isHeroHiding, reportHeroTarget, usePlayerHero } from '../../../lib/playback/playerHero';

/** The player screen's root view: targets measure themselves against it, not the window,
 * because the window position of anything in the player is still moving mid-slide. */
export const PlayerHeroRootContext = createContext<React.RefObject<View> | null>(null);

const REVEAL_MS = 140;

export interface PlayerHeroTargetProps {
  sermonId: string;
  /** Corner radius of the art where it lands. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * Where the art flying in from the mini player lands (`lib/playback/playerHero.ts`). Wraps
 * the stage: the art sits in it as a centred square (`FittedArt` never crops), so that
 * square is the landing spot. Hidden while the copy is in the air, then faded in under it
 * as it lands. A plain wrapper whenever nothing is flying.
 */
export function PlayerHeroTarget({ sermonId, radius = 0, style, children }: PlayerHeroTargetProps) {
  const root = useContext(PlayerHeroRootContext);
  const ref = useRef<View>(null);
  const flight = usePlayerHero();
  const hiding = isHeroHiding(flight, sermonId);
  const waiting = flight?.phase === 'waiting' && flight.sermonId === sermonId;
  const opacity = useRef(new Animated.Value(hiding ? 0 : 1)).current;
  const wasHiding = useRef(hiding);

  const measure = () => {
    const node = ref.current;
    const rootNode = root?.current;
    if (!node || !rootNode) return;
    node.measureLayout(
      rootNode,
      (x, y, width, height) => {
        const side = Math.min(width, height);
        reportHeroTarget(sermonId, { x: x + (width - side) / 2, y: y + (height - side) / 2, width: side, height: side }, radius);
      },
      () => {},
    );
  };

  // Laid out before the launch reached us (a re-render), so measure on the launch too.
  useEffect(() => {
    if (waiting) measure();
  }, [waiting]);

  useEffect(() => {
    if (hiding === wasHiding.current) return;
    wasHiding.current = hiding;
    if (hiding) opacity.setValue(0);
    else Animated.timing(opacity, { toValue: 1, duration: REVEAL_MS, useNativeDriver: true }).start();
  }, [hiding, opacity]);

  return (
    <Animated.View style={[style, { opacity }]}>
      <View ref={ref} collapsable={false} onLayout={() => waiting && measure()}>
        {children}
      </View>
    </Animated.View>
  );
}
