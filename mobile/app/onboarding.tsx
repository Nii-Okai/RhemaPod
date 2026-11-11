import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { AppText, PlatformIcon } from '../components';
import { darkColors as onArt } from '../theme/colors';
import { createThemedStyles, useTheme } from '../theme/ThemeContext';
import { radius } from '../theme/radius';
import { spacing } from '../theme/spacing';
import { onboardingSlides } from '../lib/onboarding/slides';
import { markOnboardingSeen } from '../lib/settings/onboardingSeen';

// Experimental "make it alive" tuning (see the doc comment below) — tweak or delete freely.
const KEN_BURNS_DURATION_MS = 7000;
const KEN_BURNS_MAX_SCALE = 1.06;

/**
 * First-launch onboarding (Isaac's mockups: a 3-slide swipeable carousel shown only the
 * very first time the app is opened — before sign-in, before any account is known).
 * Gated by `app/index.tsx` via `lib/settings/onboardingSeen.ts`; reached directly, with
 * nothing rendered before it.
 *
 * "Configurable out of code": every slide's image/headline/body comes from
 * `lib/onboarding/slides.ts` — this screen just maps over that array. Changing the
 * copy or swapping in real photography later (replacing the current Isaac-provided
 * placeholder images) is a one-line edit to that data file, never a change here.
 *
 * Swipeable mechanism mirrors `(tabs)/_home/HeroCarousel.tsx` (the app's own proven
 * pattern, reused rather than a new carousel dependency): `onLayout` for page
 * dimensions (not `Dimensions.get('window')`, same reasoning — this screen is full-bleed
 * here, but tracking real layout is still the safer, already-established approach), a
 * paging `ScrollView`, `onMomentumScrollEnd` to settle the shared `page` index.
 *
 * Skip (top-right over the image), the pagination dots, and the Next/Get Started button
 * render identically on every slide — rather than pulling them out as a fixed overlay
 * above the `ScrollView`, each is rendered per-slide inside the generic `.map` (dots key
 * off the shared `page` state, the button's label/action off that slide's own index).
 * Simpler than coordinating a separate overlay's state with the scroll position, and
 * visually identical since only the current page's copy of each is ever on-screen.
 *
 * Skip and the final slide's "Get Started" both do the same thing: mark onboarding seen
 * and land on sign-in — onboarding is pre-auth, so it never routes straight into
 * `(tabs)` even if a session technically exists already.
 *
 * EXPERIMENTAL (Isaac's ask, 2026-10-16: "put some effects on the onboarding images to
 * make it alive") — may be reverted. A slow, continuous "Ken Burns" zoom on every slide's
 * image (shared loop, RN core `Animated`, same API this app already uses in
 * `StaggerItem`/`CircularProgress`/etc. — no new dependency), applied identically to all
 * three since only the current page is ever visible through the paging `ScrollView`
 * anyway. Deliberately ambient, not a transition: it runs continuously and isn't tied to
 * swiping or which slide is active — Isaac's explicit follow-up ask, same session: "do not
 * add transition effects" (an earlier pass here also had a scroll-tied image parallax and
 * a per-slide fade+rise-in on the text card, both removed for that reason).
 * Each slide clips with `overflow: 'hidden'` so the zoom never visibly escapes its page.
 *
 * Daybreak redesign (canvas A2): the photo now fills the top half with rounded lower
 * corners, the wordmark and Skip on it; the copy, pill dots and a full-width Continue
 * sit on the page's own ground below, so this screen follows the theme. Only the
 * wordmark, Skip and the scrim on the photo are pinned to the dark palette (`onArt`).
 *
 * Earlier (Nii's ask, 2026-10-23 — the copy vanished in light mode because the old
 * light card used the dark palette's pill colour as its fill while `AppText`'s theme-aware
 * `inverse` tone flipped to near-white): the photo now fills the whole page and the copy
 * sits on a dark gradient at its foot. Everything here is drawn from the dark palette
 * (`onArt`) on purpose — it is all on photography, so it looks the same in both themes.
 */
export default function OnboardingScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [page, setPage] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const kenBurns = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(kenBurns, { toValue: 1, duration: KEN_BURNS_DURATION_MS, useNativeDriver: true }),
        Animated.timing(kenBurns, { toValue: 0, duration: KEN_BURNS_DURATION_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
    // Mount-only loop (empty deps on purpose), see doc comment above.
  }, []);

  const kenBurnsScale = kenBurns.interpolate({ inputRange: [0, 1], outputRange: [1, KEN_BURNS_MAX_SCALE] });

  const onLayout = (e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
    setHeight(e.nativeEvent.layout.height);
  };

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  async function finish() {
    await markOnboardingSeen();
    router.replace('/(auth)/sign-in');
  }

  function goToSlide(index: number) {
    setPage(index);
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
  }

  return (
    <View style={styles.flex} onLayout={onLayout}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        accessibilityLabel={`Onboarding, ${page + 1} of ${onboardingSlides.length}`}
      >
        {onboardingSlides.map((slide, index) => {
          const isLast = index === onboardingSlides.length - 1;

          return (
            <View
              key={index}
              testID={`onboarding-slide-${index}`}
              style={[styles.slide, width && height ? { width, height } : styles.pageFallback]}
            >
              <View style={styles.photo}>
                <Animated.Image
                  source={slide.image}
                  style={[styles.image, { transform: [{ scale: kenBurnsScale }] }]}
                  resizeMode="cover"
                />
                <Scrim id={`onboardingTop${index}`} edge="top" />
                <View style={[styles.topRow, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
                  <Image
                    source={require('../assets/brand/wordmark-on-dark.png')}
                    style={styles.wordmark}
                    resizeMode="contain"
                    accessibilityLabel="RhemaPod"
                  />
                  <Pressable
                    onPress={finish}
                    accessibilityRole="button"
                    accessibilityLabel="Skip"
                    hitSlop={8}
                    style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
                  >
                    <AppText variant="ui.bodyBold" style={styles.onArtPrimary}>
                      Skip
                    </AppText>
                  </Pressable>
                </View>
              </View>

              <View style={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.md }]}>
                <View style={styles.dots}>
                  {onboardingSlides.map((_, dotIndex) => (
                    <View
                      key={dotIndex}
                      testID={`onboarding-dot-${index}-${dotIndex}`}
                      style={[styles.dot, dotIndex === page && styles.dotActive]}
                    />
                  ))}
                </View>
                <View style={styles.copy}>
                  <AppText variant="display.hero" accessibilityRole="header">
                    {slide.headline}
                  </AppText>
                  <AppText variant="ui.bodyLarge" tone="secondary">
                    {slide.body}
                  </AppText>
                </View>
                <View style={styles.grow} />
                <Pressable
                  onPress={isLast ? finish : () => goToSlide(index + 1)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
                >
                  <AppText variant="ui.button" tone="inverse">
                    {isLast ? 'Get started' : 'Continue'}
                  </AppText>
                  <PlatformIcon name="chevron-forward" size={18} color={colors.primaryButton.text} />
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * Fade from clear into the app's dark navy at one edge of the photo — the copy sits on
 * the bottom fade, Skip and the status bar on the top one. Dark in both themes: it
 * sits on photography, whose brightness the theme doesn't change.
 */
function Scrim({ id, edge }: { id: string; edge: 'top' | 'bottom' }) {
  const styles = useStyles();
  const bottom = edge === 'bottom';
  return (
    <View style={styles.scrimTop} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1={bottom ? '0' : '1'} x2="0" y2={bottom ? '1' : '0'}>
            <Stop offset="0" stopColor={onArt.surface.app} stopOpacity={0} />
            <Stop offset="0.45" stopColor={onArt.surface.app} stopOpacity={bottom ? 0.7 : 0.25} />
            <Stop offset="1" stopColor={onArt.surface.app} stopOpacity={bottom ? 1 : 0.6} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  flex: {
    flex: 1,
    backgroundColor: colors.surface.app,
  },
  slide: {
    overflow: 'hidden',
  },
  pageFallback: {
    width: '100%',
    flex: 1,
  },
  photo: {
    height: '56%',
    overflow: 'hidden',
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
    backgroundColor: onArt.surface.raised,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  scrimTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '40%',
  },
  topRow: {
    position: 'absolute',
    left: spacing.lg + 4,
    right: spacing.lg + 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wordmark: {
    width: 133,
    height: 24,
  },
  skip: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  pressed: {
    opacity: 0.85,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg + 4,
    paddingTop: spacing.xxl,
    gap: spacing.lg,
  },
  copy: {
    gap: spacing.md,
  },
  onArtPrimary: {
    color: onArt.text.primary,
  },
  grow: {
    flex: 1,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border.default,
  },
  dotActive: {
    width: 28,
    backgroundColor: colors.text.primary,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 54,
    backgroundColor: colors.primaryButton.bg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
  },
}));
