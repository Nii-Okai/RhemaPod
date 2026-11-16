import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { createThemedStyles, useTheme } from '../../theme/ThemeContext';
import { AppText } from '../Text';

/** Width of the mark, in points. The native splash draws it at the same width (app.json). */
export const SPLASH_MARK_WIDTH = 150;
const MARK_ASPECT = 975 / 770;
const MARK_HEIGHT = SPLASH_MARK_WIDTH * MARK_ASPECT;
/** How far the mark lifts to make room for the wordmark under it. */
const LIFT = 70;

/** The whole sequence: about two seconds, then a short fade into the app. */
export const SPLASH_DURATION_MS = 2000;
const FADE_OUT_MS = 320;
const REDUCED_HOLD_MS = 600;

export interface AnimatedSplashProps {
  /** True once the app underneath can be shown (fonts loaded). The splash never leaves before. */
  ready: boolean;
  /** Called once the splash has faded out and can be unmounted. */
  onFinish: () => void;
  /** Called on the first layout, when the native splash can be hidden under it. */
  onShown?: () => void;
}

/**
 * The launch animation (Daybreak redesign, canvas artboards A0 light and A1 dark).
 *
 * It starts exactly where the native splash leaves off: the mark alone, centred, at the
 * same width on the same ground (app.json `expo-splash-screen`), so hiding the native
 * splash under it shows no jump. Then, in about two seconds:
 *
 *  0.0–0.6 s  two soft orbs rise from the bottom of the screen;
 *  0.2–0.8 s  a warm glow blooms behind the mark and the mark takes a small breath;
 *  0.6–1.2 s  the mark lifts and the RhemaPod wordmark fades up beneath it;
 *  1.0–1.5 s  a gold shine passes over the mark;
 *  1.2–1.6 s  the tagline appears;
 *  then it holds until the app is ready and fades away.
 *
 * With Reduce Motion on, it shows the finished composition at once, holds briefly and
 * fades. It is decorative: screen readers hear one "RhemaPod" label.
 */
export function AnimatedSplash({ ready, onFinish, onShown }: AnimatedSplashProps) {
  const styles = useStyles();
  const { scheme, colors } = useTheme();
  const { height } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [sequenceDone, setSequenceDone] = useState(false);
  const shownRef = useRef(false);
  const finishedRef = useRef(false);

  const rise = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const shine = useRef(new Animated.Value(0)).current;
  const tagline = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => !cancelled && setReduceMotion(enabled))
      .catch(() => !cancelled && setReduceMotion(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion === null) return;
    if (reduceMotion) {
      for (const value of [rise, lift, tagline]) value.setValue(1);
      const timer = setTimeout(() => setSequenceDone(true), REDUCED_HOLD_MS);
      return () => clearTimeout(timer);
    }
    const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
    const timing = (value: Animated.Value, toValue: number, duration: number, delay = 0) =>
      Animated.timing(value, { toValue, duration, delay, easing: ease, useNativeDriver: true });
    const animation = Animated.parallel([
      timing(rise, 1, 600),
      Animated.sequence([timing(glow, 1, 450, 200), timing(glow, 0, 700)]),
      Animated.sequence([timing(breath, 1, 300, 200), timing(breath, 0, 300)]),
      timing(lift, 1, 600, 600),
      timing(shine, 1, 500, 1000),
      timing(tagline, 1, 400, 1200),
    ]);
    animation.start();
    const timer = setTimeout(() => setSequenceDone(true), SPLASH_DURATION_MS);
    return () => {
      animation.stop();
      clearTimeout(timer);
    };
  }, [reduceMotion, rise, glow, breath, lift, shine, tagline]);

  useEffect(() => {
    if (!sequenceDone || !ready || finishedRef.current) return;
    finishedRef.current = true;
    Animated.timing(fade, {
      toValue: 0,
      duration: reduceMotion ? 200 : FADE_OUT_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => onFinish());
  }, [sequenceDone, ready, reduceMotion, fade, onFinish]);

  const handleLayout = () => {
    if (shownRef.current) return;
    shownRef.current = true;
    onShown?.();
  };

  const mark =
    scheme === 'light' ? require('../../assets/brand/mark-bronze.png') : require('../../assets/brand/mark-gold.png');
  const wordmark =
    scheme === 'light'
      ? require('../../assets/brand/wordmark-on-light.png')
      : require('../../assets/brand/wordmark-on-dark.png');

  const riseY = rise.interpolate({ inputRange: [0, 1], outputRange: [height * 0.2, 0] });
  const markLift = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -LIFT] });
  const markScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });
  const wordY = lift.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.15] });
  const shineOpacity = shine.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.55, 0] });

  return (
    <Animated.View
      testID="animated-splash"
      style={[styles.root, { opacity: fade }]}
      onLayout={handleLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel="RhemaPod"
    >
      <Animated.View style={[styles.orbOuter, { opacity: rise, transform: [{ translateY: riseY }] }]} />
      <Animated.View style={[styles.orbInner, { opacity: rise, transform: [{ translateY: riseY }] }]} />

      <View style={styles.center} pointerEvents="none">
        <Animated.View style={{ transform: [{ translateY: markLift }] }}>
          <Animated.View style={[styles.glow, { opacity: glow, transform: [{ scale: glowScale }] }]}>
            <View style={[styles.glowRing, styles.glowRingOuter]} />
            <View style={[styles.glowRing, styles.glowRingMid]} />
            <View style={[styles.glowRing, styles.glowRingInner]} />
          </Animated.View>
          <Animated.View style={{ transform: [{ scale: markScale }] }}>
            <Image source={mark} style={styles.mark} resizeMode="contain" accessible={false} />
            <Animated.Image
              source={mark}
              style={[styles.mark, styles.overlay, { tintColor: colors.splash.shine, opacity: shineOpacity }]}
              resizeMode="contain"
              accessible={false}
            />
          </Animated.View>
        </Animated.View>
        <Animated.View style={[styles.words, { opacity: lift, transform: [{ translateY: wordY }] }]}>
          <Image source={wordmark} style={styles.wordmark} resizeMode="contain" accessible={false} />
          {ready ? (
            <Animated.View style={{ opacity: tagline }}>
              <AppText variant="ui.label" style={styles.tagline}>
                A word for every day
              </AppText>
            </Animated.View>
          ) : null}
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: colors.splash.ground,
    overflow: 'hidden',
  },
  orbOuter: {
    position: 'absolute',
    width: 640,
    height: 640,
    borderRadius: 320,
    bottom: -430,
    alignSelf: 'center',
    marginLeft: -60,
    backgroundColor: colors.splash.orbOuter,
  },
  orbInner: {
    position: 'absolute',
    width: 460,
    height: 460,
    borderRadius: 230,
    bottom: -330,
    alignSelf: 'center',
    marginLeft: 60,
    backgroundColor: colors.splash.orbInner,
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    width: SPLASH_MARK_WIDTH,
    height: MARK_HEIGHT,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  // React Native has no blur filter: three concentric discs at falling opacity read as a
  // soft glow behind the mark.
  glow: {
    position: 'absolute',
    top: MARK_HEIGHT / 2 - 130,
    left: SPLASH_MARK_WIDTH / 2 - 130,
    width: 260,
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowRing: {
    position: 'absolute',
    backgroundColor: colors.splash.glow,
  },
  glowRingOuter: { width: 260, height: 260, borderRadius: 130, opacity: 0.12 },
  glowRingMid: { width: 200, height: 200, borderRadius: 100, opacity: 0.18 },
  glowRingInner: { width: 140, height: 140, borderRadius: 70, opacity: 0.28 },
  // Sits below the mark's resting place (centre + half its height) once it has lifted.
  words: {
    position: 'absolute',
    top: '50%',
    marginTop: MARK_HEIGHT / 2 - LIFT + 24,
    alignItems: 'center',
    gap: 14,
  },
  wordmark: {
    width: 190,
    height: 190 * (73 / 406),
  },
  tagline: {
    color: colors.splash.tagline,
    fontSize: 15,
  },
}));
